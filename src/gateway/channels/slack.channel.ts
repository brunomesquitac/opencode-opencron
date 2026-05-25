import type { ChannelHandler, NotificationPayload, SendResult, SlackConfig } from './channel.interface';

const STATUS_EMOJI: Record<string, string> = {
    done: ':white_check_mark:',
    failed: ':x:',
    dead_letter: ':skull:',
};

const STATUS_COLORS: Record<string, string> = {
    done: '#238636',
    failed: '#da3633',
    dead_letter: '#d29922',
};

const STATUS_LABELS: Record<string, string> = {
    done: 'Completed',
    failed: 'Failed',
    dead_letter: 'Dead Letter',
};

export const slackChannel: ChannelHandler = {
    name: 'slack',

    async send(payload: NotificationPayload, config: Record<string, unknown>): Promise<SendResult> {
        const cfg = config as unknown as SlackConfig;
        const emoji = STATUS_EMOJI[payload.event] || ':information_source:';
        const statusLabel = STATUS_LABELS[payload.event] || payload.event;
        const color = STATUS_COLORS[payload.event] || '#8b949e';
        const resultPreview = payload.result.slice(0, 2800) || '[no output]';

        const blocks: Array<Record<string, unknown>> = [
            {
                type: 'header',
                text: { type: 'plain_text', text: `${emoji} OpenCron — Task ${statusLabel}`, emoji: true },
            },
            { type: 'divider' },
            {
                type: 'section',
                fields: [
                    { type: 'mrkdwn', text: `*Task:*\n${payload.task.name}` },
                    { type: 'mrkdwn', text: `*Agent:*\n${payload.task.agent}` },
                    { type: 'mrkdwn', text: `*Duration:*\n${payload.duration}` },
                    { type: 'mrkdwn', text: `*Category:*\n${payload.task.category}` },
                ],
            },
        ];

        if (payload.error) {
            blocks.push({
                type: 'section',
                text: { type: 'mrkdwn', text: `*Error:*\n\`\`\`${payload.error.slice(0, 2000)}\`\`\`` },
            });
        }

        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: `*Result:*\n\`\`\`${resultPreview}\`\`\`` },
        });

        if (payload.dashboardUrl) {
            blocks.push({
                type: 'section',
                text: { type: 'mrkdwn', text: `<${payload.dashboardUrl}|Open Dashboard>` },
            });
        }

        const attachments = [
            {
                color,
                footer: `Task #${payload.task.id} | Importance: ${'★'.repeat(payload.task.importance)} | Urgency: ${'★'.repeat(payload.task.urgency)}`,
                ts: Math.floor(Date.now() / 1000),
            },
        ];

        try {
            const response = await fetch(cfg.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ blocks, attachments }),
            });

            if (!response.ok) {
                const errBody = await response.text();
                return { ok: false, error: `Slack webhook ${response.status}: ${errBody}` };
            }

            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    },

    async healthCheck(config: Record<string, unknown>): Promise<boolean> {
        const cfg = config as unknown as SlackConfig;
        if (!cfg.webhookUrl) return false;
        try {
            const response = await fetch(cfg.webhookUrl, { method: 'HEAD' });
            return response.ok;
        } catch {
            return false;
        }
    },
};
