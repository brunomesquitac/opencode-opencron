import { TaskService } from '@core/services/task.service';
import { TaskRunService } from '@core/services/task-run.service';
import type { GatewayConfig } from '@gateway/config';
import type { Task } from '@core/db/schema';
import { createOpencodeClient } from '@opencode-ai/sdk';
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { notifyTask } from '@gateway/notifications/service';

interface OpencodeServer {
    url: string;
    close(): void;
}

function resolveBin(name: string): string {
    try {
        const resolved = Bun.which(name);
        if (resolved) return resolved;
    } catch {}
    return name;
}

const opencodeBin = resolveBin('opencode');

function readDefaultModel(): string | null {
    try {
        const configPath = join(homedir(), '.config/opencode/opencode.jsonc');
        if (existsSync(configPath)) {
            const raw = readFileSync(configPath, 'utf-8');
            const parsed = JSON.parse(raw);
            return parsed.model || null;
        }
    } catch {}
    return null;
}

function spawnOpencodeServer(cwd: string | null | undefined, signal: AbortSignal, timeout = 30000): Promise<OpencodeServer> {
    return new Promise((resolve, reject) => {
        const defaultModel = readDefaultModel();
        let configContent: Record<string, unknown> = {};
        if (defaultModel) {
            configContent.model = defaultModel;
        }
        const proc = spawn(opencodeBin, ['serve', '--hostname=127.0.0.1', '--port=0'], {
            cwd: cwd || undefined,
            env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(configContent) },
            windowsHide: true,
            shell: false,
        });

        let output = '';
        let resolved = false;

        const timer = setTimeout(() => {
            cleanup();
            proc.kill();
            reject(new Error(`Timeout waiting for opencode server to start after ${timeout}ms`));
        }, timeout);

        function cleanup() {
            clearTimeout(timer);
            proc.stdout?.removeAllListeners();
            proc.stderr?.removeAllListeners();
            proc.removeAllListeners('exit');
            proc.removeAllListeners('error');
        }

        proc.stdout?.on('data', (chunk: Buffer) => {
            if (resolved) return;
            output += chunk.toString();
            for (const line of output.split('\n')) {
                if (line.startsWith('opencode server listening')) {
                    const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
                    if (match) {
                        resolved = true;
                        cleanup();
                        resolve({
                            url: match[1],
                            close() {
                                if (proc.exitCode === null) proc.kill();
                            },
                        });
                    }
                }
            }
        });

        proc.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });

        proc.on('exit', (code) => {
            if (resolved) return;
            cleanup();
            reject(new Error(`opencode server exited with code ${code}${output ? '\n' + output : ''}`));
        });

        proc.on('error', (err) => {
            if (resolved) return;
            cleanup();
            reject(err);
        });

        signal.addEventListener('abort', () => {
            if (resolved) return;
            cleanup();
            proc.kill();
            reject(signal.reason);
        }, { once: true });
    });
}

interface RunningTask {
    task: Task;
    runId: number;
    controller: AbortController;
    server: { close(): void };
    startedAt: number;
    shutdown: boolean;
}

export class WorkerEngine {
    private activeBatchIds = new Set<string>();
    private runningTasks = new Map<number, RunningTask>();
    private stopped = false;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private cfg: GatewayConfig;

    constructor(cfg: GatewayConfig) {
        this.cfg = cfg;
    }

    start() {
        this.stopped = false;
        this.poll();
        this.heartbeatTimer = setInterval(() => this.updateHeartbeats(), this.cfg.worker.heartbeatIntervalMs);
    }

    stop(): Promise<void> {
        this.stopped = true;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        for (const [, entry] of this.runningTasks) {
            entry.shutdown = true;
            entry.controller.abort();
            entry.server.close();
        }
        return Promise.resolve();
    }

    getRunningTaskIds(): number[] {
        return [...this.runningTasks.keys()];
    }

    getRunningCount(): number {
        return this.runningTasks.size;
    }

    private poll() {
        if (this.stopped) return;
        this.tryDispatch().then(() => {
            if (this.stopped) return;
            this.pollTimer = setTimeout(() => this.poll(), this.cfg.worker.pollIntervalMs);
        });
    }

    private async tryDispatch() {
        while (!this.stopped && this.runningTasks.size < this.cfg.worker.maxConcurrency) {
            try {
                const excludedBatchIds = [...this.activeBatchIds];
                const task = await TaskService.next({ excludedBatchIds });
                if (!task) break;

                if (!await TaskService.start(task.id)) continue;

                if (task.batchId) {
                    this.activeBatchIds.add(task.batchId);
                }

                const run = await TaskRunService.create({
                    taskId: task.id,
                    model: this.resolveModel(task.model),
                    status: 'running',
                });

                const controller = new AbortController();
                const server = await spawnOpencodeServer(task.cwd, controller.signal, 30000);

                const auth = this.getServerAuth();
                const client = createOpencodeClient({
                    baseUrl: server.url,
                    headers: auth ? { Authorization: auth } : undefined,
                });

                await TaskRunService.updatePid(run.id, process.pid, 0);

                const entry: RunningTask = {
                    task,
                    runId: run.id,
                    controller,
                    server,
                    startedAt: Date.now(),
                    shutdown: false,
                };
                this.runningTasks.set(task.id, entry);

                this.executeTask(task, run.id, client, server, controller).catch((err) => {
                    console.error(JSON.stringify({
                        ts: new Date().toISOString(),
                        level: 'error',
                        msg: 'task execution unhandled error',
                        taskId: task.id,
                        error: err instanceof Error ? err.message : String(err),
                    }));
                });
            } catch (err) {
                console.error(JSON.stringify({
                    ts: new Date().toISOString(),
                    level: 'error',
                    msg: 'tryDispatch iteration failed',
                    error: err instanceof Error ? err.message : String(err),
                }));
                break;
            }
        }
    }

    private async executeTask(
        task: Task,
        runId: number,
        client: any,
        server: { close(): void },
        controller: AbortController,
    ) {
        let sessionId: string = '';
        try {
            const session = await client.session.create({
                body: { title: `[OC - Task #${task.id}] ${task.name}` },
                query: { directory: task.cwd || undefined },
            });
            sessionId = session.data.id;
            await TaskRunService.updateSessionId(runId, sessionId);
            console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'session created', taskId: task.id, sessionId }));

            const promptResult = await client.session.prompt({
                body: {
                    parts: [{ type: 'text' as const, text: task.prompt }],
                    agent: task.agent,
                    model: this.parseModel(task.model),
                },
                path: { id: sessionId },
            });
            console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'prompt returned', taskId: task.id, hasData: !!promptResult.data }));

            let output = '';
            let modelError: string | null = null;

            const messages = await client.session.messages({ path: { id: sessionId } });
            const messagesJson = messages.data ? JSON.stringify(messages.data) : null;

            const toolsUsed = new Set<string>();
            const skillsUsed = new Set<string>();
            let inputTokens = 0, outputTokens = 0, totalTokens = 0;
            let costUsd = 0;
            if (messages.data) {
                for (const msg of messages.data) {
                    if (msg.info?.role === 'assistant') {
                        if (msg.info.error) {
                            const err = msg.info.error as Record<string, unknown>;
                            const errData = err.data as Record<string, unknown> | undefined;
                            modelError = `Model error: ${err.name || 'UnknownError'} — ${errData?.message || JSON.stringify(err)}`;
                        }
                        const t = msg.info.tokens as Record<string, unknown> | undefined;
                        if (t) {
                            inputTokens += Number(t.input ?? 0);
                            outputTokens += Number(t.output ?? 0);
                            totalTokens += Number(t.total ?? 0);
                        }
                        if (typeof msg.info.cost === 'number') {
                            costUsd += msg.info.cost;
                        }
                        for (const part of msg.parts || []) {
                            if (part.type === 'text' && (part as any).text) {
                                output += (part as any).text as string;
                            }
                            if (part.type === 'tool') {
                                const toolName = (part as any).tool as string;
                                if (toolName === 'skill') {
                                    const name = (part as any).state?.input?.name as string | undefined;
                                    if (name) skillsUsed.add(name);
                                } else {
                                    toolsUsed.add(toolName);
                                }
                            }
                        }
                    }
                }
            }

            if (toolsUsed.size > 0) {
                const tools = [...toolsUsed].sort();
                await TaskRunService.updateToolsUsed(runId, tools);
                console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'tools used', taskId: task.id, tools }));
            }
            if (skillsUsed.size > 0) {
                const skills = [...skillsUsed].sort();
                await TaskRunService.updateSkillsUsed(runId, skills);
                console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'skills used', taskId: task.id, skills }));
            }
            if (totalTokens > 0 || costUsd > 0) {
                await TaskRunService.updateUsage(runId, inputTokens, outputTokens, totalTokens, costUsd);
                console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'usage recorded', taskId: task.id, inputTokens, outputTokens, totalTokens, costUsd }));
            }

            if (modelError) {
                await TaskRunService.fail(runId, modelError, messagesJson ?? undefined);
                await TaskService.fail(task.id, modelError);
                task.resultLog = modelError;
                notifyTask(task, 'failed', this.cfg.notifications, this.cfg.dashboard.port).catch((err) => {
                    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'notification failed', taskId: task.id, error: err instanceof Error ? err.message : String(err) }));
                });
                console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'task model error', taskId: task.id, error: modelError }));
            } else {
                const resultLog = output.trim().slice(-8000) || '[no text output captured]';
                await TaskRunService.done(runId, resultLog, messagesJson ?? undefined);
                await TaskService.done(task.id, resultLog);
                task.resultLog = resultLog;
                notifyTask(task, 'done', this.cfg.notifications, this.cfg.dashboard.port).catch((err) => {
                    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'notification failed', taskId: task.id, error: err instanceof Error ? err.message : String(err) }));
                });
                console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'task done', taskId: task.id }));
            }

        } catch (err) {
            if (controller.signal.aborted) return;

            const errorMsg = err instanceof Error ? err.message : String(err);
            await TaskRunService.fail(runId, errorMsg);
            const currentStatus = await TaskService.getById(task.id);
            if (currentStatus?.status === 'running') {
                await TaskService.fail(task.id, 'SDK execution error: ' + errorMsg);
            }
            task.resultLog = 'SDK execution error: ' + errorMsg;
            notifyTask(task, 'failed', this.cfg.notifications, this.cfg.dashboard.port).catch((notifyErr) => {
                console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'notification failed', taskId: task.id, error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr) }));
            });
            console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'task failed', taskId: task.id, error: errorMsg }));
        } finally {
            server.close();
            this.runningTasks.delete(task.id);
            if (task.batchId) this.activeBatchIds.delete(task.batchId);
        }
    }

    private async updateHeartbeats() {
        for (const [, entry] of this.runningTasks) {
            try {
                await TaskRunService.heartbeat(entry.runId);
            } catch {}
        }
    }

    private parseModel(taskModel: string | null): { providerID: string; modelID: string } | undefined {
        const resolved = (!taskModel || taskModel === 'default') ? readDefaultModel() : taskModel;
        if (!resolved) return undefined;
        const slashIdx = resolved.indexOf('/');
        if (slashIdx === -1) return undefined;
        return {
            providerID: resolved.substring(0, slashIdx),
            modelID: resolved.substring(slashIdx + 1),
        };
    }

    private resolveModel(taskModel: string | null): string | null {
        if (!taskModel || taskModel === 'default') return readDefaultModel();
        return taskModel;
    }

    private getServerAuth(): string | null {
        const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
        const pass = process.env.OPENCODE_SERVER_PASSWORD;
        if (!pass) return null;
        return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    }
}
