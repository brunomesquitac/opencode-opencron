// task table schema
// stores the general-purpose AI Agent task queue

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
    id: integer('id').primaryKey({ autoIncrement: true }),

    // task configuration
    name: text('name').notNull(),
    agent: text('agent').notNull(),
    model: text('model').default('default'),
    prompt: text('prompt').notNull(),
    cwd: text('cwd'),

    // category and priority
    category: text('category').default('general'),
    importance: integer('importance').default(3),
    urgency: integer('urgency').default(3),

    // task grouping and dependencies
    batchId: text('batch_id'),
    dependsOn: integer('depends_on'),

    // status
    status: text('status').default('pending'),

    // timestamps (legacy fields use second-level timestamp)
    createdAt: integer('created_at', { mode: 'timestamp' })
        .$defaultFn(() => new Date()),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    finishedAt: integer('finished_at', { mode: 'timestamp' }),

    // execution result
    resultLog: text('result_log'),
    retryCount: integer('retry_count').default(0),
    maxRetries: integer('max_retries').default(3),

    // Gateway extension fields (milliseconds)
    retryAfter: integer('retry_after'),
    timeoutMs: integer('timeout_ms'),
    templateId: integer('template_id'),
    scheduledAt: integer('scheduled_at'),

    // Notification channels override (JSON)
    notifyOn: text('notify_on'),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'dead_letter' | 'cancelled';

export const TASK_CATEGORIES = [
    'translate',
    'generate',
    'review',
    'test',
    'general',
] as const;

export const taskRuns = sqliteTable('task_runs', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: integer('task_id').notNull().references(() => tasks.id),

    sessionId: text('session_id'),
    model: text('model'),
    status: text('status').default('running'),

    startedAt: integer('started_at', { mode: 'timestamp' })
        .$defaultFn(() => new Date()),
    finishedAt: integer('finished_at', { mode: 'timestamp' }),

    log: text('log'),
    messagesJson: text('messages_json'),

    // Gateway runtime fields (milliseconds)
    lockedAt: integer('locked_at'),
    lockedBy: text('locked_by'),
    heartbeatAt: integer('heartbeat_at'),
    workerPid: integer('worker_pid'),
    childPid: integer('child_pid'),

    toolsUsed: text('tools_used'),
    skillsUsed: text('skills_used'),

    // Token and cost
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    costUsd: real('cost_usd'),
});

export type TaskRun = typeof taskRuns.$inferSelect;
export type NewTaskRun = typeof taskRuns.$inferInsert;
export type TaskRunStatus = 'running' | 'done' | 'failed';

export const taskTemplates = sqliteTable('task_templates', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    agent: text('agent').notNull(),
    model: text('model').default('default'),
    prompt: text('prompt').notNull(),
    cwd: text('cwd'),
    category: text('category').default('general'),
    importance: integer('importance').default(3),
    urgency: integer('urgency').default(3),

    scheduleType: text('schedule_type').notNull(),
    cronExpr: text('cron_expr'),
    intervalMs: integer('interval_ms'),
    runAt: integer('run_at'),

    maxInstances: integer('max_instances').default(1),
    maxRetries: integer('max_retries').default(3),
    retryBackoffMs: integer('retry_backoff_ms').default(30000),
    lastRunAt: integer('last_run_at'),
    nextRunAt: integer('next_run_at'),
    enabled: integer('enabled', { mode: 'boolean' }).default(true),

    createdAt: integer('created_at').default(0),
    updatedAt: integer('updated_at').default(0),

    notifyOn: text('notify_on'),
});

export type TaskTemplate = typeof taskTemplates.$inferSelect;
export type NewTaskTemplate = typeof taskTemplates.$inferInsert;
export type ScheduleType = 'cron' | 'delayed' | 'recurring';
