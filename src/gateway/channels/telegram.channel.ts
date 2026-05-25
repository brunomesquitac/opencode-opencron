import type { ChannelHandler, NotificationPayload, SendResult, TelegramConfig } from './channel.interface';

function escapeMdV2(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function formatTelegramPayload(payload: NotificationPayload): string {
    const statusEmoji = payload.event === 'done' ? '✅' : payload.event === 'failed' ? '❌' : '💀';
    const statusLabel = payload.event === 'done' ? 'Completed' : payload.event === 'failed' ? 'Failed' : 'Dead Letter';
    const lines: string[] = [
        `${statusEmoji} *OpenCron — Task ${statusLabel}*`,
        escapeMdV2('━━━━━━━━━━━━━━━━━'),
        `*Task:* ${escapeMdV2(payload.task.name)}`,
        `*Agent:* ${escapeMdV2(payload.task.agent)}  \\|  *Duration:* ${escapeMdV2(payload.duration)}`,
    ];
    if (payload.error) {
        lines.push(`*Error:* ${escapeMdV2(payload.error)}`);
    }
    const resultPreview = payload.result.slice(0, 1500);
    if (resultPreview) {
        lines.push(`━━━━━━━━━━━━━━━━━`);
        lines.push(escapeMdV2(resultPreview));
    }
    if (payload.dashboardUrl) {
        lines.push(`━━━━━━━━━━━━━━━━━`);
        lines.push(`[Open Dashboard](${payload.dashboardUrl})`);
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
