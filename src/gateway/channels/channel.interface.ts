export interface NotificationPayload {
    event: 'done' | 'failed' | 'dead_letter';
    task: {
        id: number;
        name: string;
        agent: string;
        status: string;
        category: string;
        importance: number;
        urgency: number;
    };
    result: string;
    duration: string;
    error?: string;
    dashboardUrl?: string;
}

export interface SendResult {
    ok: boolean;
    error?: string;
}

export interface ChannelHandler {
    readonly name: string;
    send(payload: NotificationPayload, config: Record<string, unknown>): Promise<SendResult>;
    healthCheck(config: Record<string, unknown>): Promise<boolean>;
}

export type ChannelName = 'telegram' | 'discord' | 'slack' | 'email' | 'webhook';

export interface TelegramConfig {
    botToken: string;
    chatId: string | number;
}

export interface DiscordConfig {
    webhookUrl: string;
}

export interface SlackConfig {
    webhookUrl: string;
}

export interface EmailConfig {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    to: string | string[];
}

export interface WebhookConfig {
    url: string;
    headers?: Record<string, string>;
}

export type ChannelConfig = Record<string, unknown>;

export interface NotificationsConfig {
    enabled: boolean;
    defaults: {
        on_success: ChannelName[];
        on_failure: ChannelName[];
        on_dead_letter: ChannelName[];
    };
    channels: Record<string, Record<string, unknown>>;
}

export interface TaskNotifyOn {
    on_success: ChannelName[];
    on_failure: ChannelName[];
    on_dead_letter: ChannelName[];
}
