import { join, dirname } from "path";
import { homedir } from "os";
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const logDir = join(homedir(), ".local", "share", "opencode");
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, "gateway.log");

const ts = () => new Date().toISOString();
appendFileSync(logFile, `[${ts()}] Gateway via scripts/gateway.mjs\n`);

const distDir = join(__dirname, "..", "dist", "gateway", "index.js");
const child = spawn(process.execPath, [distDir], {
  stdio: ["inherit", "pipe", "pipe"],
  env: { ...process.env },
  windowsHide: true,
});

function tee(stream, isStderr = false) {
  stream.on("data", (chunk) => {
    if (isStderr) process.stderr.write(chunk);
    else process.stdout.write(chunk);
    const text = chunk.toString();
    appendFileSync(logFile, text.endsWith("\n") ? text : text + "\n");
  });
}
tee(child.stdout);
tee(child.stderr, true);

child.on("exit", (code, signal) => {
  appendFileSync(logFile, `[${ts()}] Gateway exited code=${code} signal=${signal}\n`);
  process.exit(code ?? (signal ? 1 : 0));
});
child.on("error", (err) => {
  appendFileSync(logFile, `[${ts()}] Gateway spawn error: ${err.message}\n`);
  console.error("gateway.mjs: spawn error:", err);
  process.exit(1);
});
