import { basename } from 'path';
import type { NotificationPayload } from '@gateway/channels/channel.interface';
import type { Task } from '@core/db/schema';

export function buildPayload(task: Task, event: NotificationPayload['event'], dashboardPort?: number): NotificationPayload {
    const duration = task.startedAt && task.finishedAt
        ? formatDurationMs(task.finishedAt.getTime() - task.startedAt.getTime())
        : undefined;

    // Show only the last folder name to avoid huge paths in notifications
    const cwd = task.cwd ? basename(task.cwd) || task.cwd : undefined;

    return {
        event,
        task: {
            id: task.id,
            name: task.name,
            agent: task.agent,
            status: task.status ?? 'unknown',
            category: task.category ?? 'general',
            importance: task.importance ?? 3,
            urgency: task.urgency ?? 3,
        },
        result: task.resultLog?.slice(0, 4000) ?? '',
        duration,
        error: event !== 'done' ? (task.resultLog?.slice(0, 1000) ?? 'Unknown error') : undefined,
        dashboardUrl: dashboardPort ? `http://localhost:${dashboardPort}` : undefined,
        cwd,
    };
}

function formatDurationMs(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 0) return '0s';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
}
