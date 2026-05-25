import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { NotificationsConfig, ChannelName } from '@gateway/channels/channel.interface';

export interface GatewayConfig {
    worker: {
        maxConcurrency: number;
        pollIntervalMs: number;
        heartbeatIntervalMs: number;
        taskTimeoutMs: number;
    };
    scheduler: {
        enabled: boolean;
        checkIntervalMs: number;
        catchUp: 'next' | 'all' | 'latest';
    };
    watchdog: {
        heartbeatTimeoutMs: number;
        cleanupIntervalMs: number;
        retentionDays: number;
    };
    dashboard: {
        enabled: boolean;
        port: number;
        locale: string;
    };
    logging: {
        level: string;
        format: 'json' | 'text';
    };
    notifications: NotificationsConfig;
}

const DEFAULT_CONFIG: GatewayConfig = {
    worker: {
        maxConcurrency: 2,
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 30000,
        taskTimeoutMs: 1800000,
    },
    scheduler: {
        enabled: true,
        checkIntervalMs: 1000,
        catchUp: 'next',
    },
    watchdog: {
        heartbeatTimeoutMs: 600000,
        cleanupIntervalMs: 60000,
        retentionDays: 30,
    },
    dashboard: {
        enabled: true,
        port: 4680,
        locale: 'en',
    },
    logging: {
        level: 'info',
        format: 'json',
    },
    notifications: {
        enabled: true,
        defaults: {
            on_success: [],
            on_failure: [],
            on_dead_letter: [],
        },
        channels: {},
    },
};

const CONFIG_PATH = join(homedir(), '.config/opencode/opencron.json');

function deepMerge<T>(base: T, override: Record<string, unknown>): T {
    const result = { ...base } as Record<string, unknown>;
    for (const key of Object.keys(override)) {
        const val = (override as Record<string, unknown>)[key];
        if (val !== null && typeof val === 'object' && !Array.isArray(val) && key in result) {
            const baseVal = result[key];
            if (baseVal !== null && typeof baseVal === 'object' && !Array.isArray(baseVal)) {
                result[key] = deepMerge(baseVal as T, val as Record<string, unknown>);
                continue;
            }
        }
        if (val !== undefined) {
            result[key] = val;
        }
    }
    return result as T;
}

export function loadConfig(): GatewayConfig {
    if (!existsSync(CONFIG_PATH)) {
        return DEFAULT_CONFIG;
    }

    try {
        const raw = readFileSync(CONFIG_PATH, 'utf-8');
        const userConfig = JSON.parse(raw) as Record<string, unknown>;
        return deepMerge<GatewayConfig>(DEFAULT_CONFIG, userConfig);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', msg: 'config load failed, using defaults', path: CONFIG_PATH, error: msg }));
        return DEFAULT_CONFIG;
    }
}

export { CONFIG_PATH };

export function expandEnvVar(value: string): string {
    return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
        return process.env[varName] ?? '';
    });
}

export function expandEnvVars(obj: Record<string, unknown>): Record<string, unknown> {
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

export function getActiveChannels(config: NotificationsConfig): ChannelName[] {
    const allNames: ChannelName[] = ['telegram', 'discord', 'slack', 'email', 'webhook'];
    return allNames.filter((name) => {
        const channelConfig = config.channels[name];
        if (!channelConfig) return false;
        const resolved = expandEnvVars(channelConfig) as Record<string, unknown>;
        switch (name) {
            case 'telegram': return !!(resolved.botToken && resolved.chatId);
            case 'discord': return !!(resolved.webhookUrl);
            case 'slack': return !!(resolved.webhookUrl);
            case 'email': return !!(resolved.host && resolved.user && resolved.pass);
            case 'webhook': return !!(resolved.url);
            default: return false;
        }
    });
}
