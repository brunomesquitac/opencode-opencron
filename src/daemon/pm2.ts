import { execSync, spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATEWAY_ENTRY = join(__dirname, "../gateway/index.js");
const PROCESS_NAME = "opencron-gateway";
const VERSION_FILE = join(homedir(), ".local/share/opencode/opencron-gateway-version");

function getPackageVersion(): string {
    try {
        const pkgPath = join(__dirname, "../package.json");
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}

function getRunningVersion(): string | null {
    try {
        if (!existsSync(VERSION_FILE)) return null;
        return readFileSync(VERSION_FILE, "utf-8").trim() || null;
    } catch {
        return null;
    }
}

function writeRunningVersion(version: string): void {
    try {
        writeFileSync(VERSION_FILE, version, "utf-8");
    } catch {}
}

function pm2Bin(): string {
    return process.platform === "win32" ? "pm2.cmd" : "pm2";
}

function isPm2Installed(): boolean {
    try {
        const cmd = process.platform === "win32" ? "where pm2" : "which pm2";
        execSync(cmd, { stdio: "pipe" });
        return true;
    } catch {
        return false;
    }
}

function installPm2(): boolean {
    console.log("[opencron] Installing pm2...");
    try {
        execSync("npm install -g pm2", { stdio: "inherit" });
        return true;
    } catch {
        try {
            execSync("bun install -g pm2", { stdio: "inherit" });
            return true;
        } catch {
            return false;
        }
    }
}

function pm2Exec(args: string[]): { ok: boolean; output: string } {
    const bin = pm2Bin();
    try {
        const result = spawnSync(bin, args, {
            stdio: ["pipe", "pipe", "pipe"],
            encoding: "utf-8",
            shell: process.platform === "win32",
        });
        const output = (result.stdout ?? "") + (result.stderr ?? "");
        return { ok: result.status === 0, output };
    } catch (err) {
        return { ok: false, output: err instanceof Error ? err.message : String(err) };
    }
}

function pm2JsonList(): Array<{ name: string; pm2_env?: { status: string } }> {
    const { ok, output } = pm2Exec(["jlist"]);
    if (!ok) return [];
    try {
        return JSON.parse(output);
    } catch {
        return [];
    }
}

export function isGatewayRunning(): boolean {
    const list = pm2JsonList();
    const proc = list.find((p) => p.name === PROCESS_NAME);
    if (!proc) return false;
    return proc.pm2_env?.status === "online";
}

function findBunPath(): string {
    try {
        const cmd = process.platform === "win32" ? "where bun" : "which bun";
        return execSync(cmd, { stdio: "pipe" }).toString().trim().split("\n")[0];
    } catch {
        return process.execPath;
    }
}

function pm2StartGateway(version: string): { ok: boolean; output: string } {
    const bunPath = findBunPath();
    const cwd = dirname(dirname(GATEWAY_ENTRY));
    return pm2Exec([
        "start",
        bunPath,
        "--name",
        PROCESS_NAME,
        "--interpreter",
        "none",
        "--restart-delay",
        "5000",
        "--max-restarts",
        "30",
        "--cwd",
        cwd,
        "--",
        "run",
        "scripts/gateway.mjs",
    ]);
}

export function install(): void {
    if (!isPm2Installed()) {
        if (!installPm2()) {
            throw new Error("[opencron] Failed to install pm2. Please install it manually: npm install -g pm2");
        }
    }
    console.log("[opencron] pm2 ready");

    const list = pm2JsonList();
    const existing = list.find((p) => p.name === PROCESS_NAME);

    if (existing) {
        console.log("[opencron] Gateway process already registered, reloading...");
        const { ok } = pm2Exec(["reload", PROCESS_NAME]);
        if (!ok) {
            console.error("[opencron] pm2 reload failed, trying restart...");
            pm2Exec(["restart", PROCESS_NAME]);
        }
    } else {
        console.log("[opencron] Starting Gateway with pm2...");
        const version = getPackageVersion();
        const { ok, output } = pm2StartGateway(version);
        if (!ok) {
            throw new Error(`[opencron] pm2 start failed: ${output}`);
        }
        writeRunningVersion(version);
    }

    pm2Exec(["save"]);

    console.log("[opencron] Configuring startup...");
    const { ok: startupOk, output: startupOutput } = pm2Exec(["startup"]);
    if (!startupOk) {
        if (startupOutput.includes("sudo") || startupOutput.includes("run as root")) {
            console.log("[opencron] pm2 startup requires elevated permissions.");
            console.log("[opencron] Run the command shown above, or manually execute:");
            console.log(`  pm2 startup`);
            console.log(`  pm2 save`);
        } else if (process.platform === "win32") {
            console.log("[opencron] On Windows, use pm2-installer for startup:");
            console.log("  npm install -g pm2-windows-startup");
            console.log("  pm2-startup install");
        }
    }

    console.log("\n[opencron] Gateway installed and running!");
    console.log("[opencron] Manage with: pm2 status / pm2 logs opencron-gateway");
}

export function uninstall(): void {
    console.log("[opencron] Stopping Gateway...");
    pm2Exec(["stop", PROCESS_NAME]);

    console.log("[opencron] Removing Gateway from pm2...");
    pm2Exec(["delete", PROCESS_NAME]);

    pm2Exec(["save"]);

    console.log("\n[opencron] Gateway removed from pm2.");
    console.log("[opencron] Note: pm2 startup config was not removed (you may have other pm2 processes).");
    console.log("[opencron] To fully remove pm2 startup: pm2 unstartup");
}

export function upgrade(): { before: string | null; after: string; restarted: boolean } {
    const before = getRunningVersion();
    const currentVersion = getPackageVersion();

    const list = pm2JsonList();
    const proc = list.find((p) => p.name === PROCESS_NAME);

    if (proc) {
        console.log(`[opencron] Stopping Gateway (version ${before ?? "unknown"})...`);
        pm2Exec(["delete", PROCESS_NAME]);
    }

    console.log(`[opencron] Starting Gateway (version ${currentVersion})...`);
    const { ok } = pm2StartGateway(currentVersion);
    if (ok) {
        writeRunningVersion(currentVersion);
        pm2Exec(["save"]);
        console.log(`[opencron] Gateway upgraded: ${before ?? "unknown"} → ${currentVersion}`);
    } else {
        throw new Error(`[opencron] Failed to start Gateway after upgrade`);
    }

    return { before, after: currentVersion, restarted: true };
}

export function ensureGateway(): void {
    const currentVersion = getPackageVersion();

    try {
        const list = pm2JsonList();
        const proc = list.find((p) => p.name === PROCESS_NAME);
        if (proc && proc.pm2_env?.status === "online") {
            const runningVersion = getRunningVersion();
            if (runningVersion === currentVersion) {
                return;
            }
            console.log(`[opencron] Version changed: ${runningVersion ?? "unknown"} → ${currentVersion}, reloading Gateway...`);
            pm2Exec(["delete", PROCESS_NAME]);
            const { ok } = pm2StartGateway(currentVersion);
            if (ok) writeRunningVersion(currentVersion);
            pm2Exec(["save"]);
            return;
        }
    } catch {}

    if (!isPm2Installed()) {
        console.log("[opencron] Installing pm2 for Gateway process management...");
        try {
            execSync("npm install -g pm2", { stdio: "pipe" });
        } catch {
            try {
                execSync("bun install -g pm2", { stdio: "pipe" });
            } catch {
                console.warn("[opencron] Could not install pm2. Gateway will not auto-start. Run \`opencron install\` manually.");
                return;
            }
        }
    }

    const pm2List = pm2JsonList();
    const existing = pm2List.find((p) => p.name === PROCESS_NAME);

    if (existing) {
        pm2Exec(["restart", PROCESS_NAME]);
    } else {
        const version = getPackageVersion();
        const { ok } = pm2StartGateway(version);
        if (ok) writeRunningVersion(version);
    }

    pm2Exec(["save"]);
}
