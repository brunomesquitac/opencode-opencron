import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, sep } from 'path';
import { homedir, platform } from 'os';

export interface AgentInfo {
    name: string;
    description: string;
    mode: string;
}

export interface ModelInfo {
    id: string;
    label: string;
}

export interface DirEntry {
    name: string;
    path: string;
}

export interface ValidationResult {
    valid: boolean;
    error?: string;
}

const BUILTIN_AGENTS: AgentInfo[] = [
    { name: 'build',   description: 'Standard dev agent with all tools', mode: 'primary' },
    { name: 'plan',    description: 'Planning and analysis, read-only',  mode: 'primary' },
    { name: 'general', description: 'General-purpose multi-step agent',  mode: 'subagent' },
    { name: 'explore', description: 'Fast codebase explorer, read-only', mode: 'subagent' },
    { name: 'scout',   description: 'External docs and dependency research', mode: 'subagent' },
];

function globalAgentsDir(): string {
    return join(homedir(), '.config', 'opencode', 'agents');
}

function projectAgentsDir(cwd: string): string {
    return join(cwd, '.opencode', 'agents');
}

function globalConfigPath(): string {
    return join(homedir(), '.config', 'opencode', 'opencode.jsonc');
}

function projectConfigPath(cwd: string): string {
    return join(cwd, '.opencode', 'opencode.json');
}

function readJsonc(path: string): Record<string, unknown> | null {
    try {
        if (!existsSync(path)) return null;
        const raw = readFileSync(path, 'utf-8');
        const stripped = raw
            .replace(/\\"|"(?:[^"\\]|\\.)*"/g, m => m.replace(/\//g, '\u0000'))
            .replace(/\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\u0000/g, '/');
        return JSON.parse(stripped) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function parseAgentMd(filePath: string, name: string): AgentInfo | null {
    try {
        const content = readFileSync(filePath, 'utf-8');
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;
        const frontmatter = match[1];
        const desc = frontmatter.match(/description:\s*(.+)/)?.[1]?.trim() || '';
        const mode = frontmatter.match(/mode:\s*(.+)/)?.[1]?.trim() || 'subagent';
        return { name, description: desc, mode };
    } catch {
        return null;
    }
}

function readAgentFilesFromDir(dir: string): AgentInfo[] {
    if (!existsSync(dir)) return [];
    try {
        return readdirSync(dir)
            .filter(f => f.endsWith('.md'))
            .map(f => parseAgentMd(join(dir, f), f.slice(0, -3)))
            .filter((a): a is AgentInfo => a !== null);
    } catch {
        return [];
    }
}

function readAgentsFromJsonc(config: Record<string, unknown>): AgentInfo[] {
    const agentBlock = config.agent as Record<string, unknown> | undefined;
    if (!agentBlock) return [];
    const result: AgentInfo[] = [];
    for (const [name, val] of Object.entries(agentBlock)) {
        if (typeof val === 'object' && val !== null) {
            const agent = val as Record<string, unknown>;
            result.push({
                name,
                description: String(agent.description ?? ''),
                mode: String(agent.mode ?? 'subagent'),
            });
        }
    }
    return result;
}

export function getAgents(cwd?: string): AgentInfo[] {
    const seen = new Set<string>();
    const result: AgentInfo[] = [];

    // Built-in first (lowest priority — overridden by globals and project)
    for (const a of BUILTIN_AGENTS) {
        seen.add(a.name);
        result.push(a);
    }

    // Global agents dir
    const globalMd = readAgentFilesFromDir(globalAgentsDir());
    for (const a of globalMd) {
        if (seen.has(a.name)) {
            const idx = result.findIndex(r => r.name === a.name);
            if (idx >= 0) result[idx] = a;
        } else {
            seen.add(a.name);
            result.push(a);
        }
    }

    // Global agents from opencode.jsonc
    const globalConfig = readJsonc(globalConfigPath());
    if (globalConfig) {
        const fromJson = readAgentsFromJsonc(globalConfig);
        for (const a of fromJson) {
            if (seen.has(a.name)) {
                const idx = result.findIndex(r => r.name === a.name);
                if (idx >= 0) result[idx] = a;
            } else {
                seen.add(a.name);
                result.push(a);
            }
        }
    }

    // Project agents (highest priority)
    if (cwd) {
        const projectMd = readAgentFilesFromDir(projectAgentsDir(cwd));
        for (const a of projectMd) {
            if (seen.has(a.name)) {
                const idx = result.findIndex(r => r.name === a.name);
                if (idx >= 0) result[idx] = a;
            } else {
                seen.add(a.name);
                result.push(a);
            }
        }

        const projectConfig = readJsonc(projectConfigPath(cwd));
        if (projectConfig) {
            const fromJson = readAgentsFromJsonc(projectConfig);
            for (const a of fromJson) {
                if (seen.has(a.name)) {
                    const idx = result.findIndex(r => r.name === a.name);
                    if (idx >= 0) result[idx] = a;
                } else {
                    seen.add(a.name);
                    result.push(a);
                }
            }
        }
    }

    return result;
}

let cliModelsCache: { result: ModelInfo[] | null; timestamp: number } | null = null;
const CLI_CACHE_TTL = 60_000; // 60 seconds

function fetchModelsFromCli(): ModelInfo[] | null {
    try {
        const proc = Bun.spawnSync(['opencode', 'models', '--verbose'], {
            timeout: 10_000,
        });
        if (proc.exitCode !== 0) return null;
        const stdout = proc.stdout.toString();
        return parseModelsCliOutput(stdout);
    } catch {
        return null;
    }
}

function parseModelsCliOutput(output: string): ModelInfo[] | null {
    try {
        const lines = output.split('\n');
        const models: ModelInfo[] = [];
        let i = 0;
        while (i < lines.length) {
            const line = lines[i].trim();
            if (line.startsWith('{')) {
                const jsonLines: string[] = [];
                let depth = 0;
                for (let j = i; j < lines.length; j++) {
                    jsonLines.push(lines[j]);
                    for (const ch of lines[j]) {
                        if (ch === '{') depth++;
                        else if (ch === '}') depth--;
                    }
                    if (depth === 0) {
                        const json = JSON.parse(jsonLines.join('\n')) as Record<string, unknown>;
                        const providerId = String(json.providerID ?? '');
                        const modelId = String(json.id ?? '');
                        const name = String(json.name ?? modelId);
                        const fullId = providerId ? `${providerId}/${modelId}` : modelId;
                        models.push({ id: fullId, label: name });
                        i = j + 1;
                        break;
                    }
                }
            }
            i++;
        }
        return models.length > 0 ? models : null;
    } catch {
        return null;
    }
}

function getCachedModelsFromCli(): ModelInfo[] | null {
    const now = Date.now();
    if (cliModelsCache && (now - cliModelsCache.timestamp) < CLI_CACHE_TTL) {
        return cliModelsCache.result;
    }
    const result = fetchModelsFromCli();
    cliModelsCache = { result, timestamp: now };
    return result;
}

export function getModels(cwd?: string): ModelInfo[] {
    const seen = new Set<string>();
    const result: ModelInfo[] = [];

    // Always include "default"
    result.push({ id: 'default', label: 'default (use agent model)' });
    seen.add('default');

    function extractModels(config: Record<string, unknown>, source: string): void {
        const model = config.model;
        if (model && typeof model === 'string' && !seen.has(model)) {
            seen.add(model);
            result.push({ id: model, label: `${model} (${source})` });
        }

        const models = config.models as Record<string, unknown> | undefined;
        if (models) {
            for (const [key, val] of Object.entries(models)) {
                const id = String(val);
                if (!seen.has(id)) {
                    seen.add(id);
                    result.push({ id, label: `${key} — ${id} (${source})` });
                }
            }
        }

        const agents = config.agent as Record<string, unknown> | undefined;
        if (agents) {
            for (const [, val] of Object.entries(agents)) {
                if (typeof val === 'object' && val !== null) {
                    const m = (val as Record<string, unknown>).model;
                    if (m && typeof m === 'string' && !seen.has(m)) {
                        seen.add(m);
                        result.push({ id: m, label: `${m} (${source})` });
                    }
                }
            }
        }
    }

    // CLI models as base (all available models from opencode)
    const cliModels = getCachedModelsFromCli();
    if (cliModels) {
        for (const m of cliModels) {
            if (!seen.has(m.id)) {
                seen.add(m.id);
                result.push(m);
            }
        }
    }

    // Config-derived models on top (may add extras or change labels)
    const globalConfig = readJsonc(globalConfigPath());
    if (globalConfig) extractModels(globalConfig, 'global');

    if (cwd) {
        const projectConfig = readJsonc(projectConfigPath(cwd));
        if (projectConfig) extractModels(projectConfig, 'project');
    }

    return result;
}

export function listDirectories(parentPath?: string): DirEntry[] {
    const target = parentPath || homedir();
    try {
        const entries = readdirSync(target);
        const dirs: DirEntry[] = [];
        for (const name of entries) {
            if (name.startsWith('.')) continue;
            try {
                const fullPath = join(target, name);
                const stat = statSync(fullPath);
                if (stat.isDirectory()) {
                    dirs.push({ name, path: fullPath });
                }
            } catch {
                // skip inaccessible
            }
        }
        return dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    } catch {
        return [];
    }
}

const WINDOWS_DRIVES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function listRootEntries(): DirEntry[] {
    if (platform() === 'win32') {
        const entries: DirEntry[] = [];
        for (const letter of WINDOWS_DRIVES) {
            const path = `${letter}:\\`;
            try {
                statSync(path);
                entries.push({ name: `${letter}:\\`, path });
            } catch {
                // drive not available
            }
        }
        return entries;
    }
    return listDirectories('/');
}

export function validatePath(path: string): ValidationResult {
    if (!path || path.trim().length === 0) {
        return { valid: false, error: 'Path is empty' };
    }
    try {
        if (!existsSync(path)) {
            return { valid: false, error: 'Path does not exist' };
        }
        const stat = statSync(path);
        if (!stat.isDirectory()) {
            return { valid: false, error: 'Path is not a directory' };
        }
        return { valid: true };
    } catch (err) {
        return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
}
