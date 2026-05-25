import type { ChannelHandler, NotificationPayload, SendResult, WebhookConfig } from './channel.interface';

export const webhookChannel: ChannelHandler = {
    name: 'webhook',

    async send(payload: NotificationPayload, config: Record<string, unknown>): Promise<SendResult> {
        const cfg = config as unknown as WebhookConfig;

        const body = {
            event: `task.${payload.event}`,
            timestamp: new Date().toISOString(),
            task: payload.task,
            result: payload.result,
            duration: payload.duration,
            error: payload.error || null,
            dashboardUrl: payload.dashboardUrl || null,
        };

        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                ...(cfg.headers || {}),
            };

            const response = await fetch(cfg.url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const errBody = await response.text();
                return { ok: false, error: `Webhook ${response.status}: ${errBody}` };
            }

            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    },

    async healthCheck(config: Record<string, unknown>): Promise<boolean> {
        const cfg = config as unknown as WebhookConfig;
        if (!cfg.url) return false;
        try {
            const headers: Record<string, string> = {
                ...(cfg.headers || {}),
            };
            const response = await fetch(cfg.url, { method: 'HEAD', headers });
            return response.ok;
        } catch {
            return false;
        }
    },
};
