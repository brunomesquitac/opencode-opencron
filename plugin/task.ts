/**
 * OpenCode task management plugin
 *
 * [Input]: Task config (name, agent, prompt, etc.)
 * [Output]: Task status, execution results
 * [Purpose]: Manage AI Agent task queue via task_* tools
 */

import { type Plugin, tool } from "@opencode-ai/plugin";
import { TaskService } from "@core/services/task.service";
import { closeDb } from "@core/db";

export const TaskPlugin: Plugin = async () => {
    return {
        tool: {
            // create task
            task_add: tool({
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
                        // record the working directory at task submission time (i.e. the opencode process startup directory)
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
            task_next: tool({
                description:
                    "Get the next pending task. Sorted by importance x urgency descending. Automatically skips tasks with unmet dependencies.",
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
            task_start: tool({
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

            // complete task
            task_done: tool({
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
            task_fail: tool({
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
            task_status: tool({
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
            task_retry: tool({
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
        },
    };
};
