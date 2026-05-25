import type { ChannelHandler, NotificationPayload, SendResult, EmailConfig } from './channel.interface';

function escHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatEmailHtml(payload: NotificationPayload): string {
    const statusColors: Record<string, string> = {
        done: '#238636',
        failed: '#da3633',
        dead_letter: '#d29922',
    };
    const statusLabels: Record<string, string> = {
        done: 'Completed',
        failed: 'Failed',
        dead_letter: 'Dead Letter',
    };
    const statusEmoji: Record<string, string> = {
        done: '✅',
        failed: '❌',
        dead_letter: '💀',
    };

    const color = statusColors[payload.event] || '#8b949e';
    const label = statusLabels[payload.event] || payload.event;
    const emoji = statusEmoji[payload.event] || '';

    let rows = '';
    const fields: Array<[string, string]> = [
        ['Task', escHtml(payload.task.name)],
        ['Agent', escHtml(payload.task.agent)],
        ['Duration', escHtml(payload.duration)],
        ['Category', escHtml(payload.task.category)],
        ['Importance', '★'.repeat(payload.task.importance) + '☆'.repeat(5 - payload.task.importance)],
        ['Urgency', '★'.repeat(payload.task.urgency) + '☆'.repeat(5 - payload.task.urgency)],
    ];
    for (const [k, v] of fields) {
        rows += `<tr><td style="color:#8b949e;padding:4px 12px 4px 0;white-space:nowrap">${k}</td><td style="padding:4px 0">${v}</td></tr>`;
    }

    let errorSection = '';
    if (payload.error) {
        errorSection = `<div style="margin-top:16px;padding:12px;background:rgba(248,81,73,0.1);border-left:3px solid #da3633;border-radius:4px"><strong style="color:#f85149">Error:</strong><pre style="margin:8px 0 0;white-space:pre-wrap;font-size:13px">${escHtml(payload.error)}</pre></div>`;
    }

    const resultPreview = payload.result.slice(0, 3000) || '[no output]';

    let dashboardLink = '';
    if (payload.dashboardUrl) {
        dashboardLink = `<div style="margin-top:20px"><a href="${payload.dashboardUrl}" style="color:#58a6ff;text-decoration:none">Open Dashboard</a></div>`;
    }

    return `<!DOCTYPE html><html><body style="background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;padding:24px;margin:0">
<div style="max-width:600px;margin:0 auto;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:24px">
<h2 style="margin:0 0 4px;color:#fff;font-size:18px">${emoji} OpenCron — Task ${label}</h2>
<p style="color:#8b949e;font-size:13px;margin:0 0 20px">Task #${payload.task.id}</p>
<table style="border-collapse:collapse;font-size:14px">${rows}</table>
${errorSection}
<div style="margin-top:20px;padding:12px;background:#0d1117;border-radius:4px;font-family:monospace;font-size:13px;white-space:pre-wrap;line-height:1.6">${escHtml(resultPreview)}</div>
${dashboardLink}
</div></body></html>`;
}

let nodemailerModule: typeof import('nodemailer') | null = null;

async function getNodemailer(): Promise<typeof import('nodemailer')> {
    if (!nodemailerModule) {
        nodemailerModule = await import('nodemailer');
    }
    return nodemailerModule;
}

export const emailChannel: ChannelHandler = {
    name: 'email',

    async send(payload: NotificationPayload, config: Record<string, unknown>): Promise<SendResult> {
        const cfg = config as unknown as EmailConfig;
        const subject = `[OpenCron] ${payload.event === 'done' ? '✅' : payload.event === 'failed' ? '❌' : '💀'} ${payload.task.name} — ${payload.event === 'done' ? 'Completed' : payload.event === 'failed' ? 'Failed' : 'Dead Letter'}`;

        try {
            const nodemailer = await getNodemailer();
            const transporter = nodemailer.createTransport({
                host: cfg.host,
                port: cfg.port,
                secure: cfg.secure,
                auth: { user: cfg.user, pass: cfg.pass },
            });

            const html = formatEmailHtml(payload);

            await transporter.sendMail({
                from: cfg.from,
                to: cfg.to,
                subject,
                html,
            });

            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    },

    async healthCheck(config: Record<string, unknown>): Promise<boolean> {
        const cfg = config as unknown as EmailConfig;
        if (!cfg.host || !cfg.user || !cfg.pass) return false;
        try {
            const nodemailer = await getNodemailer();
            const transporter = nodemailer.createTransport({
                host: cfg.host,
                port: cfg.port,
                secure: cfg.secure,
                auth: { user: cfg.user, pass: cfg.pass },
                connectionTimeout: 10000,
            });
            const result = await transporter.verify();
            return result === true;
        } catch {
            return false;
        }
    },
};
