import type { ChannelHandler, NotificationPayload, SendResult, SlackConfig } from './channel.interface';
import { convertForChannel } from '@gateway/notifications/markdown-utils';

const STATUS_EMOJI: Record<string, string> = {
    done: '✅',
    failed: '❌',
    dead_letter: '💀',
};

const STATUS_COLORS: Record<string, string> = {
    done: '#238636',
    failed: '#da3633',
    dead_letter: '#d29922',
};

export const slackChannel: ChannelHandler = {
    name: 'slack',

    async send(payload: NotificationPayload, config: Record<string, unknown>): Promise<SendResult> {
        const cfg = config as unknown as SlackConfig;
        const emoji = STATUS_EMOJI[payload.event] ?? '•';
        const color = STATUS_COLORS[payload.event] ?? '#8b949e';

        const title = `*[Task #${payload.task.id} ${emoji}] ${payload.task.name}*`;

        const blocks: Array<Record<string, unknown>> = [];

        // Title
        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: title },
        });

        blocks.push({ type: 'divider' });

        // Error block (if failed)
        if (payload.error) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `⚠️ *Erro:*\n\`\`\`${payload.error.slice(0, 800)}\`\`\``,
                },
            });
        }

        // Result (converted mrkdwn, tables as ASCII art)
        const convertedResult = convertForChannel(payload.result, 'slack');
        if (convertedResult) {
            // Slack mrkdwn section text limit is 3000 chars
            blocks.push({
                type: 'section',
                text: { type: 'mrkdwn', text: convertedResult.slice(0, 3000) },
            });
        }

        blocks.push({ type: 'divider' });

        // Footer: Agent, Duration, Dir, Dashboard
        const footerLines: string[] = [`• Agent: ${payload.task.agent}`];
        if (payload.duration) footerLines.push(`• Duration: ${payload.duration}`);
        if (payload.cwd) footerLines.push(`• Dir: ${payload.cwd}`);
        if (payload.dashboardUrl) {
            footerLines.push(`• Dashboard: <${payload.dashboardUrl}|Abrir Dashboard>`);
        }

        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: footerLines.join('\n') },
        });

        // Color bar attachment
        const attachments = [
            {
                color,
                footer: `Task #${payload.task.id}`,
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
