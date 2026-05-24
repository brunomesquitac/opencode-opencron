/** @jsx Hono.jsx */
import { Hono } from 'hono';
import { html } from 'hono/html';
import { TaskService } from '@core/services/task.service';
import { TaskRunService } from '@core/services/task-run.service';
import { TaskTemplateService } from '@core/services/task-template.service';
import { desc, sql, eq } from 'drizzle-orm';
import { db, schema } from '@core/db';
import { loadConfig, CONFIG_PATH, type GatewayConfig } from '@gateway/config';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

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

function formatDate(ts: Date | number | null): string {
    if (!ts) return '-';
    const d = ts instanceof Date ? ts : new Date(ts);
    return d.toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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
  .rf { background:var(--green); color:white; border:none; padding:6px 16px; border-radius:6px; font-weight:600; cursor:pointer; text-decoration:none; }
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
</style>
`;

function renderLayout(title: string, activeTab: string, body: string): string {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title} - OpenCron</title>${SHARED_STYLES}
<script>
async function retryTask(id){if(!confirm('Retry task #'+id+'?'))return;await fetch('/api/tasks/'+id+'/retry',{method:'POST'});location.reload();}
async function deleteTask(id){if(!confirm('Delete task #'+id+'?'))return;await fetch('/api/tasks/'+id,{method:'DELETE'});location.reload();}
async function showDetail(id){try{const r=await fetch('/api/tasks/'+id);const t=await r.json();document.getElementById('dc').textContent=JSON.stringify(t,null,2);document.getElementById('dd').showModal();}catch(e){alert('Failed to load details');}}
async function showRunDetail(id){try{const r=await fetch('/api/runs/'+id);const t=await r.json();document.getElementById('dc').textContent=JSON.stringify(t,null,2);document.getElementById('dd').showModal();}catch(e){alert('Failed to load details');}}
async function showTemplateDetail(id){try{const r=await fetch('/api/templates/'+id);const t=await r.json();document.getElementById('dc').textContent=JSON.stringify(t,null,2);document.getElementById('dd').showModal();}catch(e){alert('Failed to load details');}}
async function enableTmpl(id){await fetch('/api/templates/'+id+'/enable',{method:'POST'});location.reload();}
async function disableTmpl(id){if(!confirm('Disable this template?'))return;await fetch('/api/templates/'+id+'/disable',{method:'POST'});location.reload();}
async function deleteTmpl(id){if(!confirm('Delete this template? This cannot be undone!'))return;await fetch('/api/templates/'+id,{method:'DELETE'});location.reload();}
async function triggerTmpl(id){if(!confirm('Trigger now?'))return;const r=await fetch('/api/templates/'+id+'/trigger',{method:'POST'});const d=await r.json();if(d.success){alert('Task #'+d.taskId+' created');location.reload();}else{alert('Trigger failed');}}
function toggleLog(id){const el=document.getElementById('log-'+id);el.style.display=el.style.display==='none'?'block':'none';}

async function clearDatabase(){
  if(!confirm('Clear all task data? This cannot be undone!'))return;
  if(!confirm('Final confirmation: ALL tasks, runs and templates will be deleted.'))return;
  try{
    const r=await fetch('/api/database/clear',{method:'POST'});
    const d=await r.json();
    if(d.success){alert('Database cleared');location.reload();}
    else{alert('Clear failed: '+d.error);}
  }catch(e){alert('Clear failed: '+e.message);}
}

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
    }
  };
  try{
    const r=await fetch('/api/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const d=await r.json();
    if(d.success){document.getElementById('toast').textContent='Config saved. Restart Gateway to apply.';document.getElementById('toast').style.display='block';setTimeout(()=>document.getElementById('toast').style.display='none',3000);}
    else{alert('Save failed: '+d.error);}
  }catch(e){alert('Save failed: '+e.message);}
}
</script>
</head>
<body>
<div id="toast" class="toast toast-ok"></div>
<div class="c">
  <header>
    <div><h1>OpenCron Dashboard</h1><span class="mu sm">Task scheduler management</span></div>
    <div><a href="${activeTab === 'tasks' ? '/' : '/' + activeTab}" class="rf">Refresh</a></div>
  </header>
  <nav class="tabs">
    <a href="/" class="${activeTab === 'tasks' ? 'active' : ''}">Task Queue</a>
    <a href="/templates" class="${activeTab === 'templates' ? 'active' : ''}">Scheduled Tasks</a>
    <a href="/runs" class="${activeTab === 'runs' ? 'active' : ''}">Execution Logs</a>
    <a href="/system" class="${activeTab === 'system' ? 'active' : ''}">System Status</a>
  </nav>
  ${body}
</div>
<dialog id="dd"><div class="dh"><h3 style="margin:0">Details</h3><button class="cb" onclick="document.getElementById('dd').close()">&times;</button></div><div class="db"><pre id="dc"></pre></div></dialog>
</body></html>`;
}

app.get('/', async (c) => {
    const page = Number(c.req.query('page') || '1');
    const statusFilter = c.req.query('status') || '';
    const limit = 50;
    const offset = (page - 1) * limit;

    const [tasks, statsData] = await Promise.all([
        TaskService.list({ limit, offset, ...(statusFilter ? { status: statusFilter as any } : {}) }),
        TaskService.stats({}),
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

    let filterBtns = `<div style="margin-bottom:12px;display:flex;gap:6px;">
      <a href="/" class="btn ${!statusFilter ? 'btn-primary' : ''}">All</a>
      <a href="/?status=pending" class="btn ${statusFilter === 'pending' ? 'btn-primary' : ''}">Pending</a>
      <a href="/?status=running" class="btn ${statusFilter === 'running' ? 'btn-primary' : ''}">Running</a>
      <a href="/?status=done" class="btn ${statusFilter === 'done' ? 'btn-primary' : ''}">Done</a>
      <a href="/?status=failed" class="btn ${statusFilter === 'failed' ? 'btn-primary' : ''}">Failed</a>
      <a href="/?status=dead_letter" class="btn ${statusFilter === 'dead_letter' ? 'btn-primary' : ''}">Dead Letter</a>
    </div>`;

    let rows = '';
    for (const task of tasks) {
        const st = (task.status ?? '').toUpperCase();
        rows += `<tr>
          <td class="mu">#${task.id}</td>
          <td><div style="font-weight:500">${esc(task.name)}</div><div class="mu sm el">${esc(task.prompt.substring(0, 120))}</div></td>
          <td><span class="tag">${esc(task.agent)}</span></td>
          <td><span class="badge b-${task.status}">${st}</span></td>
          <td class="sm ${task.status === 'running' ? '' : 'mu'}">${formatDuration(task.startedAt, task.finishedAt)}</td>
          <td class="mu sm">${(task.retryCount ?? 0) > 0 ? task.retryCount : '-'}</td>
          <td>
            <button class="btn btn-sm" onclick="showDetail(${task.id})">Details</button>
            ${(task.status === 'failed' || task.status === 'dead_letter') ? `<button class="btn btn-sm btn-warn" onclick="retryTask(${task.id})">Retry</button>` : ''}
            <button class="btn btn-sm btn-danger" onclick="deleteTask(${task.id})">Delete</button>
          </td></tr>`;
    }

    const qp = statusFilter ? `&status=${statusFilter}` : '';
    let paging = `<div class="pn">`;
    if (page > 1) paging += `<a href="/?page=${page - 1}${qp}" class="btn">Prev</a>`;
    paging += `<span class="mu sm">Page ${page} / ${totalPages} (${counts.total} total)</span>`;
    if (page < totalPages) paging += `<a href="/?page=${page + 1}${qp}" class="btn">Next</a>`;
    paging += `</div>`;

    const body = `
      <div class="g4">
        <div class="card"><div class="sv" style="color:var(--t2)">${counts.pending}</div><div class="sl">Pending</div></div>
        <div class="card"><div class="sv" style="color:var(--blue)">${counts.running}</div><div class="sl">Running</div></div>
        <div class="card"><div class="sv" style="color:var(--green)">${counts.done}</div><div class="sl">Done</div></div>
        <div class="card"><div class="sv" style="color:var(--red)">${counts.failed}</div><div class="sl">Failed / Dead</div></div>
      </div>
      ${filterBtns}
      <div class="panel"><table>
        <thead><tr><th width="50">ID</th><th>Task</th><th>Agent</th><th width="90">Status</th><th width="70">Duration</th><th width="60">Retries</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${paging}`;

    return c.html(renderLayout('Task Queue', 'tasks', body));
});

app.get('/templates', async (c) => {
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
        const typeLabel = t.scheduleType === 'cron' ? 'Cron' : t.scheduleType === 'recurring' ? 'Recurring' : 'Delayed';
        const typeClass = 'tag t-' + t.scheduleType;
        let rule = '-';
        if (t.scheduleType === 'cron') rule = t.cronExpr || '-';
        else if (t.scheduleType === 'recurring') rule = t.intervalMs ? `${Math.floor(t.intervalMs / 60000)}min` : '-';
        else if (t.scheduleType === 'delayed') rule = formatDate(t.runAt);

        const statusBadge = t.enabled
            ? '<span class="badge b-done">Enabled</span>'
            : '<span class="badge b-cancelled">Disabled</span>';
        const toggleBtn = t.enabled
            ? `<button class="btn btn-sm btn-warn" onclick="disableTmpl(${t.id})">Disable</button>`
            : `<button class="btn btn-sm" onclick="enableTmpl(${t.id})">Enable</button>`;

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
            <button class="btn btn-sm" onclick="showTemplateDetail(${t.id})">Details</button>
            <button class="btn btn-sm btn-primary" onclick="triggerTmpl(${t.id})">Trigger</button>
            ${toggleBtn}
            <button class="btn btn-sm btn-danger" onclick="deleteTmpl(${t.id})">Delete</button>
          </td></tr>`;
    }

    const emptyRow = templates.length === 0
        ? `<tr><td colspan="8" class="ta-center mu p30">No scheduled templates. Create one via CLI: <code>opencron template add</code></td></tr>`
        : '';

    const body = `
      <div class="g3">
        <div class="card"><div class="sv" style="color:var(--purple)">${templates.length}</div><div class="sl">Total Templates</div></div>
        <div class="card"><div class="sv" style="color:var(--green)">${enabled}</div><div class="sl">Enabled</div></div>
        <div class="card"><div class="sv" style="color:var(--t2)">${disabled}</div><div class="sl">Disabled</div></div>
      </div>
      <div class="panel">
        <div class="ph"><h3>Schedule Templates</h3></div>
        <table>
          <thead><tr><th width="50">ID</th><th>Name</th><th>Type</th><th>Rule</th><th width="90">Status</th><th>Last Run</th><th>Next Run</th><th>Actions</th></tr></thead>
          <tbody>${rows}${emptyRow}</tbody>
        </table>
      </div>`;

    return c.html(renderLayout('Scheduled Tasks', 'templates', body));
});

app.get('/runs', async (c) => {
    const page = Number(c.req.query('page') || '1');
    const limit = 50;
    const offset = (page - 1) * limit;

    const { taskRuns: tr, tasks: tk } = schema;
    const runs = await db.select({
        id: tr.id, taskId: tr.taskId, sessionId: tr.sessionId, model: tr.model,
        status: tr.status, startedAt: tr.startedAt, finishedAt: tr.finishedAt,
        log: tr.log, heartbeatAt: tr.heartbeatAt, workerPid: tr.workerPid, childPid: tr.childPid,
        taskName: tk.name, taskAgent: tk.agent,
    }).from(tr).innerJoin(tk, eq(tr.taskId, tk.id))
      .orderBy(desc(tr.startedAt)).limit(limit).offset(offset);

    const totalResult = await db.select({ count: sql<number>`count(*)` }).from(tr);
    const total = Number(totalResult[0]?.count ?? 0);
    const totalPages = Math.ceil(total / limit);

    let rows = '';
    const logsHtml: string[] = [];
    for (const run of runs) {
        const shortSession = run.sessionId
            ? run.sessionId.slice(4, 7) + '***' + run.sessionId.slice(-3)
            : '-';
        const logBtn = run.log
            ? `<button class="btn btn-sm" onclick="toggleLog(${run.id})">Log</button>`
            : '';
        rows += `<tr>
          <td class="mu">#${run.id}</td>
          <td><div style="font-weight:500">${esc(run.taskName)} <span class="mu">(#${run.taskId})</span></div>
            ${run.model ? `<div class="sm"><span class="tag">${esc(run.model)}</span></div>` : ''}</td>
          <td><span class="tag">${esc(run.taskAgent)}</span></td>
          <td><span class="badge b-${run.status}">${(run.status ?? '').toUpperCase()}</span></td>
          <td class="sm">${formatDuration(run.startedAt, run.finishedAt)}</td>
          <td class="sm mu">${run.heartbeatAt ? timeAgo(run.heartbeatAt) : '-'}</td>
          <td><button class="btn btn-sm" onclick="showRunDetail(${run.id})">Details</button>${logBtn}</td>
        </tr>`;

        if (run.log) {
            logsHtml.push(`<div id="log-${run.id}" style="display:none" class="mt8">
              <div class="panel"><div class="ph"><h3>Run #${run.id} Log — ${run.taskName}</h3></div>
              <div class="log-box">${run.log.replace(/</g, '&lt;')}</div></div></div>`);
        }
    }

    let paging = `<div class="pn">`;
    if (page > 1) paging += `<a href="/runs?page=${page - 1}" class="btn">Prev</a>`;
    paging += `<span class="mu sm">Page ${page} / ${totalPages} (${total} records)</span>`;
    if (page < totalPages) paging += `<a href="/runs?page=${page + 1}" class="btn">Next</a>`;
    paging += `</div>`;

    const emptyRow = runs.length === 0
        ? `<tr><td colspan="7" class="ta-center mu p30">No execution records</td></tr>`
        : '';

    const body = `
      <div class="g4">
        <div class="card"><div class="sv">${total}</div><div class="sl">Total Records</div></div>
        <div class="card"><div class="sv" style="color:var(--green)">${runs.filter(r => r.status === 'done').length}</div><div class="sl">Success (this page)</div></div>
        <div class="card"><div class="sv" style="color:var(--red)">${runs.filter(r => r.status === 'failed').length}</div><div class="sl">Failed (this page)</div></div>
        <div class="card"><div class="sv" style="color:var(--blue)">${runs.filter(r => r.status === 'running').length}</div><div class="sl">Running (this page)</div></div>
      </div>
      <div class="panel"><table>
        <thead><tr><th width="50">Run</th><th>Task</th><th>Agent</th><th width="90">Status</th><th width="70">Duration</th><th>Heartbeat</th><th>Actions</th></tr></thead>
        <tbody>${rows}${emptyRow}</tbody>
      </table></div>
      ${logsHtml.join('')}
      ${paging}`;

    return c.html(renderLayout('Execution Logs', 'runs', body));
});

app.get('/system', async (c) => {
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

    const schedulerStatus = config.scheduler.enabled
        ? '<span class="badge b-done">Enabled</span>'
        : '<span class="badge b-cancelled">Disabled</span>';
    const configFileStatus = configExists
        ? '<span class="badge b-done">Yes</span>'
        : '<span class="badge b-cancelled">No (using defaults)</span>';

    const body = `
      <form id="config-form" onsubmit="event.preventDefault();saveConfig();">
      <div class="g3">
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:14px">Worker Config</h3>
          <div class="form-row"><label>Max Concurrency</label><input type="number" name="mc" value="${config.worker.maxConcurrency}" min="1" max="20" style="width:80px"></div>
          <div class="form-row"><label>Poll Interval (ms)</label><input type="number" name="pi" value="${config.worker.pollIntervalMs}" min="100" style="width:100px"></div>
          <div class="form-row"><label>Heartbeat (sec)</label><input type="number" name="hi" value="${config.worker.heartbeatIntervalMs / 1000}" min="5" style="width:100px"></div>
          <div class="form-row"><label>Task Timeout (min)</label><input type="number" name="to" value="${config.worker.taskTimeoutMs / 60000}" min="1" style="width:100px"></div>
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:14px">Scheduler Config</h3>
          <div class="form-row"><label>Enabled</label><input type="checkbox" name="se" ${config.scheduler.enabled ? 'checked' : ''}></div>
          <div class="form-row"><label>Check Interval</label><input type="number" name="si" value="${config.scheduler.checkIntervalMs}" min="100" style="width:100px"></div>
          <div class="form-row"><label>Catch Up</label><select name="cu" style="width:100px">
            <option value="next" ${config.scheduler.catchUp === 'next' ? 'selected' : ''}>next</option>
            <option value="all" ${config.scheduler.catchUp === 'all' ? 'selected' : ''}>all</option>
            <option value="latest" ${config.scheduler.catchUp === 'latest' ? 'selected' : ''}>latest</option>
          </select></div>
          <div class="ir"><span class="ik">Active Templates</span><span class="iv">${templates.filter(t => t.enabled).length} / ${templates.length}</span></div>
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:14px">Watchdog Config</h3>
          <div class="form-row"><label>Heartbeat Timeout</label><input type="number" name="wt" value="${config.watchdog.heartbeatTimeoutMs / 1000}" min="10" style="width:100px"></div>
          <div class="form-row"><label>Cleanup Interval</label><input type="number" name="wc" value="${config.watchdog.cleanupIntervalMs / 1000}" min="10" style="width:100px"></div>
          <div class="form-row"><label>Retention (days)</label><input type="number" name="rd" value="${config.watchdog.retentionDays}" min="1" style="width:100px"></div>
          <div class="ir"><span class="ik">Log Format</span><span class="iv">${config.logging.format}</span></div>
        </div>
      </div>
      <div style="text-align:center;margin-bottom:24px">
        <button type="submit" class="rf" style="font-size:14px;padding:10px 30px">Save Config</button>
        <span class="mu sm" style="margin-left:12px">Restart Gateway to apply changes</span>
      </div>
      </form>

      <div class="panel mt8">
        <div class="ph"><h3>Running Tasks (${runningRuns.length} / ${config.worker.maxConcurrency} concurrency)</h3></div>
        ${runningRuns.length > 0 ? `<table>
          <thead><tr><th>Run</th><th>Task</th><th>Session</th><th>Model</th><th>Started</th><th>Last Heartbeat</th><th>PID</th><th>Duration</th></tr></thead>
          <tbody>${runRows}</tbody>
        </table>` : `<div class="ta-center mu p30">No running tasks</div>`}
      </div>

      <div class="card mt16">
        <h3 style="margin:0 0 12px;font-size:14px">Task Statistics</h3>
        <div class="g4 mb0">
          <div><span class="mu sm">Pending:</span> <strong>${stats.pending || 0}</strong></div>
          <div><span class="mu sm">Running:</span> <strong style="color:var(--blue)">${stats.running || 0}</strong></div>
          <div><span class="mu sm">Done:</span> <strong style="color:var(--green)">${stats.done || 0}</strong></div>
          <div><span class="mu sm">Failed/Dead:</span> <strong style="color:var(--red)">${(stats.failed || 0) + (stats.dead_letter || 0)}</strong></div>
        </div>
      </div>

      <div class="card mt16">
        <h3 style="margin:0 0 12px;font-size:14px">Config File</h3>
        <div class="ir"><span class="ik">Path</span><span class="iv m sm">${CONFIG_PATH}</span></div>
        <div class="ir"><span class="ik">Exists</span><span class="iv">${configFileStatus}</span></div>
      </div>

      <div class="card mt16" style="border-color:var(--red)">
        <h3 style="margin:0 0 12px;font-size:14px;color:var(--red)">Danger Zone</h3>
        <p class="sm mu" style="margin:0 0 12px">Clear ALL task data (tasks + task_runs + task_templates). This cannot be undone.</p>
        <button class="btn btn-danger" style="border-color:var(--red);color:var(--red);padding:6px 16px" onclick="clearDatabase()">Clear Database</button>
      </div>`;

    return c.html(renderLayout('System Status', 'system', body));
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
    });
    return c.json({ success: true, taskId: task.id });
});

app.put('/api/config', async (c) => {
    try {
        const body = (await c.req.json()) as Record<string, unknown>;
        const current = readCurrentConfig();
        const curW = (current.worker ?? {}) as Record<string, unknown>;
        const curS = (current.scheduler ?? {}) as Record<string, unknown>;
        const curD = (current.watchdog ?? {}) as Record<string, unknown>;
        const bW = (body.worker ?? {}) as Record<string, unknown>;
        const bS = (body.scheduler ?? {}) as Record<string, unknown>;
        const bD = (body.watchdog ?? {}) as Record<string, unknown>;
        const merged = { ...current, ...body, worker: { ...curW, ...bW }, scheduler: { ...curS, ...bS }, watchdog: { ...curD, ...bD } };
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

export const dashboardApp = app;

export default {
    port: 4680,
    fetch: app.fetch,
};
