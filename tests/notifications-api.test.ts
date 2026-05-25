import { describe, test, expect, mock } from 'bun:test';

mock.module('@gateway/config', () => ({
    loadConfig: () => ({
        worker: {},
        scheduler: {},
        watchdog: {},
        dashboard: { locale: 'en' },
        logging: {},
        notifications: {
            enabled: true,
            defaults: {
                on_success: [],
                on_failure: ['discord'],
                on_dead_letter: [],
            },
            channels: {
                discord: { webhookUrl: 'https://discord.com/api/webhooks/test' },
            },
        },
    }),
    getActiveChannels: (config: any) => {
        const channels: string[] = [];
        if (config?.channels?.discord?.webhookUrl) channels.push('discord');
        return channels;
    },
    CONFIG_PATH: ':memory:',
    expandEnvVar: (s: string) => s,
    expandEnvVars: (o: any) => o,
}));

mock.module('@gateway/notifications/service', () => ({
    healthCheckAll: async () => ({
        discord: { ok: true },
        slack: { ok: false, error: 'not configured' },
    }),
    sendTestNotification: async (_channel: string, _config: any) => ({
        ok: true,
        error: null,
    }),
    CHANNELS: {},
}));

import { dashboardApp } from '../src/web/index';

describe('Notification API', () => {
    test('GET /api/notifications/active-channels returns active channels', async () => {
        const res = await dashboardApp.fetch(new Request('http://localhost/api/notifications/active-channels'));
        expect(res.status).toBe(200);
        const data = await res.json() as { channels: string[] };
        expect(data.channels).toBeInstanceOf(Array);
        expect(data.channels).toContain('discord');
    });

    test('GET /api/notifications/active-channels excludes unconfigured channels', async () => {
        const res = await dashboardApp.fetch(new Request('http://localhost/api/notifications/active-channels'));
        expect(res.status).toBe(200);
        const data = await res.json() as { channels: string[] };
        expect(data.channels).not.toContain('telegram');
        expect(data.channels).not.toContain('slack');
    });

    test('GET /api/notifications/health returns status for each channel', async () => {
        const res = await dashboardApp.fetch(new Request('http://localhost/api/notifications/health'));
        expect(res.status).toBe(200);
        const data = await res.json() as Record<string, { ok: boolean; error?: string }>;
        expect(data.discord.ok).toBe(true);
        expect(data.slack.ok).toBe(false);
    });

    test('POST /api/notifications/test returns success for valid channel', async () => {
        const res = await dashboardApp.fetch(new Request('http://localhost/api/notifications/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: 'discord' }),
        }));
        expect(res.status).toBe(200);
        const data = await res.json() as { success: boolean };
        expect(data.success).toBe(true);
    });

    test('POST /api/notifications/test returns 400 for missing channel', async () => {
        const res = await dashboardApp.fetch(new Request('http://localhost/api/notifications/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        }));
        expect(res.status).toBe(400);
        const data = await res.json() as { success: boolean; error: string };
        expect(data.success).toBe(false);
        expect(data.error).toBe('channel is required');
    });

    test('POST /api/notifications/test works with config override from form', async () => {
        const res = await dashboardApp.fetch(new Request('http://localhost/api/notifications/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channel: 'discord',
                config: { webhookUrl: 'https://discord.com/api/webhooks/override' },
            }),
        }));
        expect(res.status).toBe(200);
        const data = await res.json() as { success: boolean };
        expect(data.success).toBe(true);
    });
});
