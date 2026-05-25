import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const CLI = 'bun run src/cli/index.ts';
let testDbPath: string;

function run(args: string): string {
    return execSync(`${CLI} ${args}`, {
        encoding: 'utf-8',
        timeout: 10000,
        env: { ...process.env, OPENCRON_DB_PATH: testDbPath },
    });
}

function runJson<T>(args: string): T {
    return JSON.parse(run(args)) as T;
}

beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'opencron-cli-test-'));
    testDbPath = join(dir, `${randomUUID()}.db`);
});

afterAll(() => {
    if (testDbPath) {
        rmSync(dirname(testDbPath), { recursive: true, force: true });
    }
});

describe('CLI integration', () => {
    let taskId1: number;
    let taskId2: number;
    let batchTaskId: number;

    test('add task', () => {
        const result = runJson<{ id: number; status: string }>(
            `add --name "Integration Test Task A" --agent "test-agent" --prompt "test prompt" --importance 4 --urgency 5`,
        );
        expect(result.id).toBeGreaterThan(0);
        expect(result.status).toBe('created');
        taskId1 = result.id;
    });

    test('add task with batch', () => {
        const result = runJson<{ id: number; status: string }>(
            `add --name "Batch Task B" --agent "test-agent" --prompt "batch test" --batch "batch-test-001"`,
        );
        expect(result.id).toBeGreaterThan(0);
        batchTaskId = result.id;
    });

    test('list tasks', () => {
        const tasks = runJson<Array<{ id: number; name: string }>>('list --limit 5');
        expect(tasks.length).toBeGreaterThan(0);
    });

    test('get task by id', () => {
        const task = runJson<{ id: number; name: string; status: string }>(`get --id ${taskId1}`);
        expect(task.id).toBe(taskId1);
        expect(task.name).toBe('Integration Test Task A');
    });

    test('next returns a pending task', () => {
        const task = runJson<{ id: number } | { id: null }>('next');
        expect(task).toBeDefined();
    });

    test('start task', () => {
        const task = runJson<{ id: number; status: string }>(`start --id ${taskId1}`);
        expect(task.status).toBe('running');
    });

    test('done task', () => {
        const task = runJson<{ id: number; status: string }>(`done --id ${taskId1} --log "test complete"`);
        expect(task.status).toBe('done');
    });

    test('fail and retry task', () => {
        const added = runJson<{ id: number }>(
            `add --name "Fail Retry Test" --agent "test-agent" --prompt "fail test"`,
        );
        taskId2 = added.id;

        run(`start --id ${taskId2}`);
        const failed = runJson<{ id: number; status: string; retryCount: number }>(
            `fail --id ${taskId2} --log "simulated failure"`,
        );
        expect(failed.status).toBe('failed');

        const retried = runJson<{ id: number; status: string }>(`retry --id ${taskId2}`);
        expect(retried.status).toBe('pending');
    });

    test('cancel task', () => {
        const added = runJson<{ id: number }>(
            `add --name "Cancel Test" --agent "test-agent" --prompt "cancel"`,
        );
        const cancelled = runJson<{ id: number; status: string }>(`cancel --id ${added.id}`);
        expect(cancelled.status).toBe('cancelled');
    });

    test('stats', () => {
        const stats = runJson<Record<string, number>>('status');
        expect(stats.total).toBeGreaterThan(0);
        expect(typeof stats.done).toBe('number');
    });

    test('batch retry', () => {
        run(`start --id ${batchTaskId}`);
        run(`fail --id ${batchTaskId} --log "batch failure"`);
        const result = runJson<{ retried: number; batchId: string }>(`retry --batch batch-test-001`);
        expect(result.retried).toBeGreaterThanOrEqual(1);
    });

    test('delete task', () => {
        const added = runJson<{ id: number }>(
            `add --name "Delete Test" --agent "test-agent" --prompt "delete"`,
        );
        const result = runJson<{ deleted: boolean }>(`delete --id ${added.id}`);
        expect(result.deleted).toBe(true);
    });

    test('list by status', () => {
        const tasks = runJson<Array<{ id: number }>>('list --status done --limit 10');
        expect(Array.isArray(tasks)).toBe(true);
    });
});

describe('CLI template', () => {
    let templateId: number;

    test('template add', () => {
        const result = runJson<{ id: number; status: string; nextRunAt: number | null }>(
            `template add --name "Test Template" --agent "test-agent" --prompt "scheduled task" --type cron --cron "0 9 * * *"`,
        );
        expect(result.id).toBeGreaterThan(0);
        expect(result.status).toBe('created');
        expect(result.nextRunAt).not.toBeNull();
        templateId = result.id;
    });

    test('template list', () => {
        const templates = runJson<Array<{ id: number }>>('template list');
        expect(templates.length).toBeGreaterThan(0);
    });

    test('template disable', () => {
        const result = runJson<{ id: number; enabled: boolean }>(`template disable --id ${templateId}`);
        expect(result.enabled).toBe(false);
    });

    test('template enable', () => {
        const result = runJson<{ id: number; enabled: boolean }>(`template enable --id ${templateId}`);
        expect(result.enabled).toBe(true);
    });

    test('template delete', () => {
        const result = runJson<{ deleted: boolean; id: number }>(`template delete --id ${templateId}`);
        expect(result.deleted).toBe(true);
    });
});
