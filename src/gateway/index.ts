import { loadConfig } from './config';
import { WorkerEngine } from '@worker/index';
import { Watchdog } from './watchdog';
import { Scheduler } from './scheduler';
import { closeDb } from '@core/db';
import { TaskService } from '@core/services/task.service';
import { TaskRunService } from '@core/services/task-run.service';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DATA_DIR = join(homedir(), '.local', 'share', 'opencode');
const LOCK_FILE = join(DATA_DIR, 'gateway.lock');

function readLock(): { pid: number; port: number; startedAt: number } | null {
    try {
        if (!existsSync(LOCK_FILE)) return null;
        return JSON.parse(readFileSync(LOCK_FILE, 'utf-8'));
    } catch {
        return null;
    }
}

function writeLock(pid: number, port: number) {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(LOCK_FILE, JSON.stringify({ pid, port, startedAt: Date.now() }));
}

function removeLock() {
    try { unlinkSync(LOCK_FILE); } catch {}
}

function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function acquireLock(port: number): boolean {
    const existing = readLock();
    const pid = process.pid;

    if (existing) {
        if (existing.pid === pid) return true;

        if (isPidAlive(existing.pid)) {
            console.error(JSON.stringify({
                ts: new Date().toISOString(),
                level: 'fatal',
                msg: 'another Gateway instance is already running',
                existingPid: existing.pid,
                existingPort: existing.port,
            }));
            return false;
        }

        console.log(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'info',
            msg: 'removing stale lock from dead process',
            stalePid: existing.pid,
        }));
        removeLock();
    }

    writeLock(pid, port);
    return true;
}

async function main() {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'OpenCron Gateway starting', pid: process.pid }));

    const cfg = loadConfig();

    if (!acquireLock(cfg.dashboard.port)) {
        process.exit(1);
    }
    process.on('exit', removeLock);

    const worker = new WorkerEngine(cfg);
    const watchdog = new Watchdog(cfg);
    const scheduler = new Scheduler(cfg);

    worker.start();
    watchdog.start();
    await scheduler.start();

    if (cfg.dashboard.enabled) {
        const { dashboardApp } = await import('@web/index');
        let port = cfg.dashboard.port;
        let server: any;
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                server = Bun.serve({
                    hostname: '127.0.0.1',
                    port,
                    fetch: dashboardApp.fetch,
                    reuseAddr: true,
                } as any);
                break;
            } catch (err: any) {
                if (err?.code === 'EADDRINUSE' && port < cfg.dashboard.port + 100) {
                    port++;
                    continue;
                }
                throw err;
            }
        }
        if (!server) {
            throw new Error(`Dashboard: no available port found in range ${cfg.dashboard.port}-${cfg.dashboard.port + 99}`);
        }
        writeLock(process.pid, port);
        console.log(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'info',
            msg: 'Dashboard started',
            url: `http://localhost:${port}`,
        }));
    }

    console.log(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        msg: 'Gateway started',
        maxConcurrency: cfg.worker.maxConcurrency,
        schedulerEnabled: cfg.scheduler.enabled,
    }));

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;

        console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: `received ${signal}, shutting down...` }));

        scheduler.stop();
        watchdog.stop();

        const runningIds = worker.getRunningTaskIds();
        await worker.stop();

        if (runningIds.length > 0) {
            const resetCount = await TaskService.resetRunningToPending(runningIds);
            console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'reset running tasks to pending', count: resetCount }));
        }

        const allRunningRuns = await TaskRunService.getAllRunningRuns();
        for (const run of allRunningRuns) {
            await TaskRunService.fail(run.id, 'Gateway shutdown');
        }

        removeLock();
        closeDb();

        console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'Gateway stopped' }));
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', (err) => {
        console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'fatal', msg: 'uncaughtException', error: err.message, stack: err.stack }));
        process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'fatal', msg: 'unhandledRejection', reason: String(reason) }));
        process.exit(1);
    });
}

export { main };
export { LOCK_FILE, readLock, isPidAlive };

if (import.meta.main) {
    main();
}
