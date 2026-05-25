import type { NotificationPayload, ChannelName, ChannelHandler, NotificationsConfig, TaskNotifyOn, SendResult } from '@gateway/channels/channel.interface';
import { telegramChannel } from '@gateway/channels/telegram.channel';
import { discordChannel } from '@gateway/channels/discord.channel';
import { slackChannel } from '@gateway/channels/slack.channel';
import { emailChannel } from '@gateway/channels/email.channel';
import { webhookChannel } from '@gateway/channels/webhook.channel';
import type { Task } from '@core/db/schema';
import { buildPayload } from './templates';

const CHANNELS: Record<ChannelName, ChannelHandler> = {
    telegram: telegramChannel,
    discord: discordChannel,
    slack: slackChannel,
    email: emailChannel,
    webhook: webhookChannel,
};

function resolveEventChannels(
    event: NotificationPayload['event'],
    taskNotifyOn: TaskNotifyOn | null,
    config: NotificationsConfig,
): ChannelName[] {
    const eventKey = event === 'done' ? 'on_success'
        : event === 'failed' ? 'on_failure'
        : 'on_dead_letter';

    const source = taskNotifyOn ?? config.defaults;
    return source[eventKey] ?? [];
}

function getChannelConfig(channelName: ChannelName, config: NotificationsConfig): Record<string, unknown> {
    if (config.channels[channelName]) {
        return expandEnvVars(config.channels[channelName]!);
    }
    return {};
}

function expandEnvVars(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
            result[key] = expandEnvVar(value);
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            result[key] = expandEnvVars(value as Record<string, unknown>);
        } else {
            result[key] = value;
        }
    }
    return result;
}

function expandEnvVar(value: string): string {
    return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
        const envValue = process.env[varName];
        if (envValue === undefined) {
            console.error(JSON.stringify({
                ts: new Date().toISOString(),
                level: 'warn',
                msg: 'env var not found for notification config',
                varName,
            }));
            return '';
        }
        return envValue;
    });
}

export function getActiveChannels(config: NotificationsConfig): ChannelName[] {
    const active: ChannelName[] = [];
    for (const [name, channelConfig] of Object.entries(config.channels)) {
        const resolved = expandEnvVars(channelConfig);
        const channelName = name as ChannelName;
        const handler = CHANNELS[channelName];
        if (handler && hasCredentials(channelName, resolved)) {
            active.push(channelName);
        }
    }
    return active;
}

function hasCredentials(channelName: ChannelName, config: Record<string, unknown>): boolean {
    switch (channelName) {
        case 'telegram': return !!(config.botToken && config.chatId);
        case 'discord': return !!(config.webhookUrl);
        case 'slack': return !!(config.webhookUrl);
        case 'email': return !!(config.host && config.user && config.pass);
        case 'webhook': return !!(config.url);
        default: return false;
    }
}

async function healthCheckChannel(channelName: ChannelName, config: NotificationsConfig): Promise<{ name: ChannelName; healthy: boolean; error?: string }> {
    const handler = CHANNELS[channelName];
    const channelConfig = config.channels[channelName];
    if (!channelConfig) {
        return { name: channelName, healthy: false, error: 'not configured' };
    }
    const resolved = expandEnvVars(channelConfig);
    if (!hasCredentials(channelName, resolved)) {
        return { name: channelName, healthy: false, error: 'missing credentials' };
    }
    try {
        const healthy = await handler.healthCheck(resolved);
        return { name: channelName, healthy, error: healthy ? undefined : 'health check failed' };
    } catch (err) {
        return { name: channelName, healthy: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export async function sendTestNotification(
    channelName: ChannelName,
    config: NotificationsConfig,
): Promise<SendResult> {
    const handler = CHANNELS[channelName];
    const channelConfig = config.channels[channelName];
    if (!channelConfig) {
        return { ok: false, error: 'channel not configured' };
    }
    const resolved = expandEnvVars(channelConfig);

    const testPayload: NotificationPayload = {
        event: 'done',
        task: {
            id: 0,
            name: 'Test Notification',
            agent: 'opencron',
            status: 'done',
            category: 'general',
            importance: 3,
            urgency: 3,
        },
        result: 'This is a test notification from OpenCron. If you see this, the channel is configured correctly.',
        duration: '0s',
        dashboardUrl: undefined,
    };

    return handler.send(testPayload, resolved);
}

export async function notifyTask(
    task: Task,
    event: NotificationPayload['event'],
    config: NotificationsConfig,
    dashboardPort?: number,
): Promise<void> {
    if (!config.enabled) return;

    let taskNotifyOn: TaskNotifyOn | null = null;
    if (task.notifyOn) {
        try {
            taskNotifyOn = JSON.parse(task.notifyOn) as TaskNotifyOn;
        } catch {
            console.error(JSON.stringify({
                ts: new Date().toISOString(),
                level: 'error',
                msg: 'failed to parse notify_on',
                taskId: task.id,
                notifyOn: task.notifyOn,
            }));
        }
    }

    const channels = resolveEventChannels(event, taskNotifyOn, config);
    if (channels.length === 0) return;

    const payload = buildPayload(task, event, dashboardPort);

    console.log(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        msg: 'sending notifications',
        taskId: task.id,
        event,
        channels,
    }));

    const results = await Promise.allSettled(
        channels.map(async (channelName) => {
            const handler = CHANNELS[channelName];
            const channelConfig = getChannelConfig(channelName, config);
            const result = await handler.send(payload, channelConfig);
            return { channel: channelName, ...result };
        }),
    );

    for (const res of results) {
        if (res.status === 'fulfilled') {
            if (!res.value.ok) {
                console.error(JSON.stringify({
                    ts: new Date().toISOString(),
                    level: 'error',
                    msg: 'notification channel failed',
                    taskId: task.id,
                    channel: res.value.channel,
                    error: res.value.error,
                }));
            } else {
                console.log(JSON.stringify({
                    ts: new Date().toISOString(),
                    level: 'info',
                    msg: 'notification sent',
                    taskId: task.id,
                    channel: res.value.channel,
                }));
            }
        } else {
            console.error(JSON.stringify({
                ts: new Date().toISOString(),
                level: 'error',
                msg: 'notification channel rejected',
                taskId: task.id,
                error: res.reason instanceof Error ? res.reason.message : String(res.reason),
            }));
        }
    }
}

export async function healthCheckAll(config: NotificationsConfig): Promise<Array<{ name: ChannelName; healthy: boolean; error?: string }>> {
    const results = await Promise.all(
        ([...Object.keys(CHANNELS)] as ChannelName[]).map(name => healthCheckChannel(name, config)),
    );
    return results;
}

export { CHANNELS };
