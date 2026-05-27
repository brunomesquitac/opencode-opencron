import { Command } from 'commander';
import { TaskService } from '@core/services/task.service';
import { TaskTemplateService } from '@core/services/task-template.service';
import { closeDb } from '@core/db';
import { parseDuration } from '@core/duration';
import type { TaskStatus, ScheduleType } from '@core/db/schema';

async function withDb<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        closeDb();
        process.exit(1);
    } finally {
        closeDb();
    }
}

const program = new Command();

program
    .name('opencron')
    .description('Headless task scheduler for OpenCode agents')
    .version('0.1.0');

program
    .command('add')
    .description('Create a new task')
    .requiredOption('-n, --name <name>', 'Task name')
    .requiredOption('-a, --agent <agent>', 'Agent name')
    .requiredOption('-p, --prompt <prompt>', 'Task prompt')
    .option('-m, --model <model>', 'Model override')
    .option('-c, --category <category>', 'Category (default: general)', 'general')
    .option('-i, --importance <number>', 'Importance 1-5 (default: 3)', '3')
    .option('-u, --urgency <number>', 'Urgency 1-5 (default: 3)', '3')
    .option('-b, --batch <batchId>', 'Batch ID for grouping')
    .option('-d, --depends <taskId>', 'Dependency task ID')
    .option('-w, --cwd <path>', '(deprecated) Working directory is auto-recorded')
    .action(async (options) => withDb(async () => {
        const submitCwd = process.cwd();
        const task = await TaskService.add({
            name: options.name,
            agent: options.agent,
            prompt: options.prompt,
            model: options.model,
            category: options.category,
            importance: parseInt(options.importance),
            urgency: parseInt(options.urgency),
            batchId: options.batch,
            dependsOn: options.depends ? parseInt(options.depends) : undefined,
            cwd: submitCwd,
        });
        console.log(JSON.stringify({ id: task.id, status: 'created' }, null, 2));
    }));

program
    .command('next')
    .description('Get the next pending task')
    .action(async () => withDb(async () => {
        const task = await TaskService.next({ cwd: process.cwd() });
        if (task) {
            console.log(JSON.stringify({
                id: task.id,
                name: task.name,
                agent: task.agent,
                model: task.model,
                prompt: task.prompt,
                cwd: task.cwd,
                category: task.category,
                importance: task.importance,
                urgency: task.urgency,
            }, null, 2));
        } else {
            console.log(JSON.stringify({ id: null, message: 'No pending tasks' }));
        }
    }));

program
    .command('start')
    .description('Start a task (mark as running)')
    .requiredOption('--id <id>', 'Task ID')
    .action(async (options) => withDb(async () => {
        const task = await TaskService.start(parseInt(options.id), { cwd: process.cwd() });
        if (task) {
            console.log(JSON.stringify({ id: task.id, status: task.status }));
        } else {
            console.log(JSON.stringify({ error: 'Task not found' }));
            process.exit(1);
        }
    }));

program
    .command('done')
    .description('Complete a task (mark as done)')
    .requiredOption('--id <id>', 'Task ID')
    .option('-l, --log <log>', 'Result log')
    .action(async (options) => withDb(async () => {
        const task = await TaskService.done(parseInt(options.id), options.log, { cwd: process.cwd() });
        if (task) {
            console.log(JSON.stringify({ id: task.id, status: task.status }));
        } else {
            console.log(JSON.stringify({ error: 'Task not found' }));
            process.exit(1);
        }
    }));

program
    .command('fail')
    .description('Mark a task as failed')
    .requiredOption('--id <id>', 'Task ID')
    .option('-l, --log <log>', 'Error log')
    .action(async (options) => withDb(async () => {
        const task = await TaskService.fail(parseInt(options.id), options.log, { cwd: process.cwd() });
        if (task) {
            console.log(JSON.stringify({
                id: task.id,
                status: task.status,
                retryCount: task.retryCount,
            }));
        } else {
            console.log(JSON.stringify({ error: 'Task not found' }));
            process.exit(1);
        }
    }));

program
    .command('cancel')
    .description('Cancel a task')
    .requiredOption('--id <id>', 'Task ID')
    .action(async (options) => withDb(async () => {
        const task = await TaskService.cancel(parseInt(options.id), { cwd: process.cwd() });
        if (task) {
            console.log(JSON.stringify({ id: task.id, status: task.status }));
        } else {
            console.log(JSON.stringify({ error: 'Task not found' }));
            process.exit(1);
        }
    }));

program
    .command('retry')
    .description('Retry a failed task')
    .option('--id <id>', 'Task ID')
    .option('-b, --batch <batchId>', 'Batch ID (batch retry)')
    .action(async (options) => withDb(async () => {
        if (options.id) {
            const task = await TaskService.retry(parseInt(options.id), { cwd: process.cwd() });
            if (task) {
                console.log(JSON.stringify({ id: task.id, status: task.status }));
            } else {
                console.log(JSON.stringify({ error: 'Task not found or not failed' }));
                process.exit(1);
            }
        } else if (options.batch) {
            const count = await TaskService.retryBatch(options.batch, { cwd: process.cwd() });
            console.log(JSON.stringify({ retried: count, batchId: options.batch }));
        } else {
            console.log(JSON.stringify({ error: 'Please specify --id or --batch' }));
            process.exit(1);
        }
    }));

program
    .command('status')
    .description('Show task statistics')
    .option('-b, --batch <batchId>', 'Filter by batch')
    .action(async (options) => withDb(async () => {
        const stats = await TaskService.stats({ batchId: options.batch, cwd: process.cwd() });
        console.log(JSON.stringify(stats, null, 2));
    }));

program
    .command('list')
    .description('List tasks')
    .option('-s, --status <status>', 'Filter by status')
    .option('-b, --batch <batchId>', 'Filter by batch')
    .option('-c, --category <category>', 'Filter by category')
    .option('-l, --limit <number>', 'Max results', '20')
    .action(async (options) => withDb(async () => {
        const tasks = await TaskService.list({
            status: options.status as TaskStatus,
            batchId: options.batch,
            category: options.category,
            cwd: process.cwd(),
            limit: parseInt(options.limit),
        });
        console.log(JSON.stringify(tasks, null, 2));
    }));

program
    .command('get')
    .description('Get task details')
    .requiredOption('--id <id>', 'Task ID')
    .action(async (options) => withDb(async () => {
        const task = await TaskService.getById(parseInt(options.id), { cwd: process.cwd() });
        if (task) {
            console.log(JSON.stringify(task, null, 2));
        } else {
            console.log(JSON.stringify({ error: 'Task not found' }));
            process.exit(1);
        }
    }));

program
    .command('delete')
    .description('Delete a task')
    .requiredOption('--id <id>', 'Task ID')
    .action(async (options) => withDb(async () => {
        const deleted = await TaskService.delete(parseInt(options.id), { cwd: process.cwd() });
        console.log(JSON.stringify({ deleted, id: parseInt(options.id) }));
    }));

program
    .command('template')
    .description('Manage scheduled task templates')
    .addCommand(
        new Command('add')
            .description('Create a schedule template')
            .requiredOption('-n, --name <name>', 'Template name')
            .requiredOption('-a, --agent <agent>', 'Agent name')
            .requiredOption('-p, --prompt <prompt>', 'Task prompt')
            .requiredOption('-t, --type <type>', 'Schedule type: cron/delayed/recurring')
            .option('--cron <expr>', 'Cron expression (required for cron type)')
            .option('--delay <duration>', 'Delay duration (required for delayed), e.g. 30s / 5min / 1h / 2d')
            .option('--interval <duration>', 'Recurring interval (required for recurring), e.g. 1h / 30min / 5s')
            .option('-m, --model <model>', 'Model')
            .option('-c, --category <category>', 'Category', 'general')
            .option('-i, --importance <number>', 'Importance 1-5', '3')
            .option('-u, --urgency <number>', 'Urgency 1-5', '3')
            .option('--max-instances <number>', 'Max concurrent instances', '1')
            .option('--max-retries <number>', 'Max retries', '3')
            .option('--retry-backoff <ms>', 'Backoff base interval ms', '30000')
            .action(async (options) => withDb(async () => {
                let intervalMs: number | null = null;
                let runAt: number | null = null;

                if (options.interval) {
                    intervalMs = parseDuration(options.interval);
                    if (intervalMs === null) {
                        console.error(JSON.stringify({ error: `Invalid interval: "${options.interval}". Use 30s / 5min / 1h / 2d` }));
                        process.exit(1);
                    }
                }
                if (options.delay) {
                    const delayMs = parseDuration(options.delay);
                    if (delayMs === null) {
                        console.error(JSON.stringify({ error: `Invalid delay: "${options.delay}". Use 30s / 5min / 1h / 2d` }));
                        process.exit(1);
                    }
                    runAt = Date.now() + delayMs;
                }

                const tmpl = await TaskTemplateService.create({
                    name: options.name,
                    agent: options.agent,
                    prompt: options.prompt,
                    model: options.model,
                    category: options.category,
                    importance: parseInt(options.importance),
                    urgency: parseInt(options.urgency),
                    scheduleType: options.type as ScheduleType,
                    cronExpr: options.cron,
                    intervalMs,
                    runAt,
                    maxInstances: parseInt(options.maxInstances),
                    maxRetries: parseInt(options.maxRetries),
                    retryBackoffMs: parseInt(options.retryBackoff),
                    cwd: process.cwd(),
                });
                console.log(JSON.stringify({ id: tmpl.id, status: 'created', nextRunAt: tmpl.nextRunAt }, null, 2));
            })),
    )
    .addCommand(
        new Command('list')
            .description('List schedule templates')
            .action(async () => withDb(async () => {
                const templates = await TaskTemplateService.list();
                console.log(JSON.stringify(templates, null, 2));
            })),
    )
    .addCommand(
        new Command('enable')
            .description('Enable a template')
            .requiredOption('--id <id>', 'Template ID')
            .action(async (options) => withDb(async () => {
                const tmpl = await TaskTemplateService.enable(parseInt(options.id));
                if (tmpl) {
                    console.log(JSON.stringify({ id: tmpl.id, enabled: true }));
                } else {
                    console.log(JSON.stringify({ error: 'Template not found' }));
                    process.exit(1);
                }
            })),
    )
    .addCommand(
        new Command('disable')
            .description('Disable a template')
            .requiredOption('--id <id>', 'Template ID')
            .action(async (options) => withDb(async () => {
                const tmpl = await TaskTemplateService.disable(parseInt(options.id));
                if (tmpl) {
                    console.log(JSON.stringify({ id: tmpl.id, enabled: false }));
                } else {
                    console.log(JSON.stringify({ error: 'Template not found' }));
                    process.exit(1);
                }
            })),
    )
    .addCommand(
        new Command('delete')
            .description('Delete a template')
            .requiredOption('--id <id>', 'Template ID')
            .action(async (options) => withDb(async () => {
                const deleted = await TaskTemplateService.delete(parseInt(options.id));
                console.log(JSON.stringify({ deleted, id: parseInt(options.id) }));
            })),
    );

program
    .command('init')
    .description('Initialize OpenCron (create config + run migrations)')
    .action(async () => withDb(async () => {
        const { existsSync, mkdirSync, writeFileSync } = await import('fs');
        const { homedir } = await import('os');
        const { join, dirname } = await import('path');
        const { CONFIG_PATH } = await import('@gateway/config');

        if (!existsSync(CONFIG_PATH)) {
            const dir = dirname(CONFIG_PATH);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(CONFIG_PATH, JSON.stringify({
                worker: { maxConcurrency: 2 },
                scheduler: { enabled: true },
            }, null, 2) + '\n');
            console.log(JSON.stringify({ created: CONFIG_PATH }));
        } else {
            console.log(JSON.stringify({ exists: CONFIG_PATH }));
        }

        const { getDb } = await import('@core/db');
        const { migrate } = await import('drizzle-orm/bun-sqlite/migrator');
        const { join: pJoin, dirname: pDirname } = await import('path');
        const { fileURLToPath } = await import('url');
        const __dirname = pDirname(fileURLToPath(import.meta.url));
        migrate(getDb(), { migrationsFolder: pJoin(__dirname, '../../drizzle') });
        console.log(JSON.stringify({ migrated: true }));
    }));

program
    .command('migrate')
    .description('Run database migrations')
    .action(async () => withDb(async () => {
        const { getDb } = await import('@core/db');
        const { migrate } = await import('drizzle-orm/bun-sqlite/migrator');
        const { join, dirname } = await import('path');
        const { fileURLToPath } = await import('url');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        migrate(getDb(), { migrationsFolder: join(__dirname, '../../drizzle') });
        console.log(JSON.stringify({ migrated: true }));
    }));

async function cleanStaleLock() {
    const { readFileSync, unlinkSync, existsSync } = await import('fs');
    const { homedir } = await import('os');
    const { join } = await import('path');
    const lockFile = join(homedir(), '.local', 'share', 'opencode', 'gateway.lock');
    if (existsSync(lockFile)) {
        try {
            const lock = JSON.parse(readFileSync(lockFile, 'utf-8'));
            try { process.kill(lock.pid, 0); } catch {
                unlinkSync(lockFile);
                console.log(JSON.stringify({ level: 'info', msg: 'removed stale lock from dead process', stalePid: lock.pid }));
            }
        } catch { unlinkSync(lockFile); }
    }
}

const gatewayCmd = new Command('gateway')
    .description('Manage the Gateway process (start, stop, restart, status, logs)');

gatewayCmd
    .command('start')
    .description('Start the Gateway process in foreground')
    .action(async () => {
        await cleanStaleLock();
        const { main } = await import('@gateway/index');
        await main();
    });

async function stopGateway(options: { force?: boolean } = {}): Promise<void> {
    const { spawnSync } = await import('child_process');
    const { readFileSync, unlinkSync, existsSync } = await import('fs');
    const { homedir } = await import('os');
    const { join } = await import('path');
    const lockFile = join(homedir(), '.local', 'share', 'opencode', 'gateway.lock');
    const pm2Path = (() => { try { return Bun.which('pm2') || Bun.which('pm2.cmd') || 'pm2'; } catch { return 'pm2'; } })();

    // 1. Delete from PM2 first — prevents auto-restart race
    let pm2Done = false;
    try {
        const del = spawnSync(pm2Path, ['delete', 'opencron-gateway'], { timeout: 10000, windowsHide: true });
        if (del.status === 0) pm2Done = true;
    } catch {}
    if (!pm2Done) {
        try { spawnSync(pm2Path, ['stop', 'opencron-gateway'], { timeout: 10000, windowsHide: true }); } catch {}
    }

    // 2. Kill via lock file PID
    if (existsSync(lockFile)) {
        try {
            const lock = JSON.parse(readFileSync(lockFile, 'utf-8'));
            try { process.kill(lock.pid, options.force ? 'SIGKILL' : 'SIGTERM'); } catch (err) { if ((err as any)?.code !== 'ESRCH') throw err; }
            unlinkSync(lockFile);
        } catch {}
    }

    console.log(JSON.stringify({ stopped: true }));
}

gatewayCmd
    .command('stop')
    .description('Stop the running Gateway gracefully')
    .option('-f, --force', 'Force kill if graceful shutdown fails')
    .action(async (options) => {
        await stopGateway({ force: options.force });
    });

gatewayCmd
    .command('restart')
    .description('Stop and restart the Gateway in foreground')
    .action(async () => {
        await stopGateway({ force: true });
        const { main } = await import('@gateway/index');
        await main();
    });

gatewayCmd
    .command('status')
    .description('Check if the Gateway is running')
    .action(async () => {
        const { readFileSync, existsSync } = await import('fs');
        const { homedir } = await import('os');
        const { join } = await import('path');
        const lockFile = join(homedir(), '.local', 'share', 'opencode', 'gateway.lock');

        const result: Record<string, unknown> = { running: false };

        // Check lock file
        if (existsSync(lockFile)) {
            try {
                const lock = JSON.parse(readFileSync(lockFile, 'utf-8'));
                try {
                    process.kill(lock.pid, 0);
                    result.running = true;
                    result.method = 'lock_file';
                    result.pid = lock.pid;
                    result.port = lock.port;
                    result.startedAt = new Date(lock.startedAt).toISOString();
                } catch {
                    result.staleLock = true;
                    result.stalePid = lock.pid;
                }
            } catch {}
        }

        // Check PM2
        if (!result.running) {
            try {
                const { spawnSync } = await import('child_process');
                const pm2Path = (() => { try { return Bun.which('pm2') || Bun.which('pm2.cmd') || 'pm2'; } catch { return 'pm2'; } })();
                const res = spawnSync(pm2Path, ['jlist'], { timeout: 10000, windowsHide: true });
                if (res.status === 0 && res.stdout) {
                    const list = JSON.parse(res.stdout.toString());
                    const gw = list.find((p: any) => p.name === 'opencron-gateway' && p.pm2_env?.status === 'online');
                    if (gw) {
                        result.running = true;
                        result.method = 'pm2';
                        result.pid = gw.pid;
                        result.pmId = gw.pm_id;
                        result.restarts = gw.pm2_env?.restart_time;
                        result.uptime = gw.pm2_env?.pm_uptime;
                    }
                }
            } catch {}
        }

        console.log(JSON.stringify(result, null, 2));
    });

gatewayCmd
    .command('logs')
    .description('Show Gateway logs')
    .option('-f, --follow', 'Follow log output (tail -f)')
    .option('-n, --lines <number>', 'Number of lines to show', '50')
    .action(async (options) => {
        const { join } = await import('path');
        const { homedir } = await import('os');
        const { existsSync } = await import('fs');
        const logFile = join(homedir(), '.local', 'share', 'opencode', 'gateway.log');

        if (!existsSync(logFile)) {
            console.log('No gateway.log found at ' + logFile);
            return;
        }

        if (options.follow) {
            const { spawn } = await import('child_process');
            const tail = spawn('powershell', [
                '-NoLogo', '-NoProfile', '-NonInteractive',
                '-Command',
                `Get-Content -Path "${logFile}" -Tail ${parseInt(options.lines)} -Wait`
            ], { stdio: 'inherit', windowsHide: true });
            await new Promise(() => {});
        } else {
            const { readFileSync } = await import('fs');
            const lines = readFileSync(logFile, 'utf-8').trim().split('\n');
            const tail = lines.slice(-parseInt(options.lines));
            for (const line of tail) {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.ts && parsed.level && parsed.msg) {
                        const ts = new Date(parsed.ts).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                        const icon = parsed.level === 'error' || parsed.level === 'fatal' ? '✖' : parsed.level === 'warn' ? '⚠' : '✓';
                        console.log(`${ts} [${icon}] ${parsed.msg}${parsed.taskId ? ' (task ' + parsed.taskId + ')' : ''}${parsed.channel ? ' [' + parsed.channel + ']' : ''}`);
                    } else {
                        console.log(line);
                    }
                } catch {
                    console.log(line);
                }
            }
            console.log(`\n--- ${tail.length} lines from ${logFile} ---`);
            if (tail.length === lines.length) {
                console.log('(use -f to follow, -n <N> for more lines)');
            }
        }
    });

program.addCommand(gatewayCmd);

program
    .command('ui')
    .description('Open Web Dashboard (embedded in Gateway)')
    .action(async () => {
        const { loadConfig } = await import('@gateway/config');
        const cfg = loadConfig();
        const url = `http://localhost:${cfg.dashboard.port}`;
        console.log(`Dashboard: ${url}`);
        try {
            const { execSync } = await import('child_process');
            const cmd = process.platform === 'win32' ? `start ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
            execSync(cmd, { stdio: 'ignore', windowsHide: true });
        } catch {}
    });

program
    .command('config')
    .description('Show current configuration')
    .action(async () => {
        const { loadConfig } = await import('@gateway/config');
        const cfg = loadConfig();
        console.log(JSON.stringify(cfg, null, 2));
    });

program
    .command('restart')
    .description('Restart the Gateway process via PM2')
    .action(async () => {
        await cleanStaleLock();
        try {
            const { restart: pm2Restart } = await import('../daemon/pm2');
            pm2Restart();
        } catch (err) {
            console.error('[opencron] Restart failed:', err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    });

program
    .command('install')
    .description('Install Gateway as pm2 service (auto-start on boot, crash recovery)')
    .action(async () => {
        await cleanStaleLock();
        try {
            const { install: pm2Install } = await import('../daemon/pm2');
            pm2Install();
        } catch (err) {
            console.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    });

program
    .command('uninstall')
    .description('Stop and remove Gateway pm2 service')
    .action(async () => {
        try {
            const { uninstall: pm2Uninstall } = await import('../daemon/pm2');
            pm2Uninstall();
        } catch (err) {
            console.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    });

program
    .command('upgrade')
    .description('Update npm package and restart Gateway')
    .action(async () => {
        const { spawnSync } = await import('child_process');
        const { homedir } = await import('os');
        const { join } = await import('path');
        const configDir = join(homedir(), '.config/opencode');

        function resolveBin(name: string): string {
            try { const r = Bun.which(name); if (r) return r; } catch {}
            return name;
        }
        const npmPath = resolveBin(process.platform === 'win32' ? 'npm.cmd' : 'npm');

        console.log('Updating opencode-opencron...');
        const npmResult = spawnSync(npmPath, ['install', 'opencode-opencron@latest'], {
            cwd: configDir,
            stdio: 'inherit',
            timeout: 60000,
            windowsHide: true,
        });
        if (npmResult.status !== 0) {
            console.error('npm install failed (exit code ' + npmResult.status + ')');
            console.error('Try manually: cd ~/.config/opencode && npm install opencode-opencron@latest');
            process.exit(1);
        }

        try {
            const { upgrade: pm2Upgrade } = await import('../daemon/pm2');
            const result = pm2Upgrade();
            console.log(`\nOpenCron upgraded: ${result.before ?? 'unknown'} → ${result.after}`);
            console.log('Gateway restarted. Please restart opencode to load the new plugin.');
        } catch (err) {
            console.error('Gateway restart failed:', err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    });

program.parse();
