import { TaskService } from '@core/services/task.service';
import { TaskRunService } from '@core/services/task-run.service';
import type { GatewayConfig } from '@gateway/config';
import type { Task } from '@core/db/schema';
import { createOpencodeServer, createOpencodeClient } from '@opencode-ai/sdk';

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
    private cfg: GatewayConfig['worker'];

    constructor(cfg: GatewayConfig) {
        this.cfg = cfg.worker;
    }

    start() {
        this.stopped = false;
        this.poll();
        this.heartbeatTimer = setInterval(() => this.updateHeartbeats(), this.cfg.heartbeatIntervalMs);
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
            this.pollTimer = setTimeout(() => this.poll(), this.cfg.pollIntervalMs);
        });
    }

    private async tryDispatch() {
        while (!this.stopped && this.runningTasks.size < this.cfg.maxConcurrency) {
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
                const server = await createOpencodeServer({
                    timeout: 30000,
                    port: 0,
                    signal: controller.signal,
                });

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
                body: { title: task.name },
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
            if (messages.data) {
                for (const msg of messages.data) {
                    if (msg.info?.role === 'assistant') {
                        if (msg.info.error) {
                            const err = msg.info.error as Record<string, unknown>;
                            const errData = err.data as Record<string, unknown> | undefined;
                            modelError = `Model error: ${err.name || 'UnknownError'} — ${errData?.message || JSON.stringify(err)}`;
                        }
                        for (const part of msg.parts || []) {
                            if (part.type === 'text' && (part as any).text) {
                                output += (part as any).text as string;
                            }
                        }
                    }
                }
            }

            if (modelError) {
                await TaskRunService.fail(runId, modelError, messagesJson ?? undefined);
                await TaskService.fail(task.id, modelError);
                console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'task model error', taskId: task.id, error: modelError }));
            } else {
                const resultLog = output.trim().slice(-8000) || '[no text output captured]';
                await TaskRunService.done(runId, resultLog, messagesJson ?? undefined);
                await TaskService.done(task.id, resultLog);
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
        if (!taskModel || taskModel === 'default') return undefined;
        const slashIdx = taskModel.indexOf('/');
        if (slashIdx === -1) return undefined;
        return {
            providerID: taskModel.substring(0, slashIdx),
            modelID: taskModel.substring(slashIdx + 1),
        };
    }

    private resolveModel(taskModel: string | null): string | null {
        if (!taskModel || taskModel === 'default') return null;
        return taskModel;
    }

    private getServerAuth(): string | null {
        const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
        const pass = process.env.OPENCODE_SERVER_PASSWORD;
        if (!pass) return null;
        return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    }
}
