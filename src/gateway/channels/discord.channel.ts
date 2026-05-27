import type { ChannelHandler, NotificationPayload, SendResult, DiscordConfig } from './channel.interface';
import { convertForChannel } from '@gateway/notifications/markdown-utils';

const STATUS_COLORS: Record<string, number> = {
    done: 0x238636,
    failed: 0xda3633,
    dead_letter: 0xd29922,
};

const STATUS_EMOJI: Record<string, string> = {
    done: '✅',
    failed: '❌',
    dead_letter: '💀',
};

export const discordChannel: ChannelHandler = {
    name: 'discord',

    async send(payload: NotificationPayload, config: Record<string, unknown>): Promise<SendResult> {
        const cfg = config as unknown as DiscordConfig;
        const color = STATUS_COLORS[payload.event] ?? 0x8b949e;
        const emoji = STATUS_EMOJI[payload.event] ?? '•';

        const title = `[Task #${payload.task.id} ${emoji}] ${payload.task.name}`;

        // Build description: optional error block + result
        const parts: string[] = [];

        if (payload.error) {
            parts.push(`⚠️ **Erro:**\n\`\`\`\n${payload.error.slice(0, 800)}\n\`\`\``);
        }

        const convertedResult = convertForChannel(payload.result, 'discord');
        if (convertedResult) {
            parts.push(convertedResult.slice(0, 3200));
        }

        const description = parts.join('\n\n') || '[sem output]';

        // Footer: Agent | Duration | Dir | Dashboard
        const footerParts = [`Agent: ${payload.task.agent}`];
        if (payload.duration) footerParts.push(`Duration: ${payload.duration}`);
        if (payload.cwd) footerParts.push(`Dir: ${payload.cwd}`);
        if (payload.dashboardUrl) footerParts.push(`Dashboard: ${payload.dashboardUrl}`);

        const embed: Record<string, unknown> = {
            title,
            description,
            color,
            footer: { text: footerParts.join('  |  ') },
            timestamp: new Date().toISOString(),
        };

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
