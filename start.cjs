const { spawn } = require('child_process');
const path = require('path');
const cwd = path.resolve(__dirname);

const child = spawn(process.execPath, ['run', 'scripts/gateway.mjs'], {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
});

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => { console.error(err); process.exit(1); });

function cleanup() {
    try { child.kill(); } catch {}
}
process.once('SIGTERM', cleanup);
process.once('SIGINT', cleanup);
process.once('SIGHUP', cleanup);
process.once('exit', cleanup);
