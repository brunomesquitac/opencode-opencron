/**
 * OpenCode opencron task management plugin
 *
 * [Input]: Task config (name, agent, prompt, etc.)
 * [Output]: Task status, execution results
 * [Purpose]: Manage AI Agent task queue via opencron_* tools
 */

import { type Plugin, type Hooks, tool } from "@opencode-ai/plugin";
import { TaskService } from "@core/services/task.service";
import { TaskTemplateService } from "@core/services/task-template.service";
import { getDb, sqlite } from "@core/db";
import { parseDuration } from "@core/duration";
import { ensureGateway, upgrade as pm2Upgrade } from "../src/daemon/pm2";
import { homedir } from "os";

let _initialized = false;

function ensureInit() {
    if (_initialized) return;
    _initialized = true;

    try {
        getDb();
    } catch (err) {
        console.error("[opencron] DB init failed:", err instanceof Error ? err.message : String(err));
        return;
    }

    try {
        const lockRow = sqlite.prepare("SELECT pid, heartbeat_at FROM gateway_lock WHERE id = 1").get() as
            | { pid: number; heartbeat_at: number }
            | undefined;

        if (lockRow && Date.now() - lockRow.heartbeat_at < 30_000) {
            return;
        }
    } catch {}

    try {
        ensureGateway();
    } catch {}
}

const RUNNER_PROMPT = `You are the **opencron task executor**.

## Workflow

### 1. Fetch Task

- If user input contains \`execute task ID: <number>\`, use \`opencron_get(id)\` to fetch that task
- Otherwise use \`opencron_next\` to get the next pending task
- If no task is available, report "queue is empty" and finish

### 2. Mark Start

- If task status is \`pending\`, call \`opencron_start(id)\` to mark as running
- If already \`running\` (already marked by Worker), skip this step

### 3. Execute Task

Execute the sub-agent using the Bash tool, **must include timeout parameter**:

**Tool call format**:
\`\`\`
Bash(
  command: "opencode run --agent \\"<task.agent>\\" -m \\"<model>\\" --format json \\"<task.prompt>\\"",
  workdir: "<task.cwd>",
  timeout: 3600000
)
\`\`\`

- **command**: command to execute the sub-agent
- **workdir**: use \`task.cwd\` (or current directory if empty)
- **model**: parse \`OVERRIDE_MODEL=xxx\` from user input and use as \`-m\` parameter; omit \`-m\` if not found
- **timeout**: **must be set to 3600000 (60 minutes)**
- **safety check**: if \`task.agent\` is \`opencron-runner\`, immediately fail and finish (prevents recursion)

### 4. Evaluate Result and Update Status

Check the sub-agent's output to determine if the task was completed successfully:

- **Success**: sub-agent completed the required work → call \`opencron_done(id, "brief completion description")\`
- **Failure**: sub-agent errored, refused, explicitly said it cannot complete, or clearly did not finish → call \`opencron_fail(id, "failure reason")\`

Use your judgment; no rigid rules needed.

## Notes

1. You are a scheduler, do not execute tasks yourself — must use Bash to call \`opencode run\`
2. Pass \`task.prompt\` in full, do not modify it
3. Process one task at a time, finish before stopping`;

const SYSTEM_INSTRUCTION = `
## opencron task queue system

The opencron task queue plugin is installed. You can manage tasks using the following tools:

### Core Workflow

1. **Create task**: use \`opencron_add\` to add a task to the queue; Gateway will dispatch automatically
2. **Check status**: use \`opencron_status\` to view queue statistics, \`opencron_list\` to list tasks
3. **Retry/Manage**: use \`opencron_retry\` to retry failed tasks, \`opencron_get\` to view details

### When to Use

- When the user says "create a task", "schedule this", or similar, use \`opencron_add\` or \`opencron_schedule\`
- When the user asks "how are my tasks going", use \`opencron_status\` and \`opencron_list\`
- When the user says "retry failed tasks", use \`opencron_retry\`

### Schedule Templates

Use \`opencron_schedule\` to create three types of scheduled tasks:
- \`cron\`: cron expression (e.g. "0 9 * * 1-5" = weekdays at 9 AM)
- \`recurring\`: fixed interval loop (e.g. every 6 hours)
- \`delayed\`: one-time delayed execution
`;

export const opencronPlugin: Plugin = async () => {
    return {
        async config(cfg) {
            cfg.agent = cfg.agent ?? {};
            cfg.agent["opencron-runner"] = {
                description: "opencron task executor - fetches tasks from the queue and dispatches them to sub-agents",
                mode: "all",
                hidden: true,
                prompt: RUNNER_PROMPT,
                temperature: 0.3,
                permission: {
                    bash: "allow",
                },
            };

            ensureInit();
        },

        async "experimental.chat.system.transform"(input, output) {
            output.system.push(SYSTEM_INSTRUCTION);
        },

        tool: {
            // create task
            opencron_add: tool({
                description:
                    "Create a new task in the queue. Returns the task ID. Tasks are sorted by priority (importance x urgency).",
                args: {
                    name: tool.schema.string().describe("Task name (human-readable)"),
                    agent: tool.schema.string().describe("Agent name to execute, e.g. localize-gen, course-gen"),
                    prompt: tool.schema.string().describe("Full prompt to send to the agent"),
                    model: tool.schema.string().optional().describe("Model to use, e.g. gemini-2.5-pro"),
                    category: tool.schema.string().optional().describe("Task category: translate/generate/review/test/general"),
                    importance: tool.schema.number().optional().describe("Importance 1-5 (5 = most important)"),
                    urgency: tool.schema.number().optional().describe("Urgency 1-5 (5 = most urgent)"),
                    batchId: tool.schema.string().optional().describe("Batch ID for grouping"),
                    dependsOn: tool.schema.number().optional().describe("Dependency task ID; will only execute after this task completes"),
                    cwd: tool.schema
                        .string()
                        .optional()
                        .describe(
                            "(deprecated) Working directory. The opencode run startup directory is auto-recorded."
                        ),
                },
                async execute(args) {
                    try {
                        const submitCwd = process.cwd();

                        const task = await TaskService.add({
                            name: args.name,
                            agent: args.agent,
                            prompt: args.prompt,
                            model: args.model,
                            category: args.category ?? "general",
                            importance: args.importance ?? 3,
                            urgency: args.urgency ?? 3,
                            batchId: args.batchId,
                            dependsOn: args.dependsOn,
                            cwd: submitCwd,
                        });
                        return JSON.stringify({ id: task.id, status: "created" });
                    } catch (error) {
                        return JSON.stringify({
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                },
            }),

            // get next task
            opencron_next: tool({
                description:
                    "Get the next pending task. Prioritizes retryable failed tasks (retryCount < maxRetries), then pending tasks, both sorted by creation time ascending. Automatically skips tasks with unmet dependencies.",
                args: {
                    cwd: tool.schema
                        .string()
                        .optional()
                        .describe("Project isolation: pass the current working directory to scope results to that project"),
                },
                async execute(args) {
                    try {
                        const scopeCwd = args.cwd ?? process.cwd();
                        const task = await TaskService.next({ cwd: scopeCwd });
                        if (task) {
                            return JSON.stringify({
                                id: task.id,
                                name: task.name,
                                agent: task.agent,
                                model: task.model,
                                prompt: task.prompt,
                                cwd: task.cwd,
                                category: task.category,
                                importance: task.importance,
                                urgency: task.urgency,
                            });
                        } else {
                            return JSON.stringify({ id: null, message: "No pending tasks" });
                        }
                    } catch (error) {
                        return JSON.stringify({
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                },
            }),

            // start task execution
            opencron_start: tool({
                description: "Mark a task as running. Records the start time.",
                args: {
                    id: tool.schema.number().describe("Task ID"),
                    cwd: tool.schema
                        .string()
                        .optional()
                        .describe("Project isolation: pass the current working directory to scope the operation to that project"),
                },
                async execute(args) {
                    try {
                        const scopeCwd = args.cwd ?? process.cwd();
                        const task = await TaskService.start(args.id, { cwd: scopeCwd });
                        if (task) return JSON.stringify({ id: task.id, status: task.status });

                        // start() only transitions pending -> running.
                        // When null is returned, distinguish between: task not found vs task exists but status does not allow start.
                        const existing = await TaskService.getById(args.id, { cwd: scopeCwd });
                        if (!existing) return JSON.stringify({ error: "Task not found" });

                        return JSON.stringify({
                            error: "Task status does not allow start",
                            id: existing.id,
                            status: existing.status,
                            message: `Only pending tasks can be started; current status is '${existing.status}'.`,
                        });
                    } catch (error) {
                        return JSON.stringify({
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                },
            }),

            // complete task
            opencron_done: tool({
                description: "Mark a task as done. Records the end time and result log.",
                args: {
                    id: tool.schema.number().describe("Task ID"),
                    log: tool.schema.string().optional().describe("Execution result log"),
                    cwd: tool.schema
                        .string()
                        .optional()
                        .describe("Project isolation: pass the current working directory to scope the operation to that project"),
                },
                async execute(args) {
                    try {
                        const scopeCwd = args.cwd ?? process.cwd();
                        const task = await TaskService.done(args.id, args.log, { cwd: scopeCwd });
                        if (task) {
                            return JSON.stringify({ id: task.id, status: task.status });
                        } else {
                            return JSON.stringify({ error: "Task not found" });
                        }
                    } catch (error) {
                        return JSON.stringify({
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                },
            }),

            // task failed
            opencron_fail: tool({
                description: "Mark a task as failed. Records the error log and increments retry count.",
                args: {
                    id: tool.schema.number().describe("Task ID"),
                    log: tool.schema.string().optional().describe("Error log"),
                    cwd: tool.schema
                        .string()
                        .optional()
                        .describe("Project isolation: pass the current working directory to scope the operation to that project"),
                },
                async execute(args) {
                    try {
                        const scopeCwd = args.cwd ?? process.cwd();
                        const task = await TaskService.fail(args.id, args.log, { cwd: scopeCwd });
                        if (task) {
                            return JSON.stringify({
                                id: task.id,
                                status: task.status,
                                retryCount: task.retryCount,
                            });
                        } else {
                            return JSON.stringify({ error: "Task not found" });
                        }
                    } catch (error) {
                        return JSON.stringify({
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                },
            }),

            // view statistics
            opencron_status: tool({
                description: "View task queue statistics. Can be filtered by batch.",
                args: {
                    batchId: tool.schema.string().optional().describe("Filter by batch ID"),
                    cwd: tool.schema
                        .string()
                        .optional()
                        .describe("Project isolation: pass the current working directory to scope stats to that project"),
                },
                async execute(args) {
                    try {
                        const scopeCwd = args.cwd ?? process.cwd();
                        const stats = await TaskService.stats({ batchId: args.batchId, cwd: scopeCwd });
                        return JSON.stringify(stats);
                    } catch (error) {
                        return JSON.stringify({
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                },
            }),

            // retry failed tasks
            opencron_retry: tool({
                description:
                    "Retry a failed task. Resets status from failed to pending, clears start/end times.",
                args: {
                    id: tool.schema.number().optional().describe("Task ID"),
                    batchId: tool.schema.string().optional().describe("Batch ID (batch retry)"),
                    cwd: tool.schema
                        .string()
                        .optional()
                        .describe("Project isolation: pass the current working directory to scope the operation to that project"),
                },
                async execute(args) {
                    try {
                        const scopeCwd = args.cwd ?? process.cwd();
                        if (args.id !== undefined) {
                            const task = await TaskService.retry(args.id, { cwd: scopeCwd });
                            if (task) {
                                return JSON.stringify({ id: task.id, status: task.status });
                            } else {
                                return JSON.stringify({ error: "Task not found or not failed" });
                            }
                        } else if (args.batchId !== undefined) {
                            const count = await TaskService.retryBatch(args.batchId, { cwd: scopeCwd });
                            return JSON.stringify({ retried: count, batchId: args.batchId });
                        } else {
                            return JSON.stringify({ error: "Please specify id or batchId" });
                        }
                    } catch (error) {
                        return JSON.stringify({
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                },
            }),

            // list recent tasks
            opencron_list: tool({
                description: "List recent tasks, sorted by creation time descending. Supports status filtering.",
                args: {
                    status: tool.schema
                        .string()
                        .optional()
                        .describe("Filter by status: pending/running/done/failed/cancelled"),
                    limit: tool.schema.number().optional().describe("Number of results, default 20"),
                    cwd: tool.schema
                        .string()
                        .optional()
                        .describe("Project isolation: pass the current working directory to scope results to that project"),
                },
                async execute(args) {
                    try {
                        const scopeCwd = args.cwd ?? process.cwd();
                        const tasks = await TaskService.list({
                            status: args.status as import("@core/db/schema").TaskStatus | undefined,
                            cwd: scopeCwd,
                            limit: args.limit ?? 20,
                        });
                        return JSON.stringify(tasks);
                    } catch (error) {
                        return JSON.stringify({
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                },
            }),

            // get task details by ID
            opencron_get: tool({
                description: "Get task details by ID.",
                args: {
                    id: tool.schema.number().describe("Task ID"),
                    cwd: tool.schema
                        .string()
                        .optional()
                        .describe("Project isolation: pass the current working directory to scope results to that project"),
                },
                async execute(args) {
                    try {
                        const scopeCwd = args.cwd ?? process.cwd();
                        const task = await TaskService.getById(args.id, { cwd: scopeCwd });
                        if (task) {
                            return JSON.stringify({
                                id: task.id,
                                name: task.name,
                                agent: task.agent,
                                model: task.model,
                                prompt: task.prompt,
                                cwd: task.cwd,
                                category: task.category,
                                status: task.status,
                            });
                        } else {
                            return JSON.stringify({ error: "Task not found" });
                        }
                    } catch (error) {
                        return JSON.stringify({
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                },
            }),

            // create schedule template
            opencron_schedule: tool({
                description:
                    "Create a schedule template for cron/delayed/recurring task execution. Supports cron expressions, one-time delays, and fixed-interval loops. Gateway will auto-generate tasks from the template.",
                args: {
                    name: tool.schema.string().describe("Template name"),
                    agent: tool.schema.string().describe("Agent name to execute"),
                    prompt: tool.schema.string().describe("Full prompt to send to the agent"),
                    model: tool.schema.string().optional().describe("Model to use"),
                    category: tool.schema.string().optional().describe("Task category: translate/generate/review/test/general"),
                    importance: tool.schema.number().optional().describe("Importance 1-5"),
                    urgency: tool.schema.number().optional().describe("Urgency 1-5"),
                    batchId: tool.schema.string().optional().describe("Batch ID for tasks generated from this template"),
                    schedule: tool.schema
                        .object({
                            type: tool.schema.enum(["cron", "delayed", "recurring"]).describe("Schedule type"),
                            cron_expr: tool.schema.string().optional().describe("Cron expression (required for cron type, e.g. '0 9 * * 1-5')"),
                            delay: tool.schema.string().optional().describe("Delay duration (required for delayed type), friendly formats like '30s' '5min' '1h' '2d', also ISO 8601 duration like 'PT30M'"),
                            interval: tool.schema.string().optional().describe("Recurring interval (required for recurring type), friendly formats like '1h' '30min' '5s', also ISO 8601 duration like 'PT1H'"),
                        })
                        .describe("Schedule configuration"),
                    max_instances: tool.schema.number().optional().describe("Max concurrent instances, default 1"),
                    max_retries: tool.schema.number().optional().describe("Max retries cloned to tasks, default 3"),
                    retry_backoff_ms: tool.schema.number().optional().describe("Backoff base interval ms cloned to tasks, default 30000"),
                },
                async execute(args) {
                    try {
                        if (!args.schedule) {
                            return JSON.stringify({ error: "schedule is required" });
                        }
                        const scheduleType = args.schedule.type as import("@core/db/schema").ScheduleType;

                        let cronExpr = args.schedule.cron_expr;
                        let intervalMs: number | null = null;
                        let runAt: number | null = null;

                        if (scheduleType === "delayed" && args.schedule.delay) {
                            const delayMs = parseDuration(args.schedule.delay);
                            if (delayMs === null) {
                                return JSON.stringify({ error: `Invalid delay format: "${args.schedule.delay}". Use formats like "30s", "5min", "1h", "2d"` });
                            }
                            runAt = Date.now() + delayMs;
                        }

                        if (scheduleType === "recurring" && args.schedule.interval) {
                            intervalMs = parseDuration(args.schedule.interval);
                            if (intervalMs === null) {
                                return JSON.stringify({ error: `Invalid interval format: "${args.schedule.interval}". Use formats like "30s", "5min", "1h", "2d"` });
                            }
                        }

                        const tmpl = await TaskTemplateService.create({
                            name: args.name,
                            agent: args.agent,
                            prompt: args.prompt,
                            model: args.model,
                            category: args.category ?? "general",
                            importance: args.importance ?? 3,
                            urgency: args.urgency ?? 3,
                            scheduleType,
                            cronExpr,
                            intervalMs,
                            runAt,
                            maxInstances: args.max_instances,
                            maxRetries: args.max_retries,
                            retryBackoffMs: args.retry_backoff_ms,
                        });
                        return JSON.stringify({
                            id: tmpl.id,
                            status: "created",
                            scheduleType: tmpl.scheduleType,
                            nextRunAt: tmpl.nextRunAt,
                            enabled: tmpl.enabled,
                        });
                    } catch (error) {
                        return JSON.stringify({
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                },
            }),

            opencron_upgrade: tool({
                description:
                    "Upgrade the opencron plugin. Updates the npm package to the latest version, then restarts the Gateway process. Use when the user says 'upgrade plugin', 'update opencron', or 'upgrade'.",
                args: {},
                async execute() {
                    try {
                        const { spawnSync } = await import("child_process");
                        const configDir = `${homedir()}/.config/opencode`;

                        function resolveBin(name: string): string {
                            try { const r = Bun.which(name); if (r) return r; } catch {}
                            return name;
                        }
                        const npmPath = resolveBin(process.platform === "win32" ? "npm.cmd" : "npm");

                        console.log("[opencron] Updating npm package...");
                        try {
                            const r = spawnSync(npmPath, ["install", "opencode-opencron@latest"], {
                                cwd: configDir,
                                stdio: "pipe",
                                timeout: 60000,
                                windowsHide: true,
                            });
                            if (r.status !== 0) throw new Error(r.stderr?.toString() || "npm install failed");
                        } catch (npmErr) {
                            return JSON.stringify({
                                success: false,
                                error: `npm install failed: ${npmErr instanceof Error ? npmErr.message : String(npmErr)}`,
                                hint: "Try manually: cd ~/.config/opencode && npm install opencode-opencron@latest",
                            });
                        }

                        const result = pm2Upgrade();
                        return JSON.stringify({
                            success: true,
                            before: result.before,
                            after: result.after,
                            restarted: result.restarted,
                            message: `opencron upgraded from ${result.before ?? "unknown"} to ${result.after}, Gateway restarted. Please restart opencode to load the new plugin.`,
                        });
                    } catch (error) {
                        return JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                },
            }),
        },
    };
};
