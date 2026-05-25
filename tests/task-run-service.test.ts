import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb } from './helpers/mock-db';
import { TaskService } from '../src/core/services/task.service';
import { TaskRunService } from '../src/core/services/task-run.service';

async function createTask(overrides: Record<string, unknown> = {}) {
    return TaskService.add({
        name: 'Test Task',
        agent: 'test-agent',
        prompt: 'test',
        ...overrides,
    });
}

describe('TaskRunService', () => {
    beforeEach(() => {
        setupTestDb();
    });

    describe('create', () => {
        test('create run record', async () => {
            const task = await createTask();
            const run = await TaskRunService.create({
                taskId: task.id,
                model: 'glm-4',
                status: 'running',
            });
            expect(run.id).toBeGreaterThan(0);
            expect(run.taskId).toBe(task.id);
            expect(run.model).toBe('glm-4');
            expect(run.status).toBe('running');
            expect(run.startedAt).not.toBeNull();
        });
    });

    describe('updateSessionId', () => {
        test('update sessionId', async () => {
            const task = await createTask();
            const run = await TaskRunService.create({ taskId: task.id, status: 'running' });
            const updated = await TaskRunService.updateSessionId(run.id, 'ses_abc123');
            expect(updated).not.toBeNull();
            expect(updated!.sessionId).toBe('ses_abc123');
        });

        test('non-existent runId returns null', async () => {
            const result = await TaskRunService.updateSessionId(99999, 'ses_x');
            expect(result).toBeNull();
        });
    });

    describe('done', () => {
        test('mark as done', async () => {
            const task = await createTask();
            const run = await TaskRunService.create({ taskId: task.id, status: 'running' });
            const finished = await TaskRunService.done(run.id, 'execution successful');
            expect(finished).not.toBeNull();
            expect(finished!.status).toBe('done');
            expect(finished!.finishedAt).not.toBeNull();
            expect(finished!.log).toBe('execution successful');
        });
    });

    describe('fail', () => {
        test('mark as failed', async () => {
            const task = await createTask();
            const run = await TaskRunService.create({ taskId: task.id, status: 'running' });
            const failed = await TaskRunService.fail(run.id, 'execution failed');
            expect(failed).not.toBeNull();
            expect(failed!.status).toBe('failed');
            expect(failed!.finishedAt).not.toBeNull();
            expect(failed!.log).toBe('execution failed');
        });
    });

    describe('heartbeat', () => {
        test('update heartbeat time', async () => {
            const task = await createTask();
            const run = await TaskRunService.create({ taskId: task.id, status: 'running' });
            const before = Date.now();
            const updated = await TaskRunService.heartbeat(run.id);
            expect(updated).not.toBeNull();
            expect(updated!.heartbeatAt!).toBeGreaterThanOrEqual(before);
        });

        test('do not update heartbeat for non-running status', async () => {
            const task = await createTask();
            const run = await TaskRunService.create({ taskId: task.id, status: 'running' });
            await TaskRunService.done(run.id);
            const updated = await TaskRunService.heartbeat(run.id);
            expect(updated).toBeNull();
        });
    });

    describe('updatePid', () => {
        test('update PID info', async () => {
            const task = await createTask();
            const run = await TaskRunService.create({ taskId: task.id, status: 'running' });
            const updated = await TaskRunService.updatePid(run.id, 1000, 2000);
            expect(updated).not.toBeNull();
            expect(updated!.workerPid).toBe(1000);
            expect(updated!.childPid).toBe(2000);
            expect(updated!.lockedAt).not.toBeNull();
            expect(updated!.lockedBy).toContain('gateway-');
        });
    });

    describe('getById', () => {
        test('get existing run record', async () => {
            const task = await createTask();
            const run = await TaskRunService.create({ taskId: task.id, status: 'running' });
            const found = await TaskRunService.getById(run.id);
            expect(found).not.toBeNull();
            expect(found!.id).toBe(run.id);
        });

        test('non-existent ID returns null', async () => {
            const found = await TaskRunService.getById(99999);
            expect(found).toBeNull();
        });
    });

    describe('listByTaskId', () => {
        test('list all run records by taskId', async () => {
            const task = await createTask();
            const r1 = await TaskRunService.create({ taskId: task.id, status: 'running' });
            const r2 = await TaskRunService.create({ taskId: task.id, status: 'running' });

            const runs = await TaskRunService.listByTaskId(task.id);
            expect(runs.length).toBe(2);
            expect(runs.map((r) => r.id)).toContain(r1.id);
            expect(runs.map((r) => r.id)).toContain(r2.id);
        });

        test('no run records returns empty array', async () => {
            const runs = await TaskRunService.listByTaskId(99999);
            expect(runs).toEqual([]);
        });
    });

    describe('getLatestByTaskId', () => {
        test('return latest run record', async () => {
            const task = await createTask();
            await TaskRunService.create({ taskId: task.id, status: 'running' });
            const r2 = await TaskRunService.create({ taskId: task.id, status: 'running' });

            const latest = await TaskRunService.getLatestByTaskId(task.id);
            expect(latest).not.toBeNull();
            expect(latest!.id).toBe(r2.id);
        });

        test('no records returns null', async () => {
            const latest = await TaskRunService.getLatestByTaskId(99999);
            expect(latest).toBeNull();
        });
    });

    describe('getLatestByTaskIds', () => {
        test('batch get latest run records', async () => {
            const t1 = await createTask({ name: 'T1' });
            const t2 = await createTask({ name: 'T2' });
            await TaskRunService.create({ taskId: t1.id, status: 'running' });
            const r2 = await TaskRunService.create({ taskId: t2.id, status: 'running' });

            const map = await TaskRunService.getLatestByTaskIds([t1.id, t2.id]);
            expect(map.size).toBe(2);
            expect(map.get(t2.id)!.id).toBe(r2.id);
        });

        test('empty array returns empty Map', async () => {
            const map = await TaskRunService.getLatestByTaskIds([]);
            expect(map.size).toBe(0);
        });
    });

    describe('getStaleRuns', () => {
        test('detect stale runs (no heartbeat + startedAt expired)', async () => {
            const task = await createTask();
            const run = await TaskRunService.create({ taskId: task.id, status: 'running' });

            const stale = await TaskRunService.getStaleRuns(-100000);
            expect(stale.length).toBe(1);
            expect(stale[0].runId).toBe(run.id);
            expect(stale[0].taskId).toBe(task.id);
        });

        test('detect stale runs (heartbeat present but expired)', async () => {
            const task = await createTask();
            const run = await TaskRunService.create({ taskId: task.id, status: 'running' });
            await TaskRunService.heartbeat(run.id);

            const stale = await TaskRunService.getStaleRuns(-100000);
            expect(stale.length).toBe(1);
        });

        test('normal heartbeat not counted as stale', async () => {
            const task = await createTask();
            await TaskRunService.create({ taskId: task.id, status: 'running' });

            const stale = await TaskRunService.getStaleRuns(3600000);
            expect(stale.length).toBe(0);
        });

        test('non-running status not counted as stale', async () => {
            const task = await createTask();
            const run = await TaskRunService.create({ taskId: task.id, status: 'running' });
            await TaskRunService.done(run.id);

            const stale = await TaskRunService.getStaleRuns(0);
            expect(stale.length).toBe(0);
        });
    });

    describe('getRunningRunByTaskId', () => {
        test('get currently running record', async () => {
            const task = await createTask();
            const run = await TaskRunService.create({ taskId: task.id, status: 'running' });

            const found = await TaskRunService.getRunningRunByTaskId(task.id);
            expect(found).not.toBeNull();
            expect(found!.id).toBe(run.id);
        });

        test('no running record returns null', async () => {
            const task = await createTask();
            const run = await TaskRunService.create({ taskId: task.id, status: 'running' });
            await TaskRunService.done(run.id);

            const found = await TaskRunService.getRunningRunByTaskId(task.id);
            expect(found).toBeNull();
        });
    });

    describe('deleteByTaskIds', () => {
        test('delete run records by task IDs', async () => {
            const t1 = await createTask({ name: 'T1' });
            const t2 = await createTask({ name: 'T2' });
            await TaskRunService.create({ taskId: t1.id, status: 'running' });
            await TaskRunService.create({ taskId: t2.id, status: 'running' });

            const count = await TaskRunService.deleteByTaskIds([t1.id, t2.id]);
            expect(count).toBe(2);

            const runs1 = await TaskRunService.listByTaskId(t1.id);
            expect(runs1).toEqual([]);
        });

        test('empty array returns 0', async () => {
            const count = await TaskRunService.deleteByTaskIds([]);
            expect(count).toBe(0);
        });
    });

    describe('getAllRunningRuns', () => {
        test('get all running records', async () => {
            const t1 = await createTask({ name: 'T1' });
            const t2 = await createTask({ name: 'T2' });
            await TaskRunService.create({ taskId: t1.id, status: 'running' });
            await TaskRunService.create({ taskId: t2.id, status: 'running' });

            const runs = await TaskRunService.getAllRunningRuns();
            expect(runs.length).toBe(2);
        });

        test('exclude non-running status', async () => {
            const task = await createTask();
            const run = await TaskRunService.create({ taskId: task.id, status: 'running' });
            await TaskRunService.done(run.id);

            const runs = await TaskRunService.getAllRunningRuns();
            expect(runs.length).toBe(0);
        });
    });

    describe('TaskRunService and TaskService coordination', () => {
        test('full lifecycle: add→start→create run→done run→done task', async () => {
            const task = await createTask({ name: 'Full Lifecycle' });
            await TaskService.start(task.id);

            const run = await TaskRunService.create({
                taskId: task.id,
                status: 'running',
                model: 'glm-4',
            });
            expect(run.status).toBe('running');

            await TaskRunService.done(run.id, 'run complete');
            await TaskService.done(task.id, 'task complete');

            const updatedTask = await TaskService.getById(task.id);
            expect(updatedTask!.status).toBe('done');

            const updatedRun = await TaskRunService.getById(run.id);
            expect(updatedRun!.status).toBe('done');
        });

        test('failure lifecycle: add→start→create run→fail run→fail task', async () => {
            const task = await createTask({ name: 'Failure Lifecycle', maxRetries: 3 });
            await TaskService.start(task.id);

            const run = await TaskRunService.create({
                taskId: task.id,
                status: 'running',
            });

            await TaskRunService.fail(run.id, 'execution error');
            await TaskService.fail(task.id, 'execution error');

            const updatedTask = await TaskService.getById(task.id);
            expect(updatedTask!.status).toBe('failed');
            expect(updatedTask!.retryCount).toBe(1);

            const updatedRun = await TaskRunService.getById(run.id);
            expect(updatedRun!.status).toBe('failed');
        });
    });
});
