import type { ChannelHandler, NotificationPayload, SendResult, DiscordConfig } from './channel.interface';

const STATUS_COLORS: Record<string, number> = {
    done: 0x238636,
    failed: 0xda3633,
    dead_letter: 0xd29922,
};

const STATUS_LABELS: Record<string, string> = {
    done: 'Completed',
    failed: 'Failed',
    dead_letter: 'Dead Letter',
};

export const discordChannel: ChannelHandler = {
    name: 'discord',

    async send(payload: NotificationPayload, config: Record<string, unknown>): Promise<SendResult> {
        const cfg = config as unknown as DiscordConfig;
        const color = STATUS_COLORS[payload.event] || 0x8b949e;
        const statusLabel = STATUS_LABELS[payload.event] || payload.event;
        const resultPreview = payload.result.slice(0, 1000) || '[no output]';

        const embed: Record<string, unknown> = {
            title: `OpenCron — Task ${statusLabel}`,
            color,
            fields: [
                { name: 'Task', value: payload.task.name, inline: true },
                { name: 'Agent', value: payload.task.agent, inline: true },
                { name: 'Duration', value: payload.duration, inline: true },
                { name: 'Category', value: payload.task.category, inline: true },
                { name: 'Importance', value: `${'★'.repeat(payload.task.importance)}${'☆'.repeat(5 - payload.task.importance)}`, inline: true },
                { name: 'Urgency', value: `${'★'.repeat(payload.task.urgency)}${'☆'.repeat(5 - payload.task.urgency)}`, inline: true },
                { name: 'Result', value: resultPreview },
            ],
            timestamp: new Date().toISOString(),
            footer: { text: `Task #${payload.task.id}` },
        };

        if (payload.error) {
            (embed.fields as Array<Record<string, unknown>>).splice(3, 0, {
                name: 'Error',
                value: payload.error.slice(0, 1000),
                inline: false,
            });
        }

        if (payload.dashboardUrl) {
            embed.url = payload.dashboardUrl;
        }

        try {
            const response = await fetch(cfg.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ embeds: [embed] }),
            });

            if (!response.ok) {
                const errBody = await response.text();
                return { ok: false, error: `Discord webhook ${response.status}: ${errBody}` };
            }

            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    },

    async healthCheck(config: Record<string, unknown>): Promise<boolean> {
        const cfg = config as unknown as DiscordConfig;
        if (!cfg.webhookUrl) return false;
        try {
            const response = await fetch(cfg.webhookUrl, { method: 'HEAD' });
            return response.ok || response.status === 405;
        } catch {
            return false;
        }
    },
};
