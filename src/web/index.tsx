/** @jsx Hono.jsx */
import { Hono } from 'hono';
import { html } from 'hono/html';
import { TaskService } from '@core/services/task.service';
import { TaskRunService } from '@core/services/task-run.service';
import { TaskTemplateService } from '@core/services/task-template.service';
import { desc, sql, eq } from 'drizzle-orm';
import { db, schema } from '@core/db';
import { loadConfig, CONFIG_PATH, getActiveChannels, type GatewayConfig } from '@gateway/config';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getAgents, getModels, listDirectories, listRootEntries, validatePath } from '@core/opencode-config';
import type { AgentInfo, ModelInfo } from '@core/opencode-config';
import { getTranslations } from './locales';
import { t as _tr, formatClientTranslations } from './translate';
import { healthCheckAll, sendTestNotification } from '@gateway/notifications/service';
import type { ChannelName, NotificationsConfig } from '@gateway/channels/channel.interface';
import { CHANNELS } from '@gateway/notifications/service';

const CHANNEL_ICONS: Record<string, string> = {
    telegram: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#2AABEE"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.46-1.901-.903-1.056-.692-1.653-1.123-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.015-.15-.056-.212s-.174-.041-.25-.024c-.106.024-1.793 1.14-5.062 3.345-.48.33-.913.49-1.302.48-.428-.009-1.252-.242-1.865-.44-.752-.245-1.349-.374-1.297-.79.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.53 6.998-3.015 3.333-1.386 4.025-1.627 4.477-1.635.1-.002.32.023.463.14.12.1.153.23.17.33.016.1.036.32.02.5z"/></svg>`,
    discord: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#5865F2"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`,
    slack: `<svg width="14" height="14" viewBox="0 0 24 24"><path fill="#E01E5A" d="M5.04 15.16a2.52 2.52 0 0 1-2.52 2.52 2.52 2.52 0 0 1-2.52-2.52 2.52 2.52 0 0 1 2.52-2.52h2.52v2.52zm1.26 0a2.52 2.52 0 0 1 2.52-2.52 2.52 2.52 0 0 1 2.52 2.52v6.32a2.52 2.52 0 0 1-2.52 2.52 2.52 2.52 0 0 1-2.52-2.52v-6.32z"/><path fill="#36C5F0" d="M8.84 5.04a2.52 2.52 0 0 1-2.52-2.52 2.52 2.52 0 0 1 2.52-2.52 2.52 2.52 0 0 1 2.52 2.52v2.52H8.84zm0 1.26a2.52 2.52 0 0 1 2.52 2.52 2.52 2.52 0 0 1-2.52 2.52H2.52A2.52 2.52 0 0 1 0 8.82a2.52 2.52 0 0 1 2.52-2.52h6.32z"/><path fill="#2EB67D" d="M18.96 8.84a2.52 2.52 0 0 1 2.52-2.52 2.52 2.52 0 0 1 2.52 2.52 2.52 2.52 0 0 1-2.52 2.52h-2.52V8.84zm-1.26 0a2.52 2.52 0 0 1-2.52 2.52 2.52 2.52 0 0 1-2.52-2.52V2.52A2.52 2.52 0 0 1 15.18 0a2.52 2.52 0 0 1 2.52 2.52v6.32z"/><path fill="#ECB22E" d="M15.16 18.96a2.52 2.52 0 0 1 2.52 2.52 2.52 2.52 0 0 1-2.52 2.52 2.52 2.52 0 0 1-2.52-2.52v-2.52h2.52zm0-1.26a2.52 2.52 0 0 1-2.52-2.52 2.52 2.52 0 0 1 2.52-2.52h6.32a2.52 2.52 0 0 1 2.52 2.52 2.52 2.52 0 0 1-2.52 2.52h-6.32z"/></svg>`,
    email: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EA4335" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 4-10 8L2 4"/></svg>`,
    webhook: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b949e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
};

const CHANNEL_LABELS: Record<string, string> = {
    telegram: 'Telegram',
    discord: 'Discord',
    slack: 'Slack',
    email: 'Email',
    webhook: 'Webhook',
};

const CHANNEL_SETUP_GUIDES: Record<string, string> = {
    telegram: `
        <strong>Step 1 — Create your bot</strong><br>
        Open Telegram and search for <code>@BotFather</code>.<br>
        Send the command <code>/newbot</code> and follow the instructions.<br>
        BotFather will give you a <strong>token</strong> at the end.<br><br>
        <strong>Step 2 — Get your Chat ID</strong><br>
        Send any message to your new bot.<br>
        Then open in your browser:<br>
        <code>https://api.telegram.org/botYOUR_TOKEN/getUpdates</code><br>
        Look for <code>"chat":{"id":123456789}</code> in the response.<br>
        That number is your <strong>Chat ID</strong>.<br><br>
        <strong>Step 3 — Fill the fields and test</strong><br>
        Paste the token and chat ID below, then click <strong>Test</strong>.`,
    discord: `
        <strong>Step 1 — Create a webhook</strong><br>
        Open Discord → go to your server → click the gear icon next to a channel → <strong>Integrations</strong> → <strong>Webhooks</strong> → <strong>New Webhook</strong>.<br>
        Give it a name (e.g. OpenCron) and click <strong>Copy Webhook URL</strong>.<br><br>
        <strong>Step 2 — Paste and test</strong><br>
        Paste the URL below, then click <strong>Test</strong>.`,
    slack: `
        <strong>Step 1 — Create a Slack app</strong><br>
        Go to <code>https://api.slack.com/apps</code> → <strong>Create New App</strong> → <strong>From scratch</strong>.<br>
        Give it a name (e.g. OpenCron) and choose your workspace.<br><br>
        <strong>Step 2 — Enable Incoming Webhooks</strong><br>
        In the left menu: <strong>Incoming Webhooks</strong> → toggle On.<br>
        Click <strong>Add New Webhook to Workspace</strong> → pick a channel → <strong>Allow</strong>.<br>
        Copy the <strong>Webhook URL</strong> that appears.<br><br>
        <strong>Step 3 — Paste and test</strong><br>
        Paste the URL below, then click <strong>Test</strong>.`,
    email: `
        <strong>For Gmail:</strong><br>
        1. Go to Google Account → <strong>Security</strong> → enable <strong>2-Step Verification</strong><br>
        2. Then go to <strong>App Passwords</strong> → generate a password for OpenCron<br>
        3. Use <code>smtp.gmail.com</code> as host, port <code>587</code><br><br>
        <strong>For other providers</strong> (Outlook, Yahoo, etc.):<br>
        Use your provider's SMTP settings. Check their documentation for the correct host and port.<br><br>
        Fill all fields below and click <strong>Test</strong>.`,
    webhook: `
        <strong>Any URL that accepts POST with JSON</strong><br>
        You can use this for custom integrations:<br>
        • <strong>n8n</strong> — create a Webhook trigger, copy the URL<br>
        • <strong>Zapier / Make</strong> — create a webhook trigger<br>
        • <strong>Custom API</strong> — your own endpoint<br><br>
        <strong>Headers (optional)</strong><br>
        If the URL requires authentication, add a JSON object with headers, e.g.:<br>
        <code>{"X-API-Key": "your-key"}</code><br><br>
        Fill the URL below and click <strong>Test</strong>.`,
};

const app = new Hono();

function formatDuration(startAt: Date | null, endAt: Date | null): string {
    if (!startAt) return '-';
    const start = new Date(startAt).getTime();
    const end = endAt ? new Date(endAt).getTime() : Date.now();
    const seconds = Math.floor((end - start) / 1000);
    if (seconds < 0) return '0s';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
}

function formatTokens(n: number | null | undefined): string {
    if (n === null || n === undefined) return '-';
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return (n / 1000000).toFixed(1) + 'M';
}

function formatCost(n: number | null | undefined): string {
    if (n === null || n === undefined || n === 0) return '-';
    if (n < 0.01) return '$' + n.toFixed(4);
    if (n < 1) return '$' + n.toFixed(3);
    return '$' + n.toFixed(2);
}

function getRangeCutoff(range: string): number | null {
    const now = Math.floor(Date.now() / 1000);
    switch (range) {
        case '24h': return now - 86400;
        case '7d': return now - 7 * 86400;
        case '30d': return now - 30 * 86400;
        default: return null;
    }
}

function RangeBar(current: string, basePath: string, existingParams: string, T: Record<string, string>): string {
    const ranges = [
        { key: '24h', label: '24h' },
        { key: '7d', label: '7d' },
        { key: '30d', label: '30d' },
        { key: '', label: _tr(T, 'period.all') },
    ];
    const items = ranges.map(r => {
        const href = r.key ? basePath + '?range=' + r.key + (existingParams ? '&' + existingParams : '') : basePath + (existingParams ? '?' + existingParams : '');
        const active = (r.key === '' && !current) || r.key === current;
        return `<a href="${esc(href)}" class="btn ${active ? 'btn-primary' : ''}">${r.label}</a>`;
    }).join(' ');
    return `<div style="margin-bottom:12px;display:flex;gap:6px;align-items:center"><span class="mu sm" style="margin-right:4px">${esc(_tr(T, 'period.label'))}</span>${items}</div>`;
}

function timeAgo(ms: number | null): string {
    if (!ms) return '-';
    const diff = Date.now() - ms;
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
}

function timeUntil(ms: number | null): string {
    if (!ms) return '-';
    const diff = ms - Date.now();
    if (diff < 0) return 'overdue';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return `${Math.floor(diff / 86400000)}d`;
}

function formatDate(ts: Date | number | null, locale: string = 'en'): string {
    if (!ts) return '-';
    const d = ts instanceof Date ? ts : new Date(ts);
    try {
        return d.toLocaleString(locale === 'pt-BR' ? 'pt-BR' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
        return d.toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
}

function esc(s: string | null | undefined): string {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function readCurrentConfig(): Record<string, unknown> {
    if (!existsSync(CONFIG_PATH)) return {};
    try {
        return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    } catch { return {}; }
}

function writeConfig(cfg: Record<string, unknown>): void {
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

const SHARED_STYLES = html`
<style>
  :root { --bg:#0d1117; --card:#161b22; --border:#30363d; --t1:#c9d1d9; --t2:#8b949e; --green:#238636; --red:#da3633; --yellow:#d29922; --blue:#1f6feb; --purple:#8957e5; }
  * { box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; background:var(--bg); color:var(--t1); margin:0; line-height:1.5; }
  .c { max-width:1280px; margin:0 auto; padding:20px; }
  header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid var(--border); padding-bottom:16px; }
  h1 { font-size:22px; margin:0; color:#fff; }
  nav.tabs { display:flex; gap:0; margin-bottom:20px; border-bottom:1px solid var(--border); }
  nav.tabs a { display:block; padding:10px 20px; color:var(--t2); text-decoration:none; font-size:14px; font-weight:500; border-bottom:2px solid transparent; }
  nav.tabs a:hover { color:var(--t1); }
  nav.tabs a.active { color:#fff; border-bottom-color:var(--blue); }
  .g4 { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:16px; margin-bottom:24px; }
  .g3 { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; margin-bottom:24px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:16px; }
  .sv { font-size:28px; font-weight:bold; }
  .sl { color:var(--t2); font-size:12px; text-transform:uppercase; margin-top:4px; }
  .panel { background:var(--card); border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-bottom:16px; }
  .ph { padding:12px 16px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; }
  .ph h3 { margin:0; font-size:14px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { background:#21262d; color:var(--t2); font-weight:600; text-align:left; padding:8px 12px; white-space:nowrap; }
  td { padding:8px 12px; border-bottom:1px solid var(--border); vertical-align:top; }
  tr:last-child td { border-bottom:none; }
  tr:hover { background:rgba(255,255,255,0.02); }
  .badge { display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; }
  .b-pending { background:rgba(110,118,129,0.3); color:#8b949e; }
  .b-running { background:rgba(56,139,253,0.15); color:#58a6ff; }
  .b-done { background:rgba(46,160,67,0.15); color:#3fb950; }
  .b-failed { background:rgba(248,81,73,0.15); color:#f85149; }
  .b-dead_letter { background:rgba(210,153,34,0.15); color:#d29922; }
  .b-cancelled { background:rgba(110,118,129,0.2); color:#6e7681; }
  .btn { appearance:none; background:transparent; border:1px solid var(--border); color:var(--t2); padding:4px 10px; border-radius:4px; cursor:pointer; font-size:12px; margin-right:4px; text-decoration:none; }
  .btn:hover { background:#30363d; color:#fff; }
  .btn-sm { padding:2px 6px; font-size:11px; }
  .btn-primary { background:var(--green); border-color:var(--green); color:#fff; }
  .btn-primary:hover { opacity:0.85; color:#fff; }
  .btn-danger:hover { color:var(--red); border-color:var(--red); }
  .btn-warn:hover { color:var(--yellow); border-color:var(--yellow); }
  .rf { background:var(--green); color:white; border:none; padding:6px 16px; border-radius:6px; font-weight:600; cursor:pointer; text-decoration:none; font-family:inherit; font-size:inherit; line-height:inherit; display:inline-flex; align-items:center; }
  .rf:hover { opacity:0.9; }
  .m { font-family:monospace; font-size:12px; }
  .mu { color:var(--t2); }
  .sm { font-size:12px; }
  .el { max-width:400px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:inline-block; vertical-align:middle; }
  .tag { display:inline-block; background:#21262d; padding:1px 6px; border-radius:4px; font-size:11px; }
  .t-cron { color:var(--purple); }
  .t-recurring { color:var(--blue); }
  .t-delayed { color:var(--yellow); }
  .pn { margin-top:16px; display:flex; justify-content:center; gap:10px; align-items:center; }
  .ir { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border); font-size:13px; }
  .ir:last-child { border-bottom:none; }
  .ik { color:var(--t2); }
  .iv { font-weight:500; }
  .form-row { display:flex; gap:12px; align-items:center; margin-bottom:12px; }
  .form-row label { color:var(--t2); font-size:13px; min-width:100px; }
  .form-row input, .form-row select { background:#0d1117; border:1px solid var(--border); color:var(--t1); padding:6px 10px; border-radius:4px; font-size:13px; }
  .form-row input:focus, .form-row select:focus { outline:none; border-color:var(--blue); }
  .log-box { background:#0d1117; border:1px solid var(--border); border-radius:4px; padding:12px; font-family:monospace; font-size:12px; max-height:300px; overflow-y:auto; white-space:pre-wrap; color:var(--t1); margin-top:8px; }
  dialog { background:var(--card); color:var(--t1); border:1px solid var(--border); border-radius:8px; padding:0; max-width:900px; width:90%; }
  dialog::backdrop { background:rgba(0,0,0,0.6); }
  .dh { padding:16px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; }
  .db { padding:16px; max-height:70vh; overflow-y:auto; }
  pre { margin:0; white-space:pre-wrap; font-size:12px; }
  .cb { background:transparent; border:none; color:var(--t2); cursor:pointer; font-size:20px; }
  .mt8 { margin-top:8px; }
  .mt16 { margin-top:16px; }
  .mb0 { margin-bottom:0; }
  .ta-center { text-align:center; }
  .p30 { padding:30px; }
  .toast { position:fixed; top:20px; right:20px; padding:12px 20px; border-radius:6px; color:#fff; font-size:14px; z-index:9999; display:none; }
  .toast-ok { background:var(--green); }
  .toast-err { background:var(--red); }
  .tip { display:inline-flex; align-items:center; justify-content:center; width:11px; height:11px; border-radius:50%; background:var(--t2); color:var(--bg); font-size:7px; font-weight:700; font-style:italic; cursor:default; margin-left:4px; vertical-align:middle; user-select:none; flex-shrink:0; line-height:1; }
  .tip:hover { background:var(--blue); }
  #tooltip { position:fixed; z-index:9998; background:#21262d; border:1px solid var(--border); border-radius:6px; padding:8px 12px; font-size:12px; color:var(--t1); line-height:1.5; max-width:240px; pointer-events:none; display:none; box-shadow:0 4px 12px rgba(0,0,0,0.4); }
  .msg { margin-bottom:12px; }
  .msg .msg-hd { font-size:11px; font-weight:600; text-transform:uppercase; margin-bottom:4px; letter-spacing:0.5px; }
  .msg .msg-bd { background:#0d1117; padding:10px 14px; border-radius:0 6px 6px 0; font-size:13px; line-height:1.6; }
  .msg .msg-bd pre { margin:0; white-space:pre-wrap; font-size:12px; }
  .msg-user .msg-hd { color:var(--blue); }
  .msg-user .msg-bd { border-left:2px solid var(--blue); }
  .msg-assistant .msg-hd { color:var(--green); }
  .msg-assistant .msg-bd { border-left:2px solid var(--green); white-space:pre-wrap; }
  .msg-toolcall .msg-hd { color:var(--purple); }
  .msg-toolcall .msg-bd { border-left:2px solid var(--purple); font-family:monospace; font-size:12px; padding:8px 12px; }
  .msg-toolresult .msg-hd { color:var(--yellow); }
  .msg-toolresult .msg-bd { border-left:2px solid var(--yellow); font-family:monospace; font-size:12px; padding:8px 12px; max-height:240px; overflow-y:auto; white-space:pre-wrap; }
  .msg-error .msg-hd { color:var(--red); }
  .msg-error .msg-bd { background:rgba(248,81,73,0.06); border-left:2px solid var(--red); }
  .stars { display:inline-flex; gap:2px; align-items:center; }
  .stars .star { cursor:pointer; font-size:16px; color:var(--border); transition:color 0.1s; }
  .stars .star.on { color:var(--yellow); }
  .stars .star:hover { color:var(--yellow); }
  .section-label { color:var(--t2); font-size:11px; text-transform:uppercase; letter-spacing:0.5px; margin:16px 0 8px; }
  .section-label:first-child { margin-top:0; }
  .field { margin-bottom:14px; }
  .field label { display:flex; align-items:center; color:var(--t2); font-size:13px; margin-bottom:4px; }
  .field label .field-name { min-width:0; }
  .field input, .field textarea, .field select { width:100%; background:#0d1117; border:1px solid var(--border); color:var(--t1); padding:8px 12px; border-radius:4px; font-size:13px; font-family:inherit; }
  .field textarea { min-height:120px; resize:vertical; font-family:monospace; font-size:13px; line-height:1.5; }
  .field input:focus, .field textarea:focus, .field select:focus { outline:none; border-color:var(--blue); }
  .field-grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  .field-inline { display:flex; gap:12px; align-items:center; }
  .field-inline label { margin-bottom:0; min-width:90px; }
  .field-inline input, .field-inline select { width:auto; flex:1; }
  .hl { color:var(--yellow); font-size:12px; margin-left:4px; }
  .cwd-row { display:flex; gap:8px; align-items:center; }
  .cwd-input { flex:1; }
  .cwd-status { font-size:16px; min-width:20px; text-align:center; }
  .field-error { color:#f85149; font-size:12px; margin-top:4px; min-height:1.2em; }
  .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:1000; }
  .modal-content { background:var(--card); border:1px solid var(--border); border-radius:8px; width:640px; max-height:520px; display:flex; flex-direction:column; box-shadow:0 8px 32px rgba(0,0,0,0.5); }
  .modal-header { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid var(--border); }
  .modal-body { flex:1; overflow-y:auto; padding:4px 8px; min-height:200px; }
  .modal-footer { display:flex; justify-content:flex-end; gap:8px; padding:10px 16px; border-top:1px solid var(--border); }
  .dir-item { padding:6px 10px; cursor:pointer; border-radius:4px; font-size:13px; }
  .dir-item:hover { background:#21262d; }
  .dir-up { color:var(--blue); font-weight:500; border-bottom:1px solid var(--border); margin-bottom:4px; }
  .ar-label { color:var(--t2); font-size:13px; margin-left:12px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; user-select:none; }
  .ar-label input { accent-color:var(--green); cursor:pointer; }
  .ar-sel { background:#0d1117; border:1px solid var(--border); color:var(--t1); padding:2px 4px; border-radius:4px; font-size:12px; margin-left:4px; cursor:pointer; }
  .ar-sel:focus { outline:none; border-color:var(--blue); }
  .ar-status { color:var(--green); font-size:11px; margin-left:6px; }
</style>
`;

function renderLayout(pageTitle: string, activeTab: string, body: string, T: Record<string, string>): string {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(pageTitle)} - OpenCron</title>${SHARED_STYLES}
<script>
var __T = ${formatClientTranslations(T)};
function _t(k){var m=__T[k];return m!==undefined?m:k;}
function _tf(k){for(var _len=arguments.length,a=[],_key=1;_key<_len;_key++){a[_key-1]=arguments[_key];}var s=_t(k);for(var i=0;i<a.length;i++){s=s.split('{'+i+'}').join(a[i]);}return s;}
var _arTimer=null,_arRefreshing=false;
function _reExecScripts(c){Array.from(c.querySelectorAll('script')).forEach(function(s){var ns=document.createElement('script');if(s.src){ns.src=s.src;ns.async=false;}else{ns.textContent=s.textContent;}s.parentNode.replaceChild(ns,s);});}
function smartRefresh(){if(_arRefreshing)return;if(document.querySelector('dialog[open]'))return;var _p=location.pathname;if(_p==='/new'||_p==='/system'||_p.startsWith('/notifications'))return;var _a=document.activeElement;if(_a&&(_a.tagName==='INPUT'||_a.tagName==='TEXTAREA'||_a.tagName==='SELECT'))return;_arRefreshing=true;var u=_p+location.search;fetch(u).then(function(r){return r.text();}).then(function(h){var p=new DOMParser(),d=p.parseFromString(h,'text/html'),nm=d.getElementById('page-content');if(!nm){_arRefreshing=false;return;}var om=document.getElementById('page-content'),sy=window.scrollY;om.outerHTML=nm.outerHTML;window.scrollTo(0,sy);_reExecScripts(document.getElementById('page-content'));_arRefreshing=false;}).catch(function(){_arRefreshing=false;});}
function toggleAutoRefresh(){var e=document.getElementById('ar-toggle').checked;localStorage.setItem('ar',e?'1':'0');if(e){var i=parseInt(document.getElementById('ar-interval').value);_startAR(i);}else{_stopAR();}}
function changeAutoInterval(){localStorage.setItem('ar-int',document.getElementById('ar-interval').value);if(document.getElementById('ar-toggle').checked){_stopAR();_startAR(parseInt(document.getElementById('ar-interval').value));}}
function _startAR(ms){_stopAR();_arTimer=setInterval(smartRefresh,ms);}
function _stopAR(){if(_arTimer){clearInterval(_arTimer);_arTimer=null;}}
document.addEventListener('DOMContentLoaded',function(){var ar=localStorage.getItem('ar');if(ar===null){ar='1';localStorage.setItem('ar','1');}if(ar==='1'){document.getElementById('ar-toggle').checked=true;var i=parseInt(localStorage.getItem('ar-int')||'5000');document.getElementById('ar-interval').value=String(i);_startAR(i);}});
async function retryTask(id){if(!confirm(_tf('alert.confirmRetry',id)))return;await fetch('/api/tasks/'+id+'/retry',{method:'POST'});smartRefresh();}
async function deleteTask(id){if(!confirm(_tf('alert.confirmDelete',id)))return;await fetch('/api/tasks/'+id,{method:'DELETE'});smartRefresh();}
async function showDetail(id){try{const r=await fetch('/api/tasks/'+id);const t=await r.json();document.getElementById('dc').textContent=JSON.stringify(t,null,2);document.getElementById('dd').showModal();}catch(e){alert(_t('alert.failedLoadDetails'));}}
async function showRunDetail(id){try{const r=await fetch('/api/runs/'+id);const t=await r.json();document.getElementById('dc').textContent=JSON.stringify(t,null,2);document.getElementById('dd').showModal();}catch(e){alert(_t('alert.failedLoadDetails'));}}
async function showTemplateDetail(id){try{const r=await fetch('/api/templates/'+id);const t=await r.json();document.getElementById('dc').textContent=JSON.stringify(t,null,2);document.getElementById('dd').showModal();}catch(e){alert(_t('alert.failedLoadDetails'));}}
async function enableTmpl(id){await fetch('/api/templates/'+id+'/enable',{method:'POST'});smartRefresh();}
async function disableTmpl(id){if(!confirm(_t('alert.confirmDisable')))return;await fetch('/api/templates/'+id+'/disable',{method:'POST'});smartRefresh();}
async function deleteTmpl(id){if(!confirm(_t('alert.confirmDeleteTemplate')))return;await fetch('/api/templates/'+id,{method:'DELETE'});smartRefresh();}
async function triggerTmpl(id){if(!confirm(_t('alert.confirmTrigger')))return;const r=await fetch('/api/templates/'+id+'/trigger',{method:'POST'});const d=await r.json();if(d.success){alert(_tf('alert.taskCreated',d.taskId));smartRefresh();}else{alert(_t('alert.triggerFailed'));}}
function toggleLog(id){const el=document.getElementById('log-'+id);el.style.display=el.style.display==='none'?'block':'none';}



async function cloneTask(id){
  try{
    if(activeChannels.length===0)await loadActiveChannels();
    const [rTask, rAgents] = await Promise.all([
      fetch('/api/tasks/'+id),
      fetch('/api/agents'),
    ]);
    const t=await rTask.json();
    const agents=await rAgents.json();
    document.getElementById('et-id').value=t.id;
    document.getElementById('et-name').value='[Clone] '+t.name;
    var agSel=document.getElementById('et-ag');
    agSel.innerHTML='<option value="">'+_t('clone.selectAgent')+'</option>';
    agents.forEach(function(a){
      var opt=document.createElement('option');
      opt.value=a.name;opt.textContent=a.name+(a.description?' — '+a.description:'');
      if(a.name===t.agent)opt.selected=true;
      agSel.appendChild(opt);
    });
    document.getElementById('et-mo').value=t.model||'default';
    document.getElementById('et-pr').value=t.prompt||'';
    document.getElementById('et-cw').value=t.cwd||'';
    document.getElementById('et-ca').value=t.category||'general';
    document.getElementById('et-mr').value=t.maxRetries||3;
    document.getElementById('et-stars-im').querySelector('input[type=hidden]').value=t.importance||3;
    document.getElementById('et-stars-ur').querySelector('input[type=hidden]').value=t.urgency||3;
    initStars('et-stars-im');initStars('et-stars-ur');
    document.getElementById('etc-notify-section').innerHTML=modalNotifyHtml('etc');
    modalBuildNotifyTable('etc');
    if(t.notifyOn){
      var etcNo=typeof t.notifyOn==='string'?JSON.parse(t.notifyOn):t.notifyOn;
      document.querySelector('input[name="etc-notify-mode"][value="custom"]').checked=true;
      modalNotifyToggle('etc');
      modalSetNotifyChecks('etc',etcNo);
    }
    document.getElementById('et-modal').showModal();
  }catch(e){alert(_tf('alert.failedLoadTask',e.message));}
}

async function saveCloneTask(){
  var cwdRaw=document.getElementById('et-cw').value.trim();
  if(cwdRaw){
    try{
      var vr=await fetch('/api/fs/validate?path='+encodeURIComponent(cwdRaw));
      var vd=await vr.json();
      if(!vd.valid){alert(_tf('alert.invalidDir',vd.error));return;}
    }catch(e){alert(_tf('alert.validationError',e.message));return;}
  }
  var data={
    name:document.getElementById('et-name').value.trim(),
    agent:document.getElementById('et-ag').value.trim(),
    model:document.getElementById('et-mo').value.trim(),
    prompt:document.getElementById('et-pr').value.trim(),
    cwd:cwdRaw||null,
    category:document.getElementById('et-ca').value,
    maxRetries:parseInt(document.getElementById('et-mr').value)||3,
    importance:parseInt(document.getElementById('et-stars-im').querySelector('input[type=hidden]').value)||3,
    urgency:parseInt(document.getElementById('et-stars-ur').querySelector('input[type=hidden]').value)||3,
  };
  if(!data.name||!data.agent||!data.prompt){alert(_t('alert.requiredFields'));return;}
  var etcMode=document.querySelector('input[name="etc-notify-mode"]:checked');
  if(etcMode&&etcMode.value==='custom'){data.notifyOn=modalGetNotifyChannels('etc');}
  try{
    const r=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const d=await r.json();
    if(d.success){document.getElementById('et-modal').close();document.getElementById('toast').textContent=_tf('toast.taskCreated',d.taskId)+' (Clone)';document.getElementById('toast').className='toast toast-ok';document.getElementById('toast').style.display='block';setTimeout(function(){smartRefresh();},1500);}
    else{alert(_tf('alert.createFailed',d.error));}
  }catch(e){alert(_tf('alert.createFailed',e.message));}
}

async function editTemplate(id){
  try{
    if(activeChannels.length===0)await loadActiveChannels();
    const [rTmpl, rAgents, rModels]=await Promise.all([
      fetch('/api/templates/'+id),
      fetch('/api/agents'),
      fetch('/api/models'),
    ]);
    const t=await rTmpl.json();
    const agents=await rAgents.json();
    const models=await rModels.json();
    document.getElementById('etm-id').value=t.id;
    document.getElementById('etm-name').value=t.name||'';
    var agSel=document.getElementById('etm-ag');
    agSel.innerHTML='<option value="">'+_t('template.edit.selectAgent')+'</option>';
    agents.forEach(function(a){
      var opt=document.createElement('option');
      opt.value=a.name;opt.textContent=a.name+(a.description?' — '+a.description:'');
      if(a.name===t.agent)opt.selected=true;
      agSel.appendChild(opt);
    });
    document.getElementById('etm-mo').value=t.model||'default';
    var dl=document.getElementById('etm-model-suggestions');dl.innerHTML='';
    models.forEach(function(m){
      var opt=document.createElement('option');opt.value=m.id;opt.textContent=m.label;dl.appendChild(opt);
    });
    document.getElementById('etm-pr').value=t.prompt||'';
    document.getElementById('etm-cw').value=t.cwd||'';
    document.getElementById('etm-ca').value=t.category||'general';
    document.getElementById('etm-mr').value=t.maxRetries||3;
    document.getElementById('etm-stars-im').querySelector('input[type=hidden]').value=t.importance||3;
    document.getElementById('etm-stars-ur').querySelector('input[type=hidden]').value=t.urgency||3;
    initStars('etm-stars-im');initStars('etm-stars-ur');
    document.getElementById('etm-schtype').value=t.scheduleType||'cron';
    document.getElementById('etm-cronexpr').value=t.cronExpr||'';
    document.getElementById('etm-intervalval').value=t.intervalMs?Math.floor(t.intervalMs/60000):6;
    document.getElementById('etm-intervalunit').value=t.intervalMs?(t.intervalMs%86400000===0?'days':t.intervalMs%3600000===0?'hours':'minutes'):'hours';
    document.getElementById('etm-delayval').value=t.runAt?Math.floor(Math.max((t.runAt-Date.now())/60000,1))||30:30;
    t.enabled?document.getElementById('etm-status').textContent=_t('status.enabled'):document.getElementById('etm-status').textContent=_t('status.disabled');
    document.getElementById('etm-notify-section').innerHTML=modalNotifyHtml('etm');
    modalBuildNotifyTable('etm');
    if(t.notifyOn){
      var etmNo=typeof t.notifyOn==='string'?JSON.parse(t.notifyOn):t.notifyOn;
      document.querySelector('input[name="etm-notify-mode"][value="custom"]').checked=true;
      modalNotifyToggle('etm');
      modalSetNotifyChecks('etm',etmNo);
    }
    editTmplToggleFields();
    document.getElementById('etm-modal').showModal();
  }catch(e){alert(_tf('alert.failedLoadTemplate',e.message));}
}

function editTmplToggleFields(){
  var v=document.getElementById('etm-schtype').value;
  document.getElementById('etm-cron-section').style.display=v==='cron'?'':'none';
  document.getElementById('etm-recurring-section').style.display=v==='recurring'?'':'none';
  document.getElementById('etm-delayed-section').style.display=v==='delayed'?'':'none';
}

async function saveEditTemplate(){
  const id=document.getElementById('etm-id').value;
  var cwdRaw=document.getElementById('etm-cw').value.trim();
  if(cwdRaw){
    try{
      var vr=await fetch('/api/fs/validate?path='+encodeURIComponent(cwdRaw));
      var vd=await vr.json();
      if(!vd.valid){alert(_tf('alert.invalidDir',vd.error));return;}
    }catch(e){alert(_tf('alert.validationError',e.message));return;}
  }
  var data={
    name:document.getElementById('etm-name').value.trim(),
    agent:document.getElementById('etm-ag').value.trim(),
    model:document.getElementById('etm-mo').value.trim(),
    prompt:document.getElementById('etm-pr').value.trim(),
    cwd:cwdRaw||null,
    category:document.getElementById('etm-ca').value,
    maxRetries:parseInt(document.getElementById('etm-mr').value)||3,
    importance:parseInt(document.getElementById('etm-stars-im').querySelector('input[type=hidden]').value)||3,
    urgency:parseInt(document.getElementById('etm-stars-ur').querySelector('input[type=hidden]').value)||3,
    scheduleType:document.getElementById('etm-schtype').value,
  };
  if(!data.name||!data.agent||!data.prompt){alert(_t('alert.requiredFields'));return;}
  var etmMode=document.querySelector('input[name="etm-notify-mode"]:checked');
  if(etmMode&&etmMode.value==='custom'){data.notifyOn=modalGetNotifyChannels('etm');}
  const mults={minutes:60000,hours:3600000,days:86400000};
  if(data.scheduleType==='cron'){
    data.cronExpr=document.getElementById('etm-cronexpr').value.trim();
    if(!data.cronExpr){alert(_t('alert.cronRequired'));return;}
  }else if(data.scheduleType==='recurring'){
    const v=parseInt(document.getElementById('etm-intervalval').value)||0;
    const u=document.getElementById('etm-intervalunit').value;
    if(v<=0){alert(_t('alert.intervalRequired'));return;}
    data.intervalMs=v*mults[u];
  }else if(data.scheduleType==='delayed'){
    const v=parseInt(document.getElementById('etm-delayval').value)||0;
    if(v<=0){alert(_t('alert.delayRequired'));return;}
    data.runAt=Date.now()+v*60000;
  }
  try{
    const r=await fetch('/api/templates/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const d=await r.json();
    if(d.success){document.getElementById('etm-modal').close();document.getElementById('toast').textContent=_tf('template.toast.updated',id);document.getElementById('toast').className='toast toast-ok';document.getElementById('toast').style.display='block';setTimeout(function(){smartRefresh();},1500);}
    else{alert(_tf('alert.updateFailed',d.error));}
  }catch(e){alert(_tf('alert.updateFailed',e.message));}
}

async function clearDatabase(){
  if(!confirm(_t('alert.confirmClearDb')))return;
  if(!confirm(_t('alert.confirmClearDbFinal')))return;
  try{
    const r=await fetch('/api/database/clear',{method:'POST'});
    const d=await r.json();
    if(d.success){alert(_t('alert.dbCleared'));smartRefresh();}
    else{alert(_tf('alert.clearFailed',d.error));}
  }catch(e){alert(_tf('alert.clearFailed',e.message));}
}

function showTip(el,text){
  var t=document.getElementById('tooltip');
  t.textContent=text;
  t.style.display='block';
  var r=el.getBoundingClientRect();
  var tw=t.offsetWidth,th=t.offsetHeight;
  var left=r.left+r.width/2-tw/2;
  var top=r.top-th-8;
  if(top<6){top=r.bottom+8;}
  if(left<6){left=6;}
  if(left+tw>window.innerWidth-6){left=window.innerWidth-tw-6;}
  t.style.left=left+'px';
  t.style.top=top+'px';
}
function hideTip(){document.getElementById('tooltip').style.display='none';}

async function saveConfig(){
  const form=document.getElementById('config-form');
    const data={
    worker:{
      maxConcurrency:Number(form.mc.value),
      pollIntervalMs:Number(form.pi.value),
      heartbeatIntervalMs:Number(form.hi.value)*1000,
      taskTimeoutMs:Number(form.to.value)*60000,
    },
    scheduler:{
      enabled:form.se.checked,
      checkIntervalMs:Number(form.si.value),
      catchUp:form.cu.value,
    },
    watchdog:{
      heartbeatTimeoutMs:Number(form.wt.value)*1000,
      cleanupIntervalMs:Number(form.wc.value)*1000,
      retentionDays:Number(form.rd.value),
    },
    dashboard:{
      locale:document.getElementById('locale-select')?.value||'en',
    }
  };
  try{
    const r=await fetch('/api/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const d=await r.json();
    if(d.success){document.getElementById('toast').textContent=_t('system.saveMessage');document.getElementById('toast').style.display='block';setTimeout(()=>document.getElementById('toast').style.display='none',3000);}
    else{alert(_tf('alert.saveFailed',d.error));}
  }catch(e){alert(_tf('alert.saveFailed',e.message));}
}

function initStars(containerId){
  var c=document.getElementById(containerId);
  if(!c)return;
  var hidden=c.querySelector('input[type=hidden]');
  var label=document.getElementById(containerId+'-label');
  var names=[_t('stars.low'),_t('stars.low'),_t('stars.medium'),_t('stars.high'),_t('stars.critical')];
  var value=parseInt(hidden.value)||3;
  var stars=c.querySelectorAll('.star');
  function paint(v){
    stars.forEach(function(s,i){s.className='star'+(i<v?' on':'');});
    hidden.value=v;
    if(label)label.textContent=names[v]||'';
  }
  stars.forEach(function(s,i){
    s.addEventListener('click',function(){paint(i+1);});
  });
  paint(value);
}

async function createTask(){
  var f=document.getElementById('task-form');
  var cwdRaw=f.cw.value.trim();
  if(cwdRaw){
    try{
      var vr=await fetch('/api/fs/validate?path='+encodeURIComponent(cwdRaw));
      var vd=await vr.json();
      if(!vd.valid){
        document.getElementById('cwd-error').textContent=_tf('alert.invalidDir',vd.error);
        document.getElementById('cwd-status').textContent='\u274C';
        document.getElementById('cwd-status').style.color='#f85149';
        return;
      }
    }catch(e){
      document.getElementById('cwd-error').textContent=_tf('alert.validationError',e.message);
      return;
    }
  }
  var data={
    name:f.nm.value.trim(),
    agent:f.ag.value.trim(),
    model:f.mo.value.trim()||'default',
    prompt:f.pr.value.trim(),
    cwd:cwdRaw||null,
    category:f.ca.value,
    importance:parseInt(f.im.value)||3,
    urgency:parseInt(f.ur.value)||3,
    maxRetries:parseInt(f.mr.value)||3,
  };
  if(f.notify_mode && f.notify_mode.value==='custom'){
    var notifyOn = {
      on_success: getCheckedNotifyChannels('on_success'),
      on_failure: getCheckedNotifyChannels('on_failure'),
      on_dead_letter: getCheckedNotifyChannels('on_dead_letter'),
    };
    data.notifyOn = notifyOn;
  }
  if(!data.name||!data.agent||!data.prompt){alert(_t('alert.requiredFields'));return;}

  var mode=f.sch_mode.value;
  if(mode==='schedule'){
    data.scheduleType=f.sch_type.value;
    var mults={minutes:60000,hours:3600000,days:86400000};
    if(data.scheduleType==='cron'){
      data.cronExpr=f.cron_expr.value.trim();
      if(!data.cronExpr){alert(_t('alert.cronRequired'));return;}
    }else if(data.scheduleType==='recurring'){
      var v=parseInt(f.int_val.value)||0;
      var u=f.int_unit.value;
      if(v<=0){alert(_t('alert.intervalRequired'));return;}
      data.intervalMs=v*(mults[u]||60000);
    }else if(data.scheduleType==='delayed'){
      var v=parseInt(f.del_val.value)||0;
      var u=f.del_unit.value;
      if(v<=0){alert(_t('alert.delayRequired'));return;}
      data.runAt=Date.now()+v*(mults[u]||60000);
    }
    try{
      var r=await fetch('/api/templates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      var d=await r.json();
      if(d.success){location.href='/templates?created='+d.templateId;}
      else{alert(_tf('alert.failedCreateSchedule',d.error));}
    }catch(e){alert(_tf('alert.failedCreateSchedule',e.message));}
  }else{
    try{
      var r=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      var d=await r.json();
      if(d.success){location.href='/?created='+d.taskId;}
      else{alert(_tf('alert.failedCreateTask',d.error));}
    }catch(e){alert(_tf('alert.failedCreateTask',e.message));}
  }
}




function toggleScheduling(){
  var f=document.getElementById('task-form');
  var schedule=f.sch_mode.value==='schedule';
  document.getElementById('schedule-section').style.display=schedule?'block':'none';
  document.getElementById('submit-btn').textContent=schedule?_t('btn.createSchedule'):_t('btn.createTask');
  if(schedule)updateScheduleFields();
}

function updateScheduleFields(){
  var type=document.getElementById('task-form').sch_type.value;
  document.getElementById('sch-cron').style.display=type==='cron'?'block':'none';
  document.getElementById('sch-recurring').style.display=type==='recurring'?'block':'none';
  document.getElementById('sch-delayed').style.display=type==='delayed'?'block':'none';
}

function viewSession(runId){location.href='/runs/'+runId+'/session';}

var activeChannels = [];

async function loadActiveChannels(){
  try{
    var r = await fetch('/api/notifications/active-channels');
    var d = await r.json();
    activeChannels = d.channels || [];
    buildNotifyCustomTable();
  }catch(e){}
}

function buildNotifyCustomTable(){
  var container = document.getElementById('notify-custom-table');
  if(!container) return;
  if(activeChannels.length === 0){
    container.innerHTML = '<p class="mu sm">No notification channels configured. Set up channels in the <a href="/notifications">Notifications tab</a> first.</p>';
    return;
  }
  var channelNames = {telegram:'Telegram',discord:'Discord',slack:'Slack',email:'Email',webhook:'Webhook'};
  var events = {on_success:'&#x2705; Done',on_failure:'&#x274C; Fail',on_dead_letter:'&#x1F480; Dead'};
  var html = '<table><thead><tr><th>Event</th>';
  activeChannels.forEach(function(ch){ html += '<th>' + (channelNames[ch]||ch) + '</th>'; });
  html += '</tr></thead><tbody>';
  Object.keys(events).forEach(function(ev){
    html += '<tr><td style="font-size:12px">' + events[ev] + '</td>';
    activeChannels.forEach(function(ch){
      var checked = (ev === 'on_failure') ? ' checked' : '';
      html += '<td style="text-align:center"><input type="checkbox" name="nc-' + ev + '-' + ch + '"' + checked + ' style="width:auto"></td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

function getCheckedNotifyChannels(prefix){
  var names = activeChannels;
  return names.filter(function(n){
    var el = document.querySelector('input[name="nc-' + prefix + '-' + n + '"]');
    return el && el.checked;
  });
}

function toggleNotifyMode(){
  var f = document.getElementById('task-form');
  var isCustom = f.notify_mode.value === 'custom';
  document.getElementById('notify-custom-section').style.display = isCustom ? 'block' : 'none';
}

function modalNotifyToggle(prefix){
  var customEl = document.querySelector('input[name="' + prefix + '-notify-mode"][value="custom"]');
  var isCustom = customEl && customEl.checked;
  var section = document.getElementById(prefix + '-notify-custom');
  if(section) section.style.display = isCustom ? 'block' : 'none';
}

function modalBuildNotifyTable(prefix){
  var container = document.getElementById(prefix + '-notify-custom');
  if(!container) return;
  if(activeChannels.length === 0){
    container.innerHTML = '<p class="mu sm">No channels configured. Setup in <a href="/notifications">Notifications</a>.</p>';
    return;
  }
  var channelNames = {telegram:'Telegram',discord:'Discord',slack:'Slack',email:'Email',webhook:'Webhook'};
  var events = {on_success:'&#x2705; Done',on_failure:'&#x274C; Fail',on_dead_letter:'&#x1F480; Dead'};
  var html = '<table><thead><tr><th>Event</th>';
  activeChannels.forEach(function(ch){ html += '<th>' + (channelNames[ch]||ch) + '</th>'; });
  html += '</tr></thead><tbody>';
  Object.keys(events).forEach(function(ev){
    html += '<tr><td style="font-size:12px">' + events[ev] + '</td>';
    activeChannels.forEach(function(ch){
      html += '<td style="text-align:center"><input type="checkbox" name="' + prefix + '-' + ev + '-' + ch + '" style="width:auto"></td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

function modalSetNotifyChecks(prefix, notifyOn){
  if(!notifyOn) return;
  ['on_success','on_failure','on_dead_letter'].forEach(function(ev){
    var chs = notifyOn[ev] || [];
    chs.forEach(function(ch){
      var el = document.querySelector('input[name="' + prefix + '-' + ev + '-' + ch + '"]');
      if(el) el.checked = true;
    });
  });
}

function modalGetNotifyChannels(prefix){
  var result = { on_success: [], on_failure: [], on_dead_letter: [] };
  if(activeChannels.length === 0) return result;
  ['on_success','on_failure','on_dead_letter'].forEach(function(ev){
    activeChannels.forEach(function(ch){
      var el = document.querySelector('input[name="' + prefix + '-' + ev + '-' + ch + '"]');
      if(el && el.checked) result[ev].push(ch);
    });
  });
  return result;
}

function modalNotifyHtml(prefix){
  return '<div class="card" style="margin-bottom:20px;padding:14px 16px">'
    + '<h4 style="margin:0 0 10px;font-size:13px">Notifications</h4>'
    + '<div class="field" style="margin-bottom:8px"><label><input type="radio" name="' + prefix + '-notify-mode" value="global" checked onchange="modalNotifyToggle(&quot;' + prefix + '&quot;)" style="width:auto;margin-right:6px">Use global defaults</label></div>'
    + '<div class="field" style="margin-bottom:0"><label><input type="radio" name="' + prefix + '-notify-mode" value="custom" onchange="modalNotifyToggle(&quot;' + prefix + '&quot;)" style="width:auto;margin-right:6px">Custom for this task</label></div>'
    + '<div id="' + prefix + '-notify-custom" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)"></div>'
    + '</div>';
}
</script>
</head>
<body>
<div id="toast" class="toast toast-ok"></div>
<div id="tooltip"></div>
<div class="c">
  <header>
    <div><h1>${esc(_tr(T, 'layout.title'))}</h1><span class="mu sm">${esc(_tr(T, 'layout.subtitle'))}</span></div>
    <div><a href="/new" class="rf">${esc(_tr(T, 'btn.newTask'))}</a> <button class="rf" onclick="smartRefresh()">&#x21bb; ${esc(_tr(T, 'btn.refresh'))}</button> <label class="ar-label"><input type="checkbox" id="ar-toggle" onchange="toggleAutoRefresh()"> ${esc(_tr(T, 'btn.autoRefresh'))}</label><select id="ar-interval" class="ar-sel" onchange="changeAutoInterval()"><option value="5000" selected>5s</option><option value="10000">10s</option><option value="30000">30s</option><option value="60000">60s</option></select></div>
  </header>
  <nav class="tabs">
    <a href="/" class="${activeTab === 'tasks' ? 'active' : ''}">${esc(_tr(T, 'nav.taskQueue'))}</a>
    <a href="/templates" class="${activeTab === 'templates' ? 'active' : ''}">${esc(_tr(T, 'nav.scheduledTasks'))}</a>
    <a href="/runs" class="${activeTab === 'runs' ? 'active' : ''}">${esc(_tr(T, 'nav.executionLogs'))}</a>
    <a href="/system" class="${activeTab === 'system' ? 'active' : ''}">${esc(_tr(T, 'nav.systemStatus'))}</a>
    <a href="/notifications" class="${activeTab === 'notifications' ? 'active' : ''}">${esc(_tr(T, 'nav.notifications'))}</a>
  </nav>
  <main id="page-content">${body}</main>
</div>
<dialog id="dd"><div class="dh"><h3 style="margin:0">${esc(_tr(T, 'btn.details'))}</h3><button class="cb" onclick="document.getElementById('dd').close()">&times;</button></div><div class="db"><pre id="dc"></pre></div></dialog>
</body></html>`;
}

app.get('/', async (c) => {
    const cfg = loadConfig();
    const locale = cfg.dashboard?.locale || 'en';
    const T = getTranslations(locale);
    const page = Number(c.req.query('page') || '1');
    const statusFilter = c.req.query('status') || '';
    const range = c.req.query('range') || '';
    const limit = 50;
    const offset = (page - 1) * limit;
    const cutoffSec = getRangeCutoff(range);

    const [tasks, statsData, config] = await Promise.all([
        TaskService.list({ limit, offset, ...(statusFilter ? { status: statusFilter as any } : {}), ...(cutoffSec ? { startedAfter: cutoffSec } : {}) }),
        TaskService.stats({ ...(cutoffSec ? { startedAfter: cutoffSec } : {}) }),
        Promise.resolve(loadConfig()),
    ]);

    const taskIds = tasks.map(t => t.id);
    const latestRuns = await TaskRunService.getLatestByTaskIds(taskIds);

    const counts = {
        pending: statsData.pending || 0,
        running: statsData.running || 0,
        done: statsData.done || 0,
        failed: (statsData.failed || 0) + (statsData.dead_letter || 0),
        total: statsData.total || 0,
    };
    const totalPages = Math.ceil(counts.total / limit);

    const rangeParam = range ? '&range=' + range : '';
    let filterBtns = `<div style="margin-bottom:12px;display:flex;gap:6px;">
      <a href="/${range ? '?range=' + range : ''}" class="btn ${!statusFilter ? 'btn-primary' : ''}">${esc(_tr(T, 'filter.all'))}</a>
      <a href="/?status=pending${rangeParam}" class="btn ${statusFilter === 'pending' ? 'btn-primary' : ''}">${esc(_tr(T, 'status.pending'))}</a>
      <a href="/?status=running${rangeParam}" class="btn ${statusFilter === 'running' ? 'btn-primary' : ''}">${esc(_tr(T, 'status.running'))}</a>
      <a href="/?status=done${rangeParam}" class="btn ${statusFilter === 'done' ? 'btn-primary' : ''}">${esc(_tr(T, 'status.done'))}</a>
      <a href="/?status=failed${rangeParam}" class="btn ${statusFilter === 'failed' ? 'btn-primary' : ''}">${esc(_tr(T, 'status.failed'))}</a>
      <a href="/?status=dead_letter${rangeParam}" class="btn ${statusFilter === 'dead_letter' ? 'btn-primary' : ''}">${esc(_tr(T, 'status.deadLetter'))}</a>
    </div>`;

    function buildNotifyIconCell(task: typeof tasks[0], config: GatewayConfig): string {
        let notifyChannels: Record<string, string[]> = { on_success: [], on_failure: [], on_dead_letter: [] };
        if (task.notifyOn) {
            try {
                notifyChannels = JSON.parse(task.notifyOn) as Record<string, string[]>;
            } catch {}
        } else if (config.notifications.enabled) {
            notifyChannels = {
                on_success: config.notifications.defaults.on_success as string[],
                on_failure: config.notifications.defaults.on_failure as string[],
                on_dead_letter: config.notifications.defaults.on_dead_letter as string[],
            };
        }
        const allChannels = new Set<string>();
        for (const list of Object.values(notifyChannels)) {
            for (const ch of list) allChannels.add(ch);
        }
        if (allChannels.size === 0) return '<span class="mu sm">—</span>';

        let iconsHtml = '';
        for (const ch of allChannels) {
            const icon = CHANNEL_ICONS[ch] || '';
            if (icon) iconsHtml += `<span style="margin-right:3px;vertical-align:middle" title="${CHANNEL_LABELS[ch] || ch}">${icon}</span>`;
        }

        const lines: string[] = [];
        const labels: Record<string, string> = { on_success: 'on success', on_failure: 'on failure', on_dead_letter: 'dead letter' };
        for (const [ev, chs] of Object.entries(notifyChannels)) {
            if (chs.length === 0) continue;
            lines.push(`${ev === 'on_success' ? '✅' : ev === 'on_failure' ? '❌' : '💀'} ${labels[ev] || ev}: ${chs.join(', ')}`);
        }
        const tooltip = lines.join('\\n');

        return `<span style="font-size:14px;cursor:default" onmouseenter="showTip(this,'${esc(tooltip)}')" onmouseleave="hideTip()">${iconsHtml}</span>`;
    }

    let rows = '';
    for (const task of tasks) {
        const st = (task.status ?? '').toUpperCase();
        const lr = latestRuns.get(task.id);
        const sessionBtn = lr ? `<button class="btn btn-sm" onclick="viewSession(${lr.id})">${esc(_tr(T, 'btn.session'))}</button>` : '';
        const toolsHint = lr?.toolsUsed
            ? (() => {
                const tools = JSON.parse(lr.toolsUsed) as string[];
                return tools.length > 0
                    ? `<span class="mu sm" style="cursor:default" title="${esc(tools.join(', '))}">${tools.length} ${esc(_tr(T, tools.length > 1 ? 'tasks.toolPlural' : 'tasks.toolSingular'))}</span>`
                    : '';
              })()
            : '';
        const skillsHint = lr?.skillsUsed
            ? (() => {
                const skills = JSON.parse(lr.skillsUsed) as string[];
                return skills.length > 0
                    ? `<span class="mu sm" style="cursor:default;color:var(--purple)" title="${esc(skills.join(', '))}">${skills.length} ${esc(_tr(T, skills.length > 1 ? 'tasks.skillPlural' : 'tasks.skillSingular'))}</span>`
                    : '';
              })()
            : '';

        const notifyHtml = buildNotifyIconCell(task, config);

        const usageHint = [toolsHint, skillsHint].filter(Boolean).join(' &middot; ');
        rows += `<tr>
          <td class="mu">#${task.id}</td>
          <td><div style="font-weight:500">${esc(task.name)}</div><div class="mu sm el">${esc(task.prompt.substring(0, 120))}</div></td>
          <td><span class="tag">${esc(task.agent)}</span></td>
          <td><span class="badge b-${task.status}">${st}</span></td>
          <td class="sm ${task.status === 'running' ? '' : 'mu'}">${formatDuration(task.startedAt, task.finishedAt)}</td>
          <td class="mu sm">${(task.retryCount ?? 0) > 0 ? task.retryCount : '-'}</td>
          <td class="mu sm">${usageHint}</td>
          <td>${notifyHtml}</td>
          <td>
            <button class="btn btn-sm" onclick="showDetail(${task.id})">${esc(_tr(T, 'btn.details'))}</button>
            ${sessionBtn}
            ${task.status !== 'running' ? `<button class="btn btn-sm" onclick="cloneTask(${task.id})">${esc(_tr(T, 'btn.clone'))}</button>` : ''}
            ${(task.status === 'failed' || task.status === 'dead_letter') ? `<button class="btn btn-sm btn-warn" onclick="retryTask(${task.id})">${esc(_tr(T, 'btn.retry'))}</button>` : ''}
            <button class="btn btn-sm btn-danger" onclick="deleteTask(${task.id})">${esc(_tr(T, 'btn.delete'))}</button>
          </td></tr>`;
    }

    const qp = (statusFilter ? `&status=${statusFilter}` : '') + (range ? `&range=${range}` : '');
    let paging = `<div class="pn">`;
    if (page > 1) paging += `<a href="/?page=${page - 1}${qp}" class="btn">${esc(_tr(T, 'btn.prev'))}</a>`;
    paging += `<span class="mu sm">${esc(_tr(T, 'pagination.page', page, totalPages, counts.total))}</span>`;
    if (page < totalPages) paging += `<a href="/?page=${page + 1}${qp}" class="btn">${esc(_tr(T, 'btn.next'))}</a>`;
    paging += `</div>`;

    const body = `
      <div class="g4">
        <div class="card"><div class="sv" style="color:var(--t2)">${counts.pending}</div><div class="sl">${esc(_tr(T, 'tasks.stats.pending'))}</div></div>
        <div class="card"><div class="sv" style="color:var(--blue)">${counts.running}</div><div class="sl">${esc(_tr(T, 'tasks.stats.running'))}</div></div>
        <div class="card"><div class="sv" style="color:var(--green)">${counts.done}</div><div class="sl">${esc(_tr(T, 'tasks.stats.done'))}</div></div>
        <div class="card"><div class="sv" style="color:var(--red)">${counts.failed}</div><div class="sl">${esc(_tr(T, 'tasks.stats.failed'))}</div></div>
      </div>
      ${RangeBar(range, '/', statusFilter ? 'status=' + statusFilter : '', T)}
      ${filterBtns}
      <div class="panel"><table>
        <thead><tr><th width="50">${esc(_tr(T, 'table.id'))}</th><th>${esc(_tr(T, 'table.task'))}</th><th>${esc(_tr(T, 'table.agent'))}</th><th width="90">${esc(_tr(T, 'table.status'))}</th><th width="70">${esc(_tr(T, 'table.duration'))}</th><th width="60">${esc(_tr(T, 'table.retries'))}</th><th width="70">${esc(_tr(T, 'table.tools'))}</th><th width="70">${esc(_tr(T, 'table.notify'))}</th><th>${esc(_tr(T, 'table.actions'))}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${paging}
      <script>
        (function(){
          var p=new URLSearchParams(location.search);
          if(p.get('created')&&!window.__taskCreatedToast){
            window.__taskCreatedToast=true;
            document.getElementById('toast').textContent=_tf('toast.taskCreated',p.get('created'));
            document.getElementById('toast').className='toast toast-ok';
            document.getElementById('toast').style.display='block';
            setTimeout(function(){document.getElementById('toast').style.display='none';},3000);
            history.replaceState({},'',location.pathname);
          }
        })();
      </script>

      <style>
        dialog.et-wide { max-width:800px; width:90%; }
        dialog.et-wide .db { max-height:75vh; }
        dialog.et-wide .db-inner { display:block; }
      </style>
      <dialog id="et-modal" class="et-wide">
        <div class="dh"><h3 style="margin:0">${esc(_tr(T, 'clone.title'))}</h3><button class="cb" onclick="document.getElementById('et-modal').close()">&times;</button></div>
        <div class="db">
          <input type="hidden" id="et-id">
          <div id="et-form-view">
            <div class="field">
              <label>${esc(_tr(T, 'clone.field.name'))}<span class="hl">*</span></label>
              <input type="text" id="et-name" placeholder="${esc(_tr(T, 'clone.placeholder.name'))}">
            </div>
            <div class="field-grid">
              <div class="field">
                <label>${esc(_tr(T, 'clone.field.agent'))}<span class="hl">*</span></label>
                <select id="et-ag"><option value="">${esc(_tr(T, 'clone.selectAgent'))}</option></select>
              </div>
              <div class="field">
                <label>${esc(_tr(T, 'clone.field.model'))}</label>
                <input type="text" id="et-mo" list="et-model-suggestions" placeholder="${esc(_tr(T, 'clone.placeholder.model'))}">
                <datalist id="et-model-suggestions"></datalist>
              </div>
            </div>
            <div class="field">
              <label>${esc(_tr(T, 'clone.field.prompt'))}<span class="hl">*</span></label>
              <textarea id="et-pr" style="min-height:120px" placeholder="${esc(_tr(T, 'clone.placeholder.prompt'))}"></textarea>
            </div>
            <div class="field">
              <label>${esc(_tr(T, 'clone.field.workingDir'))}</label>
              <div class="cwd-row">
                <input type="text" id="et-cw" class="cwd-input" placeholder="${esc(_tr(T, 'clone.placeholder.dir'))}" autocomplete="off">
                <span id="et-cwd-status" class="cwd-status"></span>
                <button type="button" id="et-btn-browse" class="btn" style="white-space:nowrap" onclick="etOpenBrowse()">${esc(_tr(T, 'btn.browse'))}</button>
              </div>
              <div id="et-cwd-error" class="field-error"></div>
            </div>
            <div class="field-grid">
              <div class="field">
                <label>${esc(_tr(T, 'clone.field.category'))}</label>
                <select id="et-ca"><option value="general">general</option><option value="translate">translate</option><option value="generate">generate</option><option value="review">review</option><option value="test">test</option></select>
              </div>
              <div class="field">
                <label>${esc(_tr(T, 'clone.field.maxRetries'))}</label>
                <select id="et-mr"><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="5">5</option><option value="10">10</option></select>
              </div>
            </div>
            <div class="field-grid">
              <div class="field">
                <label>${esc(_tr(T, 'clone.field.importance'))}</label>
                <div class="field-inline">
                  <div class="stars" id="et-stars-im"><input type="hidden" name="et-im" value="3"><span class="star on">\u2605</span><span class="star on">\u2605</span><span class="star on">\u2605</span><span class="star">\u2605</span><span class="star">\u2605</span></div>
                  <span class="mu sm" id="et-stars-im-label">${esc(_tr(T, 'stars.medium'))}</span>
                </div>
              </div>
              <div class="field">
                <label>${esc(_tr(T, 'clone.field.urgency'))}</label>
                <div class="field-inline">
                  <div class="stars" id="et-stars-ur"><input type="hidden" name="et-ur" value="3"><span class="star on">\u2605</span><span class="star on">\u2605</span><span class="star on">\u2605</span><span class="star">\u2605</span><span class="star">\u2605</span></div>
                  <span class="mu sm" id="et-stars-ur-label">${esc(_tr(T, 'stars.medium'))}</span>
                </div>
              </div>
            </div>
          </div>
          <div id="etc-notify-section"></div>
          <div id="et-browse-view" style="display:none;min-height:300px">
            <div class="ph" style="padding:8px 12px;margin-bottom:8px;border:1px solid var(--border);border-radius:4px">
              <span class="mu sm" id="et-browse-path">${esc(_tr(T, 'browse.home'))}</span>
            </div>
            <div id="et-browse-list" style="min-height:200px"></div>
            <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:10px;border-top:1px solid var(--border);margin-top:10px">
              <button class="btn" onclick="etBrowseCancel()">${esc(_tr(T, 'btn.cancel'))}</button>
              <button class="rf" id="et-browse-select" onclick="etBrowseSelect()" disabled>${esc(_tr(T, 'btn.selectFolder'))}</button>
            </div>
          </div>
        </div>
        <div class="modal-footer" id="et-modal-footer">
          <button class="btn" onclick="document.getElementById('et-modal').close()">${esc(_tr(T, 'btn.cancel'))}</button>
          <button class="rf" onclick="saveCloneTask()">${esc(_tr(T, 'btn.createClone'))}</button>
        </div>
      </dialog>

      <script>
        (function(){
          var etCwdTimeout,etBrowseStack=[],etBrowsePath='';
          function esc(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
          function etValidateCwd(path){
            var s=document.getElementById('et-cwd-status'),e=document.getElementById('et-cwd-error');
            s.textContent='\u23F3';e.textContent='';
            if(!path){s.textContent='';e.textContent='';return;}
            fetch('/api/fs/validate?path='+encodeURIComponent(path)).then(function(r){return r.json()}).then(function(v){
              if(v.valid){s.textContent='\u2705';s.style.color='#3fb950';e.textContent='';}
              else{s.textContent='\u274C';s.style.color='#f85149';e.textContent=v.error;}
            }).catch(function(){s.textContent='\u274C';s.style.color='#f85149';e.textContent=_t('alert.validationFailed');});
          }
          document.getElementById('et-cw').addEventListener('input',function(){
            clearTimeout(etCwdTimeout);var p=this.value;
            etCwdTimeout=setTimeout(function(){etValidateCwd(p);},500);
          });
          document.getElementById('et-cw').addEventListener('change',function(){etValidateCwd(this.value);});
          window.etOpenBrowse=function(parentPath){
            etBrowsePath=parentPath||'';etBrowseStack=etBrowsePath?[etBrowsePath]:[];
            document.getElementById('et-form-view').style.display='none';
            document.getElementById('et-browse-view').style.display='block';
            document.getElementById('et-modal-footer').style.display='none';
            etBrowseLoad(etBrowsePath);
          };
          window.etBrowseCancel=function(){
            document.getElementById('et-form-view').style.display='block';
            document.getElementById('et-browse-view').style.display='none';
            document.getElementById('et-modal-footer').style.display='flex';
          };
          window.etBrowseSelect=function(){
            if(!etBrowseStack.length)return;
            document.getElementById('et-cw').value=etBrowseStack[etBrowseStack.length-1];
            etBrowseCancel();
            etValidateCwd(etBrowseStack[etBrowseStack.length-1]);
          };
          function etBrowseLoad(dirPath){
            var list=document.getElementById('et-browse-list');
            list.innerHTML='<div class="ta-center mu p30">'+_t('browse.loading')+'</div>';
            document.getElementById('et-browse-select').disabled=true;
            var url='/api/fs/browse';if(dirPath)url+='?path='+encodeURIComponent(dirPath);
            fetch(url).then(function(r){return r.json()}).then(function(data){
              document.getElementById('et-browse-path').textContent=dirPath||_t('browse.home');
              if(!data.entries||data.entries.length===0){list.innerHTML='<div class="ta-center mu p30">'+_t('browse.empty')+'</div>';return;}
              var html='';
              if(dirPath)html+='<div class="dir-item dir-up" data-dir="'+(etBrowseStack.length>1?etBrowseStack[etBrowseStack.length-2]:'')+'">\u2190 '+_t('browse.parentDir')+'</div>';
              data.entries.forEach(function(e){html+='<div class="dir-item" data-dir="'+esc(e.path)+'">\uD83D\uDCC1 '+esc(e.name)+'</div>';});
              list.innerHTML=html;
              Array.from(list.querySelectorAll('.dir-item')).forEach(function(el){
                el.addEventListener('click',function(){
                  var p=el.getAttribute('data-dir');
                  if(el.classList.contains('dir-up')){etBrowseStack.pop();etBrowseLoad(p);}
                  else{etBrowseStack.push(p);etBrowseLoad(p);}
                });
                el.addEventListener('dblclick',function(e){
                  e.stopPropagation();
                  if(!el.classList.contains('dir-up')){document.getElementById('et-cw').value=el.getAttribute('data-dir');etBrowseCancel();etValidateCwd(el.getAttribute('data-dir'));}
                });
              });
              if(dirPath)document.getElementById('et-browse-select').disabled=false;
            }).catch(function(){list.innerHTML='<div class="ta-center mu" style="color:var(--red)">'+_t('browse.failedLoad')+'</div>';});
          }
        })();
      </script>`;

    return c.html(renderLayout(_tr(T, 'tasks.pageTitle'), 'tasks', body, T));
});

app.get('/templates', async (c) => {
    const cfg = loadConfig();
    const locale = cfg.dashboard?.locale || 'en';
    const T = getTranslations(locale);
    const templates = await TaskTemplateService.list(100);

    for (const tmpl of templates) {
        if (tmpl.enabled && tmpl.scheduleType === 'cron' && tmpl.cronExpr) {
            try {
                const { getNextCronRun } = await import('@core/cron-parser');
                tmpl.nextRunAt = getNextCronRun(tmpl.cronExpr, Date.now());
            } catch { /* keep existing */ }
        }
    }

    const enabled = templates.filter(t => t.enabled).length;
    const disabled = templates.length - enabled;

    let rows = '';
    for (const t of templates) {
        const typeLabel = t.scheduleType === 'cron' ? _tr(T, 'template.type.cron') : t.scheduleType === 'recurring' ? _tr(T, 'template.type.recurring') : _tr(T, 'template.type.delayed');
        const typeClass = 'tag t-' + t.scheduleType;
        let rule = '-';
        if (t.scheduleType === 'cron') rule = t.cronExpr || '-';
        else if (t.scheduleType === 'recurring') rule = t.intervalMs ? `${Math.floor(t.intervalMs / 60000)}min` : '-';
        else if (t.scheduleType === 'delayed') rule = formatDate(t.runAt);

        const statusBadge = t.enabled
            ? `<span class="badge b-done">${esc(_tr(T, 'status.enabled'))}</span>`
            : `<span class="badge b-cancelled">${esc(_tr(T, 'status.disabled'))}</span>`;
        const toggleBtn = t.enabled
            ? `<button class="btn btn-sm btn-warn" onclick="disableTmpl(${t.id})">${esc(_tr(T, 'btn.disable'))}</button>`
            : `<button class="btn btn-sm" onclick="enableTmpl(${t.id})">${esc(_tr(T, 'btn.enable'))}</button>`;

        rows += `<tr>
          <td class="mu">#${t.id}</td>
          <td><div style="font-weight:500">${esc(t.name)}</div><div class="mu sm el">${esc(t.prompt.substring(0, 100))}</div>
            <div class="sm" style="margin-top:2px"><span class="tag">${esc(t.agent)}</span>${t.model && t.model !== 'default' ? ` <span class="tag">${esc(t.model)}</span>` : ''}</div></td>
          <td><span class="${typeClass}">${typeLabel}</span></td>
          <td class="m sm">${rule}</td>
          <td>${statusBadge}</td>
          <td class="sm">${t.lastRunAt ? timeAgo(t.lastRunAt) : '-'}</td>
          <td class="sm">${t.nextRunAt ? timeUntil(t.nextRunAt) : '-'}</td>
          <td>
            <button class="btn btn-sm" onclick="showTemplateDetail(${t.id})">${esc(_tr(T, 'btn.details'))}</button>
            <button class="btn btn-sm" onclick="editTemplate(${t.id})">${esc(_tr(T, 'btn.edit'))}</button>
            <button class="btn btn-sm btn-primary" onclick="triggerTmpl(${t.id})">${esc(_tr(T, 'btn.trigger'))}</button>
            ${toggleBtn}
            <button class="btn btn-sm btn-danger" onclick="deleteTmpl(${t.id})">${esc(_tr(T, 'btn.delete'))}</button>
          </td></tr>`;
    }

    const emptyRow = templates.length === 0
        ? `<tr><td colspan="8" class="ta-center mu p30">${esc(_tr(T, 'template.empty'))}</td></tr>`
        : '';

    const body = `
      <div class="g3">
        <div class="card"><div class="sv" style="color:var(--purple)">${templates.length}</div><div class="sl">${esc(_tr(T, 'template.stats.total'))}</div></div>
        <div class="card"><div class="sv" style="color:var(--green)">${enabled}</div><div class="sl">${esc(_tr(T, 'template.stats.enabled'))}</div></div>
        <div class="card"><div class="sv" style="color:var(--t2)">${disabled}</div><div class="sl">${esc(_tr(T, 'template.stats.disabled'))}</div></div>
      </div>
      <div class="panel">
        <div class="ph"><h3>${esc(_tr(T, 'template.panel.title'))}</h3></div>
        <table>
          <thead><tr><th width="50">${esc(_tr(T, 'table.id'))}</th><th>${esc(_tr(T, 'table.name'))}</th><th>${esc(_tr(T, 'table.type'))}</th><th>${esc(_tr(T, 'table.rule'))}</th><th width="90">${esc(_tr(T, 'table.status'))}</th><th>${esc(_tr(T, 'table.lastRun'))}</th><th>${esc(_tr(T, 'table.nextRun'))}</th><th>${esc(_tr(T, 'table.actions'))}</th></tr></thead>
          <tbody>${rows}${emptyRow}</tbody>
        </table>
      </div>
      <script>
        (function(){
          var p=new URLSearchParams(location.search);
          if(p.get('created')&&!window.__templateCreatedToast){
            window.__templateCreatedToast=true;
            document.getElementById('toast').textContent=_tf('toast.templateCreated',p.get('created'));
            document.getElementById('toast').className='toast toast-ok';
            document.getElementById('toast').style.display='block';
            setTimeout(function(){document.getElementById('toast').style.display='none';},3000);
            history.replaceState({},'',location.pathname);
          }
        })();
      </script>

      <dialog id="etm-modal" class="et-wide">
        <div class="dh"><h3 style="margin:0">${esc(_tr(T, 'template.edit.title'))}</h3><button class="cb" onclick="document.getElementById('etm-modal').close()">&times;</button></div>
        <div class="db">
          <input type="hidden" id="etm-id">
          <div id="etm-form-view">
            <div class="field">
              <label>${esc(_tr(T, 'template.edit.field.name'))}<span class="hl">*</span></label>
              <input type="text" id="etm-name" placeholder="${esc(_tr(T, 'template.edit.placeholder.name'))}">
            </div>
            <div class="field-grid">
              <div class="field">
                <label>${esc(_tr(T, 'clone.field.agent'))}<span class="hl">*</span></label>
                <select id="etm-ag"><option value="">${esc(_tr(T, 'template.edit.selectAgent'))}</option></select>
              </div>
              <div class="field">
                <label>${esc(_tr(T, 'clone.field.model'))}</label>
                <input type="text" id="etm-mo" list="etm-model-suggestions" placeholder="${esc(_tr(T, 'template.edit.placeholder.model'))}">
                <datalist id="etm-model-suggestions"></datalist>
              </div>
            </div>
            <div class="field">
              <label>${esc(_tr(T, 'clone.field.prompt'))}<span class="hl">*</span></label>
              <textarea id="etm-pr" style="min-height:120px" placeholder="${esc(_tr(T, 'template.edit.placeholder.prompt'))}"></textarea>
            </div>
            <div class="field">
              <label>${esc(_tr(T, 'clone.field.workingDir'))}</label>
              <div class="cwd-row">
                <input type="text" id="etm-cw" class="cwd-input" placeholder="${esc(_tr(T, 'template.edit.placeholder.dir'))}" autocomplete="off">
                <span id="etm-cwd-status" class="cwd-status"></span>
                <button type="button" id="etm-btn-browse" class="btn" style="white-space:nowrap" onclick="etmOpenBrowse()">${esc(_tr(T, 'btn.browse'))}</button>
              </div>
              <div id="etm-cwd-error" class="field-error"></div>
            </div>
            <div class="card" style="margin-bottom:20px;padding:14px 16px">
              <div class="field"><label>${esc(_tr(T, 'template.edit.field.scheduleType'))}</label>
                <select id="etm-schtype" onchange="editTmplToggleFields()">
                  <option value="cron">${esc(_tr(T, 'template.type.cron'))}</option>
                  <option value="recurring">${esc(_tr(T, 'template.type.recurring'))}</option>
                  <option value="delayed">${esc(_tr(T, 'template.type.delayed'))}</option>
                </select>
              </div>
              <div id="etm-cron-section" class="field">
                <label>${esc(_tr(T, 'template.edit.field.cronExpr'))} <span class="hl">*</span></label>
                <input type="text" id="etm-cronexpr" placeholder="${esc(_tr(T, 'template.edit.placeholder.cron'))}" style="font-family:monospace">
              </div>
              <div id="etm-recurring-section" class="field" style="display:none">
                <label>${esc(_tr(T, 'template.edit.field.repeatEvery'))}</label>
                <div class="field-inline">
                  <input type="number" id="etm-intervalval" value="6" min="1" style="width:80px;flex:none">
                  <select id="etm-intervalunit">
                    <option value="minutes">${esc(_tr(T, 'template.edit.unit.minutes'))}</option>
                    <option value="hours" selected>${esc(_tr(T, 'template.edit.unit.hours'))}</option>
                    <option value="days">${esc(_tr(T, 'template.edit.unit.days'))}</option>
                  </select>
                </div>
              </div>
              <div id="etm-delayed-section" class="field" style="display:none">
                <label>${esc(_tr(T, 'template.edit.field.runIn'))}</label>
                <input type="number" id="etm-delayval" value="30" min="1" style="width:100px">
              </div>
            </div>
            <div class="field-grid">
              <div class="field">
                <label>${esc(_tr(T, 'clone.field.category'))}</label>
                <select id="etm-ca"><option value="general">general</option><option value="translate">translate</option><option value="generate">generate</option><option value="review">review</option><option value="test">test</option></select>
              </div>
              <div class="field">
                <label>${esc(_tr(T, 'clone.field.maxRetries'))}</label>
                <select id="etm-mr"><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="5">5</option><option value="10">10</option></select>
              </div>
            </div>
            <div class="field-grid">
              <div class="field">
                <label>${esc(_tr(T, 'clone.field.importance'))}</label>
                <div class="field-inline">
                  <div class="stars" id="etm-stars-im"><input type="hidden" name="etm-im" value="3"><span class="star on">\u2605</span><span class="star on">\u2605</span><span class="star on">\u2605</span><span class="star">\u2605</span><span class="star">\u2605</span></div>
                  <span class="mu sm" id="etm-stars-im-label">${esc(_tr(T, 'stars.medium'))}</span>
                </div>
              </div>
              <div class="field">
                <label>${esc(_tr(T, 'clone.field.urgency'))}</label>
                <div class="field-inline">
                  <div class="stars" id="etm-stars-ur"><input type="hidden" name="etm-ur" value="3"><span class="star on">\u2605</span><span class="star on">\u2605</span><span class="star on">\u2605</span><span class="star">\u2605</span><span class="star">\u2605</span></div>
                  <span class="mu sm" id="etm-stars-ur-label">${esc(_tr(T, 'stars.medium'))}</span>
                </div>
              </div>
            </div>
            <div class="field"><label>${esc(_tr(T, 'template.edit.status'))} <span id="etm-status" class="badge b-done">${esc(_tr(T, 'status.enabled'))}</span></label></div>
          </div>
          <div id="etm-notify-section"></div>
          <div id="etm-browse-view" style="display:none;min-height:300px">
            <div class="ph" style="padding:8px 12px;margin-bottom:8px;border:1px solid var(--border);border-radius:4px">
              <span class="mu sm" id="etm-browse-path">${esc(_tr(T, 'browse.home'))}</span>
            </div>
            <div id="etm-browse-list" style="min-height:200px"></div>
            <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:10px;border-top:1px solid var(--border);margin-top:10px">
              <button class="btn" onclick="etmBrowseCancel()">${esc(_tr(T, 'btn.cancel'))}</button>
              <button class="rf" id="etm-browse-select" onclick="etmBrowseSelect()" disabled>${esc(_tr(T, 'btn.selectFolder'))}</button>
            </div>
          </div>
        </div>
        <div class="modal-footer" id="etm-modal-footer">
          <button class="btn" onclick="document.getElementById('etm-modal').close()">${esc(_tr(T, 'btn.cancel'))}</button>
          <button class="rf" onclick="saveEditTemplate()">${esc(_tr(T, 'btn.saveChanges'))}</button>
        </div>
      </dialog>

      <script>
        (function(){
          var etmCwdTimeout,etmBrowseStack=[],etmBrowsePath='';
          function esc(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
          function etmValidateCwd(path){
            var s=document.getElementById('etm-cwd-status'),e=document.getElementById('etm-cwd-error');
            s.textContent='\u23F3';e.textContent='';
            if(!path){s.textContent='';e.textContent='';return;}
            fetch('/api/fs/validate?path='+encodeURIComponent(path)).then(function(r){return r.json()}).then(function(v){
              if(v.valid){s.textContent='\u2705';s.style.color='#3fb950';e.textContent='';}
              else{s.textContent='\u274C';s.style.color='#f85149';e.textContent=v.error;}
            }).catch(function(){s.textContent='\u274C';s.style.color='#f85149';e.textContent=_t('alert.validationFailed');});
          }
          document.getElementById('etm-cw').addEventListener('input',function(){
            clearTimeout(etmCwdTimeout);var p=this.value;
            etmCwdTimeout=setTimeout(function(){etmValidateCwd(p);},500);
          });
          document.getElementById('etm-cw').addEventListener('change',function(){etmValidateCwd(this.value);});
          window.etmOpenBrowse=function(parentPath){
            etmBrowsePath=parentPath||'';etmBrowseStack=etmBrowsePath?[etmBrowsePath]:[];
            document.getElementById('etm-form-view').style.display='none';
            document.getElementById('etm-browse-view').style.display='block';
            document.getElementById('etm-modal-footer').style.display='none';
            etmBrowseLoad(etmBrowsePath);
          };
          window.etmBrowseCancel=function(){
            document.getElementById('etm-form-view').style.display='block';
            document.getElementById('etm-browse-view').style.display='none';
            document.getElementById('etm-modal-footer').style.display='flex';
          };
          window.etmBrowseSelect=function(){
            if(!etmBrowseStack.length)return;
            document.getElementById('etm-cw').value=etmBrowseStack[etmBrowseStack.length-1];
            etmBrowseCancel();
            etmValidateCwd(etmBrowseStack[etmBrowseStack.length-1]);
          };
          function etmBrowseLoad(dirPath){
            var list=document.getElementById('etm-browse-list');
            list.innerHTML='<div class="ta-center mu p30">'+_t('browse.loading')+'</div>';
            document.getElementById('etm-browse-select').disabled=true;
            var url='/api/fs/browse';if(dirPath)url+='?path='+encodeURIComponent(dirPath);
            fetch(url).then(function(r){return r.json()}).then(function(data){
              document.getElementById('etm-browse-path').textContent=dirPath||_t('browse.home');
              if(!data.entries||data.entries.length===0){list.innerHTML='<div class="ta-center mu p30">'+_t('browse.empty')+'</div>';return;}
              var html='';
              if(dirPath)html+='<div class="dir-item dir-up" data-dir="'+(etmBrowseStack.length>1?etmBrowseStack[etmBrowseStack.length-2]:'')+'">\u2190 '+_t('browse.parentDir')+'</div>';
              data.entries.forEach(function(e){html+='<div class="dir-item" data-dir="'+esc(e.path)+'">\uD83D\uDCC1 '+esc(e.name)+'</div>';});
              list.innerHTML=html;
              Array.from(list.querySelectorAll('.dir-item')).forEach(function(el){
                el.addEventListener('click',function(){
                  var p=el.getAttribute('data-dir');
                  if(el.classList.contains('dir-up')){etmBrowseStack.pop();etmBrowseLoad(p);}
                  else{etmBrowseStack.push(p);etmBrowseLoad(p);}
                });
                el.addEventListener('dblclick',function(e){
                  e.stopPropagation();
                  if(!el.classList.contains('dir-up')){document.getElementById('etm-cw').value=el.getAttribute('data-dir');etmBrowseCancel();etmValidateCwd(el.getAttribute('data-dir'));}
                });
              });
              if(dirPath)document.getElementById('etm-browse-select').disabled=false;
            }).catch(function(){list.innerHTML='<div class="ta-center mu" style="color:var(--red)">'+_t('browse.failedLoad')+'</div>';});
          }
        })();
      </script>`;

    return c.html(renderLayout(_tr(T, 'template.pageTitle'), 'templates', body, T));
});

app.get('/runs', async (c) => {
    const cfg = loadConfig();
    const locale = cfg.dashboard?.locale || 'en';
    const T = getTranslations(locale);
    const page = Number(c.req.query('page') || '1');
    const range = c.req.query('range') || '';
    const limit = 50;
    const offset = (page - 1) * limit;
    const { taskRuns: tr, tasks: tk } = schema;
    const cutoffSec = getRangeCutoff(range);
    const timeWhere = cutoffSec ? sql`${tr.startedAt} >= ${cutoffSec}` : sql`1=1`;
    const runs = await db.select({
        id: tr.id, taskId: tr.taskId, sessionId: tr.sessionId, model: tr.model,
        status: tr.status, startedAt: tr.startedAt, finishedAt: tr.finishedAt,
        log: tr.log, heartbeatAt: tr.heartbeatAt, workerPid: tr.workerPid, childPid: tr.childPid,
        toolsUsed: tr.toolsUsed, skillsUsed: tr.skillsUsed,
        inputTokens: tr.inputTokens, outputTokens: tr.outputTokens,
        totalTokens: tr.totalTokens, costUsd: tr.costUsd,
        taskName: tk.name, taskAgent: tk.agent,
    }).from(tr).innerJoin(tk, eq(tr.taskId, tk.id))
      .where(timeWhere)
      .orderBy(desc(tr.startedAt)).limit(limit).offset(offset);

    const [agg] = await db.select({
        totalCost: sql<number>`COALESCE(SUM(${tr.costUsd}), 0)`,
        totalTokens: sql<number>`COALESCE(SUM(${tr.totalTokens}), 0)`,
        totalRuns: sql<number>`count(*)`,
        doneCount: sql<number>`COALESCE(SUM(CASE WHEN ${tr.status} = 'done' THEN 1 ELSE 0 END), 0)`,
        failedCount: sql<number>`COALESCE(SUM(CASE WHEN ${tr.status} = 'failed' THEN 1 ELSE 0 END), 0)`,
        runningCount: sql<number>`COALESCE(SUM(CASE WHEN ${tr.status} = 'running' THEN 1 ELSE 0 END), 0)`,
    }).from(tr).where(timeWhere);

    const total = Number(agg.totalRuns ?? 0);
    const totalPages = Math.ceil(total / limit);
    const rangeLabel = range || _tr(T, 'runs.allTime');

    let rows = '';
    const logsHtml: string[] = [];
    for (const run of runs) {
        const shortSession = run.sessionId
            ? run.sessionId.slice(4, 7) + '***' + run.sessionId.slice(-3)
            : '-';
        const logBtn = run.log
            ? `<button class="btn btn-sm" onclick="toggleLog(${run.id})">${esc(_tr(T, 'btn.log'))}</button>`
            : '';
        const sessBtn = `<button class="btn btn-sm" onclick="viewSession(${run.id})">${esc(_tr(T, 'btn.session'))}</button>`;
        const toolsList = run.toolsUsed
            ? (JSON.parse(run.toolsUsed) as string[]).map(t => `<span class="tag">${esc(t)}</span>`).join(' ')
            : '<span class="mu sm">-</span>';
        const skillsList = run.skillsUsed
            ? (JSON.parse(run.skillsUsed) as string[]).map(s => `<span class="tag" style="border-color:var(--purple);color:var(--purple)">${esc(s)}</span>`).join(' ')
            : '';
        const tokensStr = run.inputTokens !== null && run.outputTokens !== null
            ? `${formatTokens(run.inputTokens)}→${formatTokens(run.outputTokens)}`
            : '-';
        const costStr = formatCost(run.costUsd);

        rows += `<tr>
          <td class="mu">#${run.id}</td>
          <td><div style="font-weight:500">${esc(run.taskName)} <span class="mu">(#${run.taskId})</span></div>
            ${run.model ? `<div class="sm"><span class="tag">${esc(run.model)}</span></div>` : ''}</td>
          <td><span class="tag">${esc(run.taskAgent)}</span></td>
          <td class="sm" style="max-width:200px">${toolsList} ${skillsList}</td>
          <td><span class="badge b-${run.status}">${(run.status ?? '').toUpperCase()}</span></td>
          <td class="m sm">${tokensStr}</td>
          <td class="sm">${costStr}</td>
          <td class="sm">${formatDuration(run.startedAt, run.finishedAt)}</td>
          <td class="sm mu">${run.heartbeatAt ? timeAgo(run.heartbeatAt) : '-'}</td>
          <td><button class="btn btn-sm" onclick="showRunDetail(${run.id})">${esc(_tr(T, 'btn.details'))}</button>${logBtn}${sessBtn}</td>
        </tr>`;

        if (run.log) {
            logsHtml.push(`<div id="log-${run.id}" style="display:none" class="mt8">
              <div class="panel"><div class="ph"><h3>${esc(_tr(T, 'runs.logTitle', run.id, run.taskName))}</h3></div>
              <div class="log-box">${run.log.replace(/</g, '&lt;')}</div></div></div>`);
        }
    }

    const qp = range ? `?range=${range}` : '';
    let paging = `<div class="pn">`;
    if (page > 1) paging += `<a href="/runs?page=${page - 1}${qp ? '&' + qp.slice(1) : ''}" class="btn">${esc(_tr(T, 'btn.prev'))}</a>`;
    paging += `<span class="mu sm">${esc(_tr(T, 'pagination.pageRecords', page, totalPages, total, rangeLabel))}</span>`;
    if (page < totalPages) paging += `<a href="/runs?page=${page + 1}${qp ? '&' + qp.slice(1) : ''}" class="btn">${esc(_tr(T, 'btn.next'))}</a>`;
    paging += `</div>`;

    const colCount = runs.length > 0 ? 10 : 10;
    const emptyRow = runs.length === 0
        ? `<tr><td colspan="${colCount}" class="ta-center mu p30">${esc(_tr(T, 'runs.empty'))}</td></tr>`
        : '';

    const body = `
      ${RangeBar(range, '/runs', '', T)}
      <div class="g4">
        <div class="card"><div class="sv" style="color:var(--yellow)">${formatCost(agg.totalCost)}</div><div class="sl">${esc(_tr(T, 'runs.stats.totalCost', rangeLabel))}</div></div>
        <div class="card"><div class="sv" style="color:var(--blue)">${formatTokens(agg.totalTokens)}</div><div class="sl">${esc(_tr(T, 'runs.stats.totalTokens', rangeLabel))}</div></div>
        <div class="card"><div class="sv" style="color:var(--green)">${agg.doneCount}</div><div class="sl">${esc(_tr(T, 'runs.stats.done', rangeLabel))}</div></div>
        <div class="card"><div class="sv" style="color:var(--red)">${agg.failedCount}</div><div class="sl">${esc(_tr(T, 'runs.stats.failed', rangeLabel))}</div></div>
      </div>
      <div class="panel"><table>
        <thead><tr><th width="50">${esc(_tr(T, 'table.run'))}</th><th>${esc(_tr(T, 'table.task'))}</th><th>${esc(_tr(T, 'table.agent'))}</th><th>${esc(_tr(T, 'table.tools'))}</th><th width="90">${esc(_tr(T, 'table.status'))}</th><th width="90">${esc(_tr(T, 'table.tokens'))}</th><th width="80">${esc(_tr(T, 'table.cost'))}</th><th width="70">${esc(_tr(T, 'table.duration'))}</th><th>${esc(_tr(T, 'table.heartbeat'))}</th><th>${esc(_tr(T, 'table.actions'))}</th></tr></thead>
        <tbody>${rows}${emptyRow}</tbody>
      </table></div>
      ${logsHtml.join('')}
      ${paging}`;

    return c.html(renderLayout(_tr(T, 'runs.pageTitle'), 'runs', body, T));
});

app.get('/system', async (c) => {
    const cfg = loadConfig();
    const locale = cfg.dashboard?.locale || 'en';
    const T = getTranslations(locale);
    const config = loadConfig();
    const stats = await TaskService.stats({});
    const runningRuns = await TaskRunService.getAllRunningRuns();
    const templates = await TaskTemplateService.list(100);
    const configExists = existsSync(CONFIG_PATH);

    let runRows = '';
    if (runningRuns.length > 0) {
        for (const run of runningRuns) {
            const shortS = run.sessionId
                ? run.sessionId.slice(4, 7) + '***' + run.sessionId.slice(-3)
                : '-';
            runRows += `<tr>
              <td class="mu">#${run.id}</td><td>#${run.taskId}</td>
              <td class="m sm">${shortS}</td>
              <td class="sm">${esc(run.model) || '-'}</td>
              <td class="sm">${formatDate(run.startedAt)}</td>
              <td class="sm">${run.heartbeatAt ? timeAgo(run.heartbeatAt) : '-'}</td>
              <td class="m sm">W:${run.workerPid ?? '-'} C:${run.childPid ?? '-'}</td>
              <td class="sm">${formatDuration(run.startedAt, null)}</td>
            </tr>`;
        }
    }

    const schedulerStatus = config.scheduler.enabled ? '<span class="badge b-done">'+esc(_tr(T, 'status.enabled'))+'</span>' : '<span class="badge b-cancelled">'+esc(_tr(T, 'status.disabled'))+'</span>';
    const configFileStatus = configExists ? '<span class="badge b-done">'+esc(_tr(T, 'status.yes'))+'</span>' : '<span class="badge b-cancelled">'+esc(_tr(T, 'status.noDefaults'))+'</span>';

    const body = `
      <form id="config-form" onsubmit="event.preventDefault();saveConfig();">
      <div class="g3">
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:14px">${esc(_tr(T, 'system.worker.title'))}</h3>
          <div class="form-row"><label>${esc(_tr(T, 'system.worker.maxConcurrency'))}<span class="tip" onmouseenter="showTip(this,'${esc(_tr(T, 'tasks.tooltip.maxConcurrency'))}')" onmouseleave="hideTip()">i</span></label><input type="number" name="mc" value="${config.worker.maxConcurrency}" min="1" max="20" style="width:80px"></div>
          <div class="form-row"><label>${esc(_tr(T, 'system.worker.pollInterval'))}<span class="tip" onmouseenter="showTip(this,'${esc(_tr(T, 'tasks.tooltip.pollInterval'))}')" onmouseleave="hideTip()">i</span></label><input type="number" name="pi" value="${config.worker.pollIntervalMs}" min="100" style="width:100px"></div>
          <div class="form-row"><label>${esc(_tr(T, 'system.worker.heartbeat'))}<span class="tip" onmouseenter="showTip(this,'${esc(_tr(T, 'tasks.tooltip.heartbeat'))}')" onmouseleave="hideTip()">i</span></label><input type="number" name="hi" value="${config.worker.heartbeatIntervalMs / 1000}" min="5" style="width:100px"></div>
          <div class="form-row"><label>${esc(_tr(T, 'system.worker.taskTimeout'))}<span class="tip" onmouseenter="showTip(this,'${esc(_tr(T, 'tasks.tooltip.taskTimeout'))}')" onmouseleave="hideTip()">i</span></label><input type="number" name="to" value="${config.worker.taskTimeoutMs / 60000}" min="1" style="width:100px"></div>
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:14px">${esc(_tr(T, 'system.scheduler.title'))}</h3>
          <div class="form-row"><label>${esc(_tr(T, 'system.scheduler.enabled'))}<span class="tip" onmouseenter="showTip(this,'${esc(_tr(T, 'tasks.tooltip.schedulerEnabled'))}')" onmouseleave="hideTip()">i</span></label><input type="checkbox" name="se" ${config.scheduler.enabled ? 'checked' : ''}></div>
          <div class="form-row"><label>${esc(_tr(T, 'system.scheduler.checkInterval'))}<span class="tip" onmouseenter="showTip(this,'${esc(_tr(T, 'tasks.tooltip.schedulerInterval'))}')" onmouseleave="hideTip()">i</span></label><input type="number" name="si" value="${config.scheduler.checkIntervalMs}" min="100" style="width:100px"></div>
          <div class="form-row"><label>${esc(_tr(T, 'system.scheduler.catchUp'))}<span class="tip" onmouseenter="showTip(this,'${esc(_tr(T, 'tasks.tooltip.catchUp'))}')" onmouseleave="hideTip()">i</span></label><select name="cu" style="width:100px">
            <option value="next" ${config.scheduler.catchUp === 'next' ? 'selected' : ''}>next</option>
            <option value="all" ${config.scheduler.catchUp === 'all' ? 'selected' : ''}>all</option>
            <option value="latest" ${config.scheduler.catchUp === 'latest' ? 'selected' : ''}>latest</option>
          </select></div>
          <div class="ir"><span class="ik">${esc(_tr(T, 'system.scheduler.activeTemplates'))}<span class="tip" onmouseenter="showTip(this,'${esc(_tr(T, 'tasks.tooltip.activeTemplates'))}')" onmouseleave="hideTip()">i</span></span><span class="iv">${templates.filter(t => t.enabled).length} / ${templates.length}</span></div>
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:14px">${esc(_tr(T, 'system.watchdog.title'))}</h3>
          <div class="form-row"><label>${esc(_tr(T, 'system.watchdog.heartbeatTimeout'))}<span class="tip" onmouseenter="showTip(this,'${esc(_tr(T, 'tasks.tooltip.heartbeatTimeout'))}')" onmouseleave="hideTip()">i</span></label><input type="number" name="wt" value="${config.watchdog.heartbeatTimeoutMs / 1000}" min="10" style="width:100px"></div>
          <div class="form-row"><label>${esc(_tr(T, 'system.watchdog.cleanupInterval'))}<span class="tip" onmouseenter="showTip(this,'${esc(_tr(T, 'tasks.tooltip.cleanupInterval'))}')" onmouseleave="hideTip()">i</span></label><input type="number" name="wc" value="${config.watchdog.cleanupIntervalMs / 1000}" min="10" style="width:100px"></div>
          <div class="form-row"><label>${esc(_tr(T, 'system.watchdog.retention'))}<span class="tip" onmouseenter="showTip(this,'${esc(_tr(T, 'tasks.tooltip.retention'))}')" onmouseleave="hideTip()">i</span></label><input type="number" name="rd" value="${config.watchdog.retentionDays}" min="1" style="width:100px"></div>
          <div class="ir"><span class="ik">${esc(_tr(T, 'system.watchdog.logFormat'))}<span class="tip" onmouseenter="showTip(this,'${esc(_tr(T, 'tasks.tooltip.logFormat'))}')" onmouseleave="hideTip()">i</span></span><span class="iv">${config.logging.format}</span></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:24px;padding:16px">
        <h3 style="margin:0 0 12px;font-size:14px">${esc(_tr(T, 'lang.label'))}</h3>
        <div class="form-row">
          <label for="locale-select">${esc(_tr(T, 'lang.label'))}</label>
          <select name="locale" id="locale-select" style="width:200px">
            <option value="en" ${locale === 'en' ? 'selected' : ''}>${esc(_tr(T, 'lang.en'))}</option>
            <option value="pt-BR" ${locale === 'pt-BR' ? 'selected' : ''}>${esc(_tr(T, 'lang.ptBR'))}</option>
          </select>
        </div>
      </div>
      <div style="text-align:center;margin-bottom:24px">
        <button type="submit" class="rf" style="font-size:14px;padding:10px 30px">${esc(_tr(T, 'btn.saveConfig'))}</button>
        <span class="mu sm" style="margin-left:12px">${esc(_tr(T, 'system.restartHint'))}</span>
      </div>
      </form>

      <div class="panel mt8">
        <div class="ph"><h3>${esc(_tr(T, 'system.running.title', runningRuns.length, config.worker.maxConcurrency))}</h3></div>
        ${runningRuns.length > 0 ? `<table>
          <thead><tr><th>${esc(_tr(T, 'table.run'))}</th><th>${esc(_tr(T, 'table.task'))}</th><th>${esc(_tr(T, 'table.session'))}</th><th>${esc(_tr(T, 'table.model'))}</th><th>${esc(_tr(T, 'table.started'))}</th><th>${esc(_tr(T, 'table.heartbeat'))}</th><th>${esc(_tr(T, 'table.pid'))}</th><th>${esc(_tr(T, 'table.duration'))}</th></tr></thead>
          <tbody>${runRows}</tbody>
        </table>` : `<div class="ta-center mu p30">${esc(_tr(T, 'system.running.empty'))}</div>`}
      </div>

      <div class="card mt16">
        <h3 style="margin:0 0 12px;font-size:14px">${esc(_tr(T, 'system.stats.title'))}</h3>
        <div class="g4 mb0">
          <div><span class="mu sm">${esc(_tr(T, 'system.stats.pending'))}</span> <strong>${stats.pending || 0}</strong></div>
          <div><span class="mu sm">${esc(_tr(T, 'system.stats.running'))}</span> <strong style="color:var(--blue)">${stats.running || 0}</strong></div>
          <div><span class="mu sm">${esc(_tr(T, 'system.stats.done'))}</span> <strong style="color:var(--green)">${stats.done || 0}</strong></div>
          <div><span class="mu sm">${esc(_tr(T, 'system.stats.failed'))}</span> <strong style="color:var(--red)">${(stats.failed || 0) + (stats.dead_letter || 0)}</strong></div>
        </div>
      </div>

      <div class="card mt16">
        <h3 style="margin:0 0 12px;font-size:14px">${esc(_tr(T, 'system.configFile.title'))}</h3>
        <div class="ir"><span class="ik">${esc(_tr(T, 'system.configFile.path'))}<span class="tip" onmouseenter="showTip(this,'${esc(_tr(T, 'tasks.tooltip.configPath'))}')" onmouseleave="hideTip()">i</span></span><span class="iv m sm">${CONFIG_PATH}</span></div>
        <div class="ir"><span class="ik">${esc(_tr(T, 'system.configFile.exists'))}<span class="tip" onmouseenter="showTip(this,'${esc(_tr(T, 'tasks.tooltip.configExists'))}')" onmouseleave="hideTip()">i</span></span><span class="iv">${configFileStatus}</span></div>
      </div>

      <div class="card mt16" style="border-color:var(--red)">
        <h3 style="margin:0 0 12px;font-size:14px;color:var(--red)">${esc(_tr(T, 'system.danger.title'))}</h3>
        <p class="sm mu" style="margin:0 0 12px">${esc(_tr(T, 'system.danger.desc'))}</p>
        <button class="btn btn-danger" style="border-color:var(--red);color:var(--red);padding:6px 16px" onclick="clearDatabase()">${esc(_tr(T, 'btn.clearDatabase'))}</button>
      </div>`;

    return c.html(renderLayout(_tr(T, 'system.pageTitle'), 'system', body, T));
});

app.get('/notifications', async (c) => {
    const config = loadConfig();
    const nc = config.notifications;
    const allChannelNames: ChannelName[] = ['telegram', 'discord', 'slack', 'email', 'webhook'];
    const activeChannels = getActiveChannels(nc);

    function channelCard(name: ChannelName, cfg: Record<string, unknown>) {
        const label = CHANNEL_LABELS[name] || name;
        const icon = CHANNEL_ICONS[name] || '';
        const isActive = activeChannels.includes(name);

        let statusDot = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#6e7681;margin-right:6px"></span> Not configured';
        if (isActive) {
            statusDot = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3fb950;margin-right:6px"></span> Active';
        }

        let fields = '';
        if (name === 'telegram') {
            fields = `
                <div class="field"><label>Bot Token</label><input type="text" id="tgb-token" placeholder="123456:ABC-DEF..." value="${esc(String(cfg.botToken || ''))}"></div>
                <div class="field"><label>Chat ID</label><input type="text" id="tgb-chat" placeholder="-123456789" value="${esc(String(cfg.chatId || ''))}"></div>`;
        } else if (name === 'discord') {
            fields = `
                <div class="field"><label>Webhook URL</label><input type="text" id="dsc-url" placeholder="https://discord.com/api/webhooks/..." value="${esc(String(cfg.webhookUrl || ''))}"></div>`;
        } else if (name === 'slack') {
            fields = `
                <div class="field"><label>Webhook URL</label><input type="text" id="slk-url" placeholder="https://hooks.slack.com/services/..." value="${esc(String(cfg.webhookUrl || ''))}"></div>`;
        } else if (name === 'email') {
            fields = `
                <div class="field-grid">
                  <div class="field"><label>SMTP Host</label><input type="text" id="eml-host" placeholder="smtp.gmail.com" value="${esc(String(cfg.host || ''))}"></div>
                  <div class="field"><label>Port</label><input type="number" id="eml-port" value="${cfg.port || 587}" style="width:100px"></div>
                </div>
                <div class="field-grid">
                  <div class="field"><label>Username</label><input type="text" id="eml-user" placeholder="user@gmail.com" value="${esc(String(cfg.user || ''))}"></div>
                  <div class="field"><label>Password</label><input type="password" id="eml-pass" placeholder="App password" value="${esc(String(cfg.pass || ''))}"></div>
                </div>
                <div class="field-grid">
                  <div class="field"><label>From</label><input type="text" id="eml-from" placeholder="opencron@example.com" value="${esc(String(cfg.from || ''))}"></div>
                  <div class="field"><label>To</label><input type="text" id="eml-to" placeholder="admin@example.com" value="${esc(String(cfg.to || ''))}"></div>
                </div>`;
        } else if (name === 'webhook') {
            fields = `
                <div class="field"><label>URL</label><input type="text" id="whk-url" placeholder="https://your-service.com/webhook" value="${esc(String(cfg.url || ''))}"></div>
                <div class="field"><label>Headers (JSON)</label><input type="text" id="whk-headers" placeholder='{"X-API-Key": "..."}' value="${esc(cfg.headers ? JSON.stringify(cfg.headers) : '')}"></div>`;
        }

        const envVarHint = `<span class="mu sm" style="display:block;margin-top:4px">Use <code>$\{VARIABLE_NAME}</code> to read from environment variables. Secrets stay off disk.</span>`;

        return `
        <div class="card" style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:8px">
              ${icon} <strong>${label}</strong>
              <span style="font-size:12px">${statusDot}</span>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm" onclick="showSetupGuide('${name}')" title="Setup guide">?</button>
              <button class="btn btn-sm btn-primary" onclick="testChannel('${name}')">Test</button>
            </div>
          </div>
          ${fields}
          ${envVarHint}
          <div id="test-${name}-result" style="margin-top:8px;font-size:12px"></div>
        </div>`;
    }

    const defaultsOnSuccess = nc.defaults.on_success;
    const defaultsOnFailure = nc.defaults.on_failure;
    const defaultsOnDeadLetter = nc.defaults.on_dead_letter;

    function channelCheckboxes(prefix: string, selected: string[]) {
        return allChannelNames.map(ch =>
            `<label style="margin-right:12px;font-size:13px;display:inline-flex;align-items:center;gap:4px;cursor:pointer">
              <input type="checkbox" name="${prefix}-${ch}" ${selected.includes(ch) ? 'checked' : ''} style="width:auto"> ${CHANNEL_LABELS[ch]}
            </label>`
        ).join('');
    }

    let channelCards = '';
    for (const name of allChannelNames) {
        const cfg = nc.channels[name] || {};
        channelCards += channelCard(name, cfg);
    }

    const setupModals = allChannelNames.map(name => {
        const guide = CHANNEL_SETUP_GUIDES[name] || '';
        return `<dialog id="setup-${name}"><div class="dh"><h3 style="margin:0">Setup Guide: ${CHANNEL_LABELS[name]}</h3><button class="cb" onclick="document.getElementById('setup-${name}').close()">&times;</button></div><div class="db" style="font-size:13px;line-height:1.7">${guide}</div><div class="modal-footer"><button class="btn" onclick="document.getElementById('setup-${name}').close()">Close</button></div></dialog>`;
    }).join('');

    const body = `
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <h3 style="margin:0;font-size:14px">Notifications</h3>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
              <input type="checkbox" id="notify-enabled" ${nc.enabled ? 'checked' : ''} onchange="toggleNotificationsEnabled()" style="width:auto">
              <span id="notify-enabled-label">${nc.enabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>
        </div>
        <p class="mu sm" style="margin:0 0 12px">Changes require a Gateway restart to take effect on running tasks. The Test button works immediately.</p>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0;font-size:14px">Global Notification Defaults</h3>
          <button class="btn btn-sm btn-primary" onclick="saveNotificationDefaults()">Save Defaults</button>
        </div>
        <p class="mu sm" style="margin:0 0 12px">These channels fire for all tasks unless a task has custom notification settings.</p>
        <table>
          <thead><tr><th width="160">Event</th><th>Channels</th></tr></thead>
          <tbody>
            <tr>
              <td><span class="badge b-done">&#x2705; Success</span></td>
              <td>${channelCheckboxes('on_success', defaultsOnSuccess)}</td>
            </tr>
            <tr>
              <td><span class="badge b-failed">&#x274C; Failure</span></td>
              <td>${channelCheckboxes('on_failure', defaultsOnFailure)}</td>
            </tr>
            <tr>
              <td><span class="badge b-dead_letter">&#x1F480; Dead Letter</span></td>
              <td>${channelCheckboxes('on_dead_letter', defaultsOnDeadLetter)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0;font-size:14px">Channel Configuration</h3>
          <button class="btn btn-sm btn-primary" onclick="saveChannelConfigs()">Save Channels</button>
        </div>
        ${channelCards}
      </div>

      ${setupModals}

      <script>
        async function toggleNotificationsEnabled() {
          var cb = document.getElementById('notify-enabled');
          var label = document.getElementById('notify-enabled-label');
          var enabled = cb.checked;
          label.textContent = enabled ? 'Enabled' : 'Disabled';
          var r = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notifications: { enabled: enabled } })
          });
          var d = await r.json();
          if (!d.success) { cb.checked = !enabled; label.textContent = !enabled ? 'Enabled' : 'Disabled'; }
        }

        function showSetupGuide(name) {
          document.getElementById('setup-' + name).showModal();
        }

        async function saveNotificationDefaults() {
          const config = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              notifications: {
                defaults: {
                  on_success: getCheckedChannels('on_success'),
                  on_failure: getCheckedChannels('on_failure'),
                  on_dead_letter: getCheckedChannels('on_dead_letter'),
                }
              }
            })
          });
          const d = await config.json();
          showToast(d.success ? 'Defaults saved' : 'Save failed: ' + d.error, d.success);
        }

        function getCheckedChannels(prefix) {
          const names = ['telegram','discord','slack','email','webhook'];
          return names.filter(function(n) {
            var el = document.querySelector('input[name="' + prefix + '-' + n + '"]');
            return el && el.checked;
          });
        }

        async function saveChannelConfigs() {
          var channels = {};
          channels.telegram = { botToken: document.getElementById('tgb-token').value, chatId: document.getElementById('tgb-chat').value };
          channels.discord = { webhookUrl: document.getElementById('dsc-url').value };
          channels.slack = { webhookUrl: document.getElementById('slk-url').value };
          channels.email = {
            host: document.getElementById('eml-host').value,
            port: parseInt(document.getElementById('eml-port').value) || 587,
            secure: false,
            user: document.getElementById('eml-user').value,
            pass: document.getElementById('eml-pass').value,
            from: document.getElementById('eml-from').value,
            to: document.getElementById('eml-to').value,
          };
          var headersRaw = document.getElementById('whk-headers').value.trim();
          var headers = {};
          if (headersRaw) {
            try { headers = JSON.parse(headersRaw); } catch(e) { alert('Invalid JSON in headers field'); return; }
          }
          channels.webhook = { url: document.getElementById('whk-url').value, headers: headers };
          const config = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notifications: { channels: channels } })
          });
          const d = await config.json();
          showToast(d.success ? 'Channel configs saved' : 'Save failed: ' + d.error, d.success);
        }

        async function testChannel(name) {
          var resultEl = document.getElementById('test-' + name + '-result');
          resultEl.innerHTML = '<span style="color:var(--yellow)">Testing...</span>';
          var cfg = {};
          if(name==='telegram'){cfg.botToken=document.getElementById('tgb-token').value;cfg.chatId=document.getElementById('tgb-chat').value;}
          else if(name==='discord'){cfg.webhookUrl=document.getElementById('dsc-url').value;}
          else if(name==='slack'){cfg.webhookUrl=document.getElementById('slk-url').value;}
          else if(name==='email'){cfg.host=document.getElementById('eml-host').value;cfg.port=parseInt(document.getElementById('eml-port').value)||587;cfg.user=document.getElementById('eml-user').value;cfg.pass=document.getElementById('eml-pass').value;cfg.from=document.getElementById('eml-from').value;cfg.to=document.getElementById('eml-to').value;}
          else if(name==='webhook'){cfg.url=document.getElementById('whk-url').value;}
          try {
            var r = await fetch('/api/notifications/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: name, config: cfg }) });
            var d = await r.json();
            if (d.success) {
              resultEl.innerHTML = '<span style="color:var(--green)">Test sent successfully!</span>';
            } else {
              resultEl.innerHTML = '<span style="color:var(--red)">Test failed: ' + (d.error || 'unknown error') + '</span>';
            }
          } catch(e) {
            resultEl.innerHTML = '<span style="color:var(--red)">Test failed: ' + e.message + '</span>';
          }
        }

        function showToast(msg, ok) {
          var t = document.getElementById('toast');
          t.textContent = msg;
          t.className = 'toast ' + (ok ? 'toast-ok' : 'toast-err');
          t.style.display = 'block';
          setTimeout(function() { t.style.display = 'none'; }, 3000);
        }
      </script>`;

    const _cfgN = loadConfig();
    const _localeN = _cfgN.dashboard?.locale || 'en';
    const _TN = getTranslations(_localeN);
    const bodyN = body;
    return c.html(renderLayout('Notifications', 'notifications', bodyN, _TN));
});

app.get('/api/tasks/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const task = await TaskService.getById(id);
    if (!task) return c.json({ error: 'not found' }, 404);
    const runs = await TaskRunService.listByTaskId(id);
    return c.json({ ...task, _runs: runs });
});

app.get('/api/runs/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const run = await TaskRunService.getById(id);
    if (!run) return c.json({ error: 'not found' }, 404);
    return c.json(run);
});

app.get('/api/templates/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const tmpl = await TaskTemplateService.getById(id);
    if (!tmpl) return c.json({ error: 'not found' }, 404);
    return c.json(tmpl);
});

app.post('/api/tasks/:id/retry', async (c) => {
    await TaskService.retry(Number(c.req.param('id')));
    return c.json({ success: true });
});

app.delete('/api/tasks/:id', async (c) => {
    await TaskService.delete(Number(c.req.param('id')));
    return c.json({ success: true });
});

app.post('/api/templates/:id/enable', async (c) => {
    const result = await TaskTemplateService.enable(Number(c.req.param('id')));
    return c.json({ success: !!result });
});

app.post('/api/templates/:id/disable', async (c) => {
    const result = await TaskTemplateService.disable(Number(c.req.param('id')));
    return c.json({ success: !!result });
});

app.delete('/api/templates/:id', async (c) => {
    const ok = await TaskTemplateService.delete(Number(c.req.param('id')));
    return c.json({ success: ok });
});

app.post('/api/templates/:id/trigger', async (c) => {
    const id = Number(c.req.param('id'));
    const tmpl = await TaskTemplateService.getById(id);
    if (!tmpl) return c.json({ error: 'not found' }, 404);
    const task = await TaskService.add({
        name: `[Manual Trigger] ${tmpl.name}`,
        agent: tmpl.agent,
        model: tmpl.model,
        prompt: tmpl.prompt,
        cwd: tmpl.cwd,
        category: tmpl.category,
        importance: tmpl.importance,
        urgency: tmpl.urgency,
        maxRetries: tmpl.maxRetries,
        templateId: tmpl.id,
        notifyOn: tmpl.notifyOn ?? undefined,
    });
    return c.json({ success: true, taskId: task.id });
});

app.put('/api/tasks/:id', async (c) => {
    try {
        const id = Number(c.req.param('id'));
        const body = await c.req.json();
        if (body.name !== undefined && !body.name) {
            return c.json({ success: false, error: 'name cannot be empty' }, 400);
        }
        if (body.agent !== undefined && !body.agent) {
            return c.json({ success: false, error: 'agent cannot be empty' }, 400);
        }
        if (body.prompt !== undefined && !body.prompt) {
            return c.json({ success: false, error: 'prompt cannot be empty' }, 400);
        }
        if (body.cwd) {
            const v = validatePath(String(body.cwd));
            if (!v.valid) {
                return c.json({ success: false, error: 'Invalid working directory: ' + v.error }, 400);
            }
        }
        const result = await TaskService.update(id, {
            name: body.name ? String(body.name) : undefined,
            agent: body.agent ? String(body.agent) : undefined,
            model: body.model ? String(body.model) : undefined,
            prompt: body.prompt ? String(body.prompt) : undefined,
            cwd: body.cwd ? String(body.cwd) : undefined,
            category: body.category ? String(body.category) : undefined,
            importance: body.importance !== undefined ? Number(body.importance) : undefined,
            urgency: body.urgency !== undefined ? Number(body.urgency) : undefined,
            maxRetries: body.maxRetries !== undefined ? Number(body.maxRetries) : undefined,
            notifyOn: body.notifyOn ? JSON.stringify(body.notifyOn) : undefined,
        });
        if (!result) return c.json({ success: false, error: 'not found' }, 404);
        return c.json({ success: true });
    } catch (err) {
        return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

app.put('/api/templates/:id', async (c) => {
    try {
        const id = Number(c.req.param('id'));
        const body = await c.req.json();
        if (body.name !== undefined && !body.name) {
            return c.json({ success: false, error: 'name cannot be empty' }, 400);
        }
        if (body.agent !== undefined && !body.agent) {
            return c.json({ success: false, error: 'agent cannot be empty' }, 400);
        }
        if (body.prompt !== undefined && !body.prompt) {
            return c.json({ success: false, error: 'prompt cannot be empty' }, 400);
        }
        if (body.cwd) {
            const v = validatePath(String(body.cwd));
            if (!v.valid) {
                return c.json({ success: false, error: 'Invalid working directory: ' + v.error }, 400);
            }
        }
        const result = await TaskTemplateService.update(id, {
            name: body.name ? String(body.name) : undefined,
            agent: body.agent ? String(body.agent) : undefined,
            model: body.model ? String(body.model) : undefined,
            prompt: body.prompt ? String(body.prompt) : undefined,
            cwd: body.cwd ? String(body.cwd) : undefined,
            category: body.category ? String(body.category) : undefined,
            importance: body.importance !== undefined ? Number(body.importance) : undefined,
            urgency: body.urgency !== undefined ? Number(body.urgency) : undefined,
            maxRetries: body.maxRetries !== undefined ? Number(body.maxRetries) : undefined,
            scheduleType: body.scheduleType ? String(body.scheduleType) as 'cron' | 'recurring' | 'delayed' : undefined,
            cronExpr: body.cronExpr ? String(body.cronExpr) : undefined,
            intervalMs: body.intervalMs !== undefined ? Number(body.intervalMs) : undefined,
            runAt: body.runAt !== undefined ? Number(body.runAt) : undefined,
            notifyOn: body.notifyOn ? JSON.stringify(body.notifyOn) : undefined,
        });
        if (!result) return c.json({ success: false, error: 'not found' }, 404);
        return c.json({ success: true });
    } catch (err) {
        return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

app.put('/api/config', async (c) => {
    try {
        const body = (await c.req.json()) as Record<string, unknown>;
        const current = readCurrentConfig();
        const curW = (current.worker ?? {}) as Record<string, unknown>;
        const curS = (current.scheduler ?? {}) as Record<string, unknown>;
        const curD = (current.watchdog ?? {}) as Record<string, unknown>;
        const curN = (current.notifications ?? {}) as Record<string, unknown>;
        const bW = (body.worker ?? {}) as Record<string, unknown>;
        const bS = (body.scheduler ?? {}) as Record<string, unknown>;
        const bD = (body.watchdog ?? {}) as Record<string, unknown>;
        const bN = (body.notifications ?? {}) as Record<string, unknown>;
        const curDash = (current.dashboard ?? {}) as Record<string, unknown>;
        const bDash = (body.dashboard ?? {}) as Record<string, unknown>;
        const merged = { ...current, ...body, worker: { ...curW, ...bW }, scheduler: { ...curS, ...bS }, watchdog: { ...curD, ...bD }, notifications: { ...curN, ...bN }, dashboard: { ...curDash, ...bDash } };
        writeConfig(merged);
        return c.json({ success: true });
    } catch (err) {
        return c.json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
});

app.post('/api/database/clear', async (c) => {
    try {
        const { tasks, taskRuns, taskTemplates } = schema;
        await db.delete(taskRuns);
        await db.delete(taskTemplates);
        await db.delete(tasks);
        return c.json({ success: true });
    } catch (err) {
        return c.json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
});

app.get('/api/agents', (c) => {
    const cwd = c.req.query('cwd') || undefined;
    const agents = getAgents(cwd);
    return c.json(agents);
});

app.get('/api/models', (c) => {
    const cwd = c.req.query('cwd') || undefined;
    const models = getModels(cwd);
    return c.json(models);
});

app.get('/api/fs/browse', (c) => {
    const path = c.req.query('path') || undefined;
    let entries;
    if (!path) {
        entries = listRootEntries();
    } else {
        entries = listDirectories(path);
    }
    return c.json({ entries });
});

app.get('/api/fs/validate', (c) => {
    const path = c.req.query('path') || '';
    const result = validatePath(path);
    return c.json(result);
});

app.get('/api/notifications/active-channels', (c) => {
    const config = loadConfig();
    const active = getActiveChannels(config.notifications);
    return c.json({ channels: active });
});

app.get('/api/notifications/health', async (c) => {
    const config = loadConfig();
    const results = await healthCheckAll(config.notifications);
    return c.json(results);
});

app.post('/api/notifications/test', async (c) => {
    try {
        const body = await c.req.json();
        const channel = body.channel as ChannelName;
        if (!channel) {
            return c.json({ success: false, error: 'channel is required' }, 400);
        }
        const config = loadConfig();
        if (body.config) {
            config.notifications.channels[channel] = body.config as any;
        }
        const result = await sendTestNotification(channel, config.notifications);
        return c.json({ success: result.ok, error: result.error, channel });
    } catch (err) {
        return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

app.post('/api/tasks', async (c) => {
    try {
        const body = await c.req.json();
        if (!body.name || !body.agent || !body.prompt) {
            return c.json({ success: false, error: 'name, agent, and prompt are required' }, 400);
        }
        if (body.cwd) {
            const v = validatePath(String(body.cwd));
            if (!v.valid) {
                return c.json({ success: false, error: 'Invalid working directory: ' + v.error }, 400);
            }
        }
        const task = await TaskService.add({
            name: String(body.name),
            agent: String(body.agent),
            model: String(body.model || 'default'),
            prompt: String(body.prompt),
            cwd: body.cwd ? String(body.cwd) : undefined,
            category: String(body.category || 'general'),
            importance: Number(body.importance ?? 3),
            urgency: Number(body.urgency ?? 3),
            maxRetries: Number(body.maxRetries ?? 3),
            notifyOn: body.notifyOn ? JSON.stringify(body.notifyOn) : undefined,
        });
        return c.json({ success: true, taskId: task.id });
    } catch (err) {
        return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

app.post('/api/templates', async (c) => {
    try {
        const body = await c.req.json();
        if (!body.name || !body.agent || !body.prompt || !body.scheduleType) {
            return c.json({ success: false, error: 'name, agent, prompt, and scheduleType are required' }, 400);
        }
        if (body.cwd) {
            const v = validatePath(String(body.cwd));
            if (!v.valid) {
                return c.json({ success: false, error: 'Invalid working directory: ' + v.error }, 400);
            }
        }
        const template = await TaskTemplateService.create({
            name: String(body.name),
            agent: String(body.agent),
            model: String(body.model || 'default'),
            prompt: String(body.prompt),
            cwd: body.cwd ? String(body.cwd) : undefined,
            category: String(body.category || 'general'),
            importance: Number(body.importance ?? 3),
            urgency: Number(body.urgency ?? 3),
            maxRetries: Number(body.maxRetries ?? 3),
            scheduleType: String(body.scheduleType) as 'cron' | 'recurring' | 'delayed',
            cronExpr: body.cronExpr ? String(body.cronExpr) : undefined,
            intervalMs: body.intervalMs ? Number(body.intervalMs) : undefined,
            runAt: body.runAt ? Number(body.runAt) : undefined,
            notifyOn: body.notifyOn ? JSON.stringify(body.notifyOn) : undefined,
        });
        return c.json({ success: true, templateId: template.id });
    } catch (err) {
        return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

app.get('/new', (c) => {
    const _cfgNew = loadConfig();
    const localeNew = _cfgNew.dashboard?.locale || 'en';
    const T = getTranslations(localeNew);
    const agents = getAgents();
    const models = getModels();

    const agentOptions = agents.map(a =>
        `<option value="${esc(a.name)}">${esc(a.name)}${a.description ? ' — ' + esc(a.description) : ''}</option>`
    ).join('');

    const modelSuggestions = models.map(m =>
        `<option value="${esc(m.id)}">${esc(m.label)}</option>`
    ).join('');

    const body = `
      <div class="card" style="max-width:780px;margin:0 auto">
        <h2 style="margin:0 0 4px;font-size:18px">Create New Task</h2>
        <p class="mu sm" style="margin:0 0 20px">Fill in the details below. Fields marked with <span class="hl">*</span> are required.</p>
        <form id="task-form" onsubmit="event.preventDefault();createTask();">
          <div class="field">
            <label>Task Name<span class="hl">*</span> <span class="tip" onmouseenter="showTip(this,'A descriptive name to identify this task in the queue. Keep it short and meaningful.')" onmouseleave="hideTip()">i</span></label>
            <input type="text" name="nm" placeholder="e.g. Generate weekly report" required>
          </div>
          <div class="field">
            <label>Agent<span class="hl">*</span> <span class="tip" onmouseenter="showTip(this,'The AI persona that will execute the task. The list includes built-in agents plus custom agents from global and project configs.')" onmouseleave="hideTip()">i</span></label>
            <select name="ag" id="ag" required data-placeholder="— Select an agent —">
              <option value="">— Select an agent —</option>
              ${agentOptions}
            </select>
          </div>
          <div class="field">
            <label>Model <span class="tip" onmouseenter="showTip(this,'Override the AI model for this task. Format: providerID/modelID. Leave as default to use the agent\\'s configured model.')" onmouseleave="hideTip()">i</span></label>
            <input type="text" name="mo" id="mo" list="model-suggestions" placeholder="default" value="default">
            <datalist id="model-suggestions">
              ${modelSuggestions}
            </datalist>
          </div>
          <div class="field">
            <label>Prompt<span class="hl">*</span> <span class="tip" onmouseenter="showTip(this,'The instruction for the AI to execute, just like a message in OpenCode chat. Use natural language and multiple lines.')" onmouseleave="hideTip()">i</span></label>
            <textarea name="pr" placeholder="Describe what you want the AI to do..." required></textarea>
          </div>
          <div class="field">
            <label>Working Directory <span class="tip" onmouseenter="showTip(this,'The project directory where the task will run. Agents and models available in this project will be added to the picklists above. Leave empty to use only global agents.')" onmouseleave="hideTip()">i</span></label>
            <div class="cwd-row">
              <input type="text" name="cw" id="cw" class="cwd-input" placeholder="e.g. C:\\Users\\...\\my-project" autocomplete="off">
              <span id="cwd-status" class="cwd-status"></span>
              <button type="button" id="btn-browse" class="btn" style="white-space:nowrap">Browse</button>
            </div>
            <div id="cwd-error" class="field-error"></div>
          </div>

          <div class="card" style="margin-bottom:20px;padding:14px 16px">
            <div class="field" style="margin-bottom:8px">
              <label>
                <input type="radio" name="sch_mode" value="once" checked onchange="toggleScheduling()" style="width:auto;margin-right:6px">
                Run once now
                <span class="tip" onmouseenter="showTip(this,'Creates a single task that runs immediately when picked up by the worker.')" onmouseleave="hideTip()">i</span>
              </label>
            </div>
            <div class="field" style="margin-bottom:0">
              <label>
                <input type="radio" name="sch_mode" value="schedule" onchange="toggleScheduling()" style="width:auto;margin-right:6px">
                Schedule for later
                <span class="tip" onmouseenter="showTip(this,'Creates a recurring schedule. The task will run automatically according to the timing rules you define below.')" onmouseleave="hideTip()">i</span>
              </label>
            </div>
            <div id="schedule-section" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
              <div class="field">
                <label>Type <span class="tip" onmouseenter="showTip(this,'Cron: standard cron syntax. Recurring: fixed interval between runs. Delayed: run once after a delay.')" onmouseleave="hideTip()">i</span></label>
                <select name="sch_type" onchange="updateScheduleFields()">
                  <option value="cron">Cron</option>
                  <option value="recurring">Recurring</option>
                  <option value="delayed">Delayed</option>
                </select>
              </div>
              <div id="sch-cron" class="field">
                <label>Cron Expression <span class="tip" onmouseenter="showTip(this,'Format: minute hour day month weekday. Examples: */5 * * * * (every 5 min), 0 9 * * 1-5 (weekdays at 9 AM), 0 0 1 * * (1st of month at midnight).')" onmouseleave="hideTip()">i</span></label>
                <input type="text" name="cron_expr" placeholder="e.g. 0 9 * * 1-5" style="font-family:monospace">
              </div>
              <div id="sch-recurring" class="field" style="display:none">
                <label>Repeat every <span class="tip" onmouseenter="showTip(this,'The task will repeat at this fixed interval. The next run is scheduled after the current one finishes.')" onmouseleave="hideTip()">i</span></label>
                <div class="field-inline">
                  <input type="number" name="int_val" value="6" min="1" style="width:80px;flex:none">
                  <select name="int_unit">
                    <option value="minutes">minutes</option>
                    <option value="hours" selected>hours</option>
                    <option value="days">days</option>
                  </select>
                </div>
              </div>
              <div id="sch-delayed" class="field" style="display:none">
                <label>Run in <span class="tip" onmouseenter="showTip(this,'The task will execute once, after this delay from now.')" onmouseleave="hideTip()">i</span></label>
                <div class="field-inline">
                  <input type="number" name="del_val" value="30" min="1" style="width:80px;flex:none">
                  <select name="del_unit">
                    <option value="minutes" selected>minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div class="card" style="margin-bottom:20px;padding:14px 16px" id="notify-section">
            <h4 style="margin:0 0 10px;font-size:13px">Notifications</h4>
            <div class="field" style="margin-bottom:8px">
              <label>
                <input type="radio" name="notify_mode" value="global" checked onchange="toggleNotifyMode()" style="width:auto;margin-right:6px">
                Use global defaults
              </label>
            </div>
            <div class="field" style="margin-bottom:0">
              <label>
                <input type="radio" name="notify_mode" value="custom" onchange="toggleNotifyMode()" style="width:auto;margin-right:6px">
                Custom for this task
              </label>
            </div>
            <div id="notify-custom-section" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
              <div id="notify-custom-table"></div>
            </div>
          </div>

          <div class="field-grid">
            <div class="field">
              <label>Category <span class="tip" onmouseenter="showTip(this,'A label to organize tasks. Purely for filtering and grouping — does not affect execution.')" onmouseleave="hideTip()">i</span></label>
              <select name="ca">
                <option value="general">general</option>
                <option value="translate">translate</option>
                <option value="generate">generate</option>
                <option value="review">review</option>
                <option value="test">test</option>
              </select>
            </div>
            <div class="field">
              <label>Max Retries <span class="tip" onmouseenter="showTip(this,'How many times the task will retry automatically if it fails. After this limit, the task goes to Dead Letter.')" onmouseleave="hideTip()">i</span></label>
              <select name="mr">
                <option value="0">0 (no retries)</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3" selected>3</option>
                <option value="5">5</option>
                <option value="10">10</option>
              </select>
            </div>
          </div>
          <div class="field-grid">
            <div class="field">
              <label>Importance <span class="tip" onmouseenter="showTip(this,'How critical the result is. Tasks with higher importance are processed before lower ones when the queue is busy. Scale: 1 (low) to 5 (critical).')" onmouseleave="hideTip()">i</span></label>
              <div class="field-inline">
                <div class="stars" id="stars-im"><input type="hidden" name="im" value="3"><span class="star on">\u2605</span><span class="star on">\u2605</span><span class="star on">\u2605</span><span class="star">\u2605</span><span class="star">\u2605</span></div>
                <span class="mu sm" id="stars-im-label">Medium</span>
              </div>
            </div>
            <div class="field">
              <label>Urgency <span class="tip" onmouseenter="showTip(this,'How soon the task needs to run. Higher urgency tasks jump ahead in the queue. Scale: 1 (not urgent) to 5 (immediate).')" onmouseleave="hideTip()">i</span></label>
              <div class="field-inline">
                <div class="stars" id="stars-ur"><input type="hidden" name="ur" value="3"><span class="star on">\u2605</span><span class="star on">\u2605</span><span class="star on">\u2605</span><span class="star">\u2605</span><span class="star">\u2605</span></div>
                <span class="mu sm" id="stars-ur-label">Medium</span>
              </div>
            </div>
          </div>
          <div style="margin-top:20px;display:flex;gap:10px">
            <button type="submit" id="submit-btn" class="rf" style="font-size:14px;padding:10px 24px">Create Task</button>
            <a href="/" class="btn" style="padding:10px 24px;text-decoration:none;display:inline-flex;align-items:center">Cancel</a>
          </div>
        </form>
      </div>

      <div id="browse-modal" class="modal-overlay" style="display:none">
        <div class="modal-content">
          <div class="modal-header">
            <span id="modal-breadcrumb" class="mu sm"></span>
            <button id="modal-close" class="cb" type="button">&times;</button>
          </div>
          <div class="modal-body" id="modal-body">
            <div class="ta-center mu p30">Loading...</div>
          </div>
          <div class="modal-footer">
            <button id="modal-cancel" class="btn" type="button">Cancel</button>
            <button id="modal-select" class="rf" type="button" disabled>Select this folder</button>
          </div>
        </div>
      </div>

      <script>
        initStars('stars-im');
        initStars('stars-ur');
        loadActiveChannels();

        var cwdTimeout;

        function refreshAgentOptions(cwd) {
          return fetch('/api/agents' + (cwd ? '?cwd=' + encodeURIComponent(cwd) : ''))
            .then(function(r){return r.json()})
            .then(function(agents){
              var sel = document.getElementById('ag');
              var current = sel.value;
              sel.innerHTML = '<option value="">\u2014 Select an agent \u2014</option>';
              agents.forEach(function(a){
                var opt = document.createElement('option');
                opt.value = a.name;
                opt.textContent = a.name + (a.description ? ' \u2014 ' + a.description : '');
                sel.appendChild(opt);
              });
              if (current) sel.value = current;
            });
        }

        function refreshModelSuggestions(cwd) {
          return fetch('/api/models' + (cwd ? '?cwd=' + encodeURIComponent(cwd) : ''))
            .then(function(r){return r.json()})
            .then(function(models){
              var dl = document.getElementById('model-suggestions');
              dl.innerHTML = '';
              models.forEach(function(m){
                var opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.label;
                dl.appendChild(opt);
              });
            });
        }

        function refreshOptions(cwd) {
          return Promise.all([
            refreshAgentOptions(cwd),
            refreshModelSuggestions(cwd),
          ]);
        }

        function validateAndRefresh(path) {
          var status = document.getElementById('cwd-status');
          var error = document.getElementById('cwd-error');
          status.textContent = '\u23F3';
          error.textContent = '';

          if (!path) {
            status.textContent = '';
            error.textContent = '';
            refreshOptions('');
            return;
          }

          fetch('/api/fs/validate?path=' + encodeURIComponent(path))
            .then(function(r){return r.json()})
            .then(function(result){
              if (!result.valid) {
                status.textContent = '\u274C';
                status.style.color = '#f85149';
                error.textContent = result.error;
                refreshOptions('');
              } else {
                status.textContent = '\u2705';
                status.style.color = '#3fb950';
                error.textContent = '';
                refreshOptions(path);
              }
            })
            .catch(function(){
              status.textContent = '\u274C';
              status.style.color = '#f85149';
              error.textContent = 'Validation request failed';
            });
        }

        document.getElementById('cw').addEventListener('input', function(e){
          clearTimeout(cwdTimeout);
          var path = e.target.value;
          cwdTimeout = setTimeout(function(){ validateAndRefresh(path); }, 500);
        });

        document.getElementById('cw').addEventListener('blur', function(e){
          validateAndRefresh(e.target.value);
        });

        var modalPath = '';
        var modalStack = [];

        function openBrowseModal(parentPath) {
          modalPath = parentPath || '';
          modalStack = modalPath ? [modalPath] : [];
          document.getElementById('browse-modal').style.display = 'flex';
          loadBrowseDir(modalPath);
        }

        function loadBrowseDir(dirPath) {
          var body = document.getElementById('modal-body');
          body.innerHTML = '<div class="ta-center mu p30">Loading...</div>';
          document.getElementById('modal-select').disabled = true;

          var url = '/api/fs/browse';
          if (dirPath) url += '?path=' + encodeURIComponent(dirPath);
          fetch(url)
            .then(function(r){return r.json()})
            .then(function(data){
              updateBreadcrumb(dirPath);
              if (!data.entries || data.entries.length === 0) {
                body.innerHTML = '<div class="ta-center mu p30">(empty directory)</div>';
                return;
              }
              var html = '';
              if (dirPath) {
                html += '<div class="dir-item dir-up" data-path="' + (modalStack.length > 1 ? modalStack[modalStack.length - 2] : '') + '">\u2190 ..</div>';
              }
              data.entries.forEach(function(e){
                html += '<div class="dir-item" data-path="' + e.path + '">\uD83D\uDCC1 ' + esc(e.name) + '</div>';
              });
              body.innerHTML = html;

              body.querySelectorAll('.dir-item').forEach(function(el){
                el.addEventListener('click', function(){
                  var p = el.getAttribute('data-path');
                  if (el.classList.contains('dir-up')) {
                    modalStack.pop();
                    loadBrowseDir(p);
                  } else {
                    modalStack.push(p);
                    loadBrowseDir(p);
                  }
                });
                el.addEventListener('dblclick', function(e){
                  e.stopPropagation();
                  var p = el.getAttribute('data-path');
                  if (el.classList.contains('dir-up')) return;
                  selectBrowsePath(p);
                });
              });
              if (dirPath) {
                document.getElementById('modal-select').disabled = false;
              }
            })
            .catch(function(){
              body.innerHTML = '<div class="ta-center mu" style="color:var(--red)">Failed to load directory</div>';
            });
        }

        function updateBreadcrumb(dirPath) {
          var bc = document.getElementById('modal-breadcrumb');
          if (!dirPath) {
            bc.textContent = 'Home';
          } else if (dirPath.match(/^[A-Z]:\\$/i)) {
            bc.textContent = dirPath;
          } else {
            bc.textContent = dirPath;
          }
        }

        function selectBrowsePath(path) {
          document.getElementById('cw').value = path;
          document.getElementById('browse-modal').style.display = 'none';
          validateAndRefresh(path);
        }

        document.getElementById('btn-browse').addEventListener('click', function(){
          var current = document.getElementById('cw').value;
          openBrowseModal(current || '');
        });

        document.getElementById('modal-close').addEventListener('click', function(){
          document.getElementById('browse-modal').style.display = 'none';
        });

        document.getElementById('modal-cancel').addEventListener('click', function(){
          document.getElementById('browse-modal').style.display = 'none';
        });

        document.getElementById('modal-select').addEventListener('click', function(){
          if (modalStack.length > 0) {
            selectBrowsePath(modalStack[modalStack.length - 1]);
          }
        });

        document.getElementById('browse-modal').addEventListener('click', function(e){
          if (e.target === this) {
            this.style.display = 'none';
          }
        });

        function esc(s) {
          if (!s) return '';
          return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
      </script>`;
    return c.html(renderLayout(_tr(T, 'newTask.pageTitle'), 'tasks', body, T));
});

app.get('/runs/:id/session', async (c) => {
    const id = Number(c.req.param('id'));
    const _cfgS = loadConfig();
    const localeS = _cfgS.dashboard?.locale || 'en';
    const T = getTranslations(localeS);
    const { taskRuns: tr, tasks: tk } = schema;
    const rows = await db.select({
        id: tr.id, taskId: tr.taskId, sessionId: tr.sessionId, model: tr.model,
        status: tr.status, startedAt: tr.startedAt, finishedAt: tr.finishedAt,
        messagesJson: tr.messagesJson, toolsUsed: tr.toolsUsed, skillsUsed: tr.skillsUsed,
        inputTokens: tr.inputTokens, outputTokens: tr.outputTokens,
        totalTokens: tr.totalTokens, costUsd: tr.costUsd,
        taskName: tk.name, taskAgent: tk.agent,
    }).from(tr).innerJoin(tk, eq(tr.taskId, tk.id)).where(eq(tr.id, id));
    const run = rows[0];
    if (!run) return c.html(renderLayout(_tr(T, 'session.pageTitle', id), 'runs', `<div class="ta-center mu p30">${esc(_tr(T, 'session.notFound'))}</div>`, T));

    let messages: any[] = [];
    if (run.messagesJson) {
        try { messages = JSON.parse(run.messagesJson); } catch { messages = []; }
    }

    let html = '';
    html += `<div style="margin-bottom:16px"><a href="/runs" class="btn">&larr; Back to Execution Logs</a></div>`;
    html += `<div class="card" style="max-width:900px;margin:0 auto">`;
    html += `<div class="ph"><h3>Conversation — Task #${run.taskId}: ${esc(run.taskName)}</h3></div>`;
    const toolsList = run.toolsUsed
        ? (JSON.parse(run.toolsUsed) as string[]).map(t => `<span class="tag">${esc(t)}</span>`).join(' ')
        : '<span class="mu">-</span>';
    const skillsList = run.skillsUsed
        ? (JSON.parse(run.skillsUsed) as string[]).map(s => `<span class="tag" style="border-color:var(--purple);color:var(--purple)">${esc(s)}</span>`).join(' ')
        : '';

    const tokensInfo = run.inputTokens !== null && run.outputTokens !== null
        ? `<span>Tokens: ${formatTokens(run.inputTokens)} in / ${formatTokens(run.outputTokens)} out</span>`
        : '';
    const costInfo = run.costUsd !== null && run.costUsd > 0
        ? `<span>Cost: ${formatCost(run.costUsd)}</span>`
        : '';

    html += `<div style="padding:12px 16px;display:flex;gap:16px;font-size:12px;color:var(--t2);border-bottom:1px solid var(--border);flex-wrap:wrap">
      <span>Run #${run.id}</span>
      <span>Agent: <span class="tag">${esc(run.taskAgent)}</span></span>
      ${run.model ? `<span>Model: <span class="tag">${esc(run.model)}</span></span>` : ''}
      <span>Tools: ${toolsList}</span>
      ${skillsList ? `<span>Skills: ${skillsList}</span>` : ''}
      ${tokensInfo}
      ${costInfo}
      <span style="margin-left:auto"><span class="badge b-${run.status}">${(run.status ?? '').toUpperCase()}</span></span>
      <span>${formatDuration(run.startedAt, run.finishedAt)}</span>
    </div>`;
    html += `<div style="padding:16px;max-height:70vh;overflow-y:auto">`;

    if (messages.length === 0) {
        html += `<div class="ta-center mu p30">No messages captured for this run.</div>`;
    } else {
        for (const msg of messages) {
            const role = msg.info?.role || '';
            const isAssistant = role === 'assistant';
            const isUser = role === 'user';
            const hasError = msg.info?.error;

            if (isUser) {
                html += `<div class="msg msg-user"><div class="msg-hd">You</div><div class="msg-bd">`;
                for (const part of (msg.parts || [])) {
                    if (part.type === 'text') html += `<div>${esc(part.text)}</div>`;
                }
                html += `</div></div>`;
                continue;
            }

            if (isAssistant) {
                let textParts: any[] = [];
                let toolParts: any[] = [];
                for (const part of (msg.parts || [])) {
                    if (part.type === 'text') textParts.push(part);
                    else toolParts.push(part);
                }

                if (textParts.length > 0) {
                    html += `<div class="msg msg-assistant"><div class="msg-hd">Assistant</div><div class="msg-bd">`;
                    for (const p of textParts) html += esc(p.text);
                    html += `</div></div>`;
                }

                if (hasError) {
                    const err = hasError as Record<string, unknown>;
                    const errData = err.data as Record<string, unknown> | undefined;
                    html += `<div class="msg msg-error"><div class="msg-hd">Error</div><div class="msg-bd">${esc(String(errData?.message ?? JSON.stringify(err)))}</div></div>`;
                }

                for (const p of toolParts) {
                    if (p.type === 'tool_call') {
                        html += `<div class="msg msg-toolcall"><div class="msg-hd">Tool Call: ${esc(p.tool || 'unknown')}</div><div class="msg-bd">`;
                        if (p.args) {
                            for (const [k, v] of Object.entries(p.args)) {
                                const val = typeof v === 'string' && v.length > 200 ? v.substring(0, 200) + '...' : esc(String(v));
                                html += `<div><span class="mu">${esc(k)}:</span> ${val}</div>`;
                            }
                        }
                        html += `</div></div>`;
                    } else if (p.type === 'tool_result') {
                        html += `<div class="msg msg-toolresult"><div class="msg-hd">Tool Result</div><div class="msg-bd">`;
                        const output = typeof p.output === 'string' ? p.output : JSON.stringify(p.output);
                        html += esc(output.substring(0, 4000));
                        if (output.length > 4000) html += `\n\n[truncated]`;
                        html += `</div></div>`;
                    }
                }
            }
        }
    }

    html += `</div></div>`;

    return c.html(renderLayout(_tr(T, 'session.pageTitle', run.taskId), 'runs', html, T));
});

export const dashboardApp = app;

export default {
    port: 4680,
    fetch: app.fetch,
};
