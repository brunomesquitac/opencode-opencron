import type { ChannelHandler, NotificationPayload, SendResult, TelegramConfig } from './channel.interface';
import { convertForChannel } from '@gateway/notifications/markdown-utils';

const STATUS_EMOJI: Record<string, string> = {
    done: '✅',
    failed: '❌',
    dead_letter: '💀',
};

function formatTelegramPayload(payload: NotificationPayload): string {
    const emoji = STATUS_EMOJI[payload.event] ?? '•';

    // Escape special chars for MarkdownV2 in plain strings
    const esc = (text: string) => text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');

    const lines: string[] = [];

    // Title
    lines.push(`*\\[Task \\#${payload.task.id} ${emoji}\\] ${esc(payload.task.name)}*`);
    lines.push('');

    // Error block (if failed)
    if (payload.error) {
        lines.push('⚠️ *Erro:*');
        lines.push(`\`\`\`\n${payload.error.slice(0, 800)}\n\`\`\``);
        lines.push('');
    }

    // Result — converted to MarkdownV2 (tables → ASCII art, bold/headings converted)
    const convertedResult = convertForChannel(payload.result, 'telegram');
    if (convertedResult) {
        // Telegram total message limit is 4096 chars; leave ~200 for header+footer
        lines.push(convertedResult.slice(0, 3700));
        lines.push('');
    }

    // Footer
    lines.push(`• Agent: ${esc(payload.task.agent)}`);
    if (payload.duration) lines.push(`• Duration: ${esc(payload.duration)}`);
    if (payload.cwd) lines.push(`• Dir: ${esc(payload.cwd)}`);
    if (payload.dashboardUrl) {
        // URL only needs ) and \ escaped inside the parentheses
        const safeUrl = payload.dashboardUrl.replace(/[)\\]/g, '\\$&');
        lines.push(`• [Abrir Dashboard](${safeUrl})`);
    }

    return lines.join('\n');
}

export const telegramChannel: ChannelHandler = {
    name: 'telegram',

    async send(payload: NotificationPayload, config: Record<string, unknown>): Promise<SendResult> {
        const cfg = config as unknown as TelegramConfig;
        const text = formatTelegramPayload(payload);

        try {
            const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: cfg.chatId,
                    text,
                    parse_mode: 'MarkdownV2',
                    disable_web_page_preview: true,
                }),
            });

            if (!response.ok) {
                const errBody = await response.text();
                return { ok: false, error: `Telegram API ${response.status}: ${errBody}` };
            }

            const data = await response.json() as { ok: boolean; description?: string };
            if (!data.ok) {
                return { ok: false, error: data.description || 'Unknown Telegram error' };
            }

            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    },

    async healthCheck(config: Record<string, unknown>): Promise<boolean> {
        const cfg = config as unknown as TelegramConfig;
        if (!cfg.botToken) return false;
        try {
            const url = `https://api.telegram.org/bot${cfg.botToken}/getMe`;
            const response = await fetch(url);
            if (!response.ok) return false;
            const data = await response.json() as { ok: boolean };
            return data.ok === true;
        } catch {
            return false;
        }
    },
};
