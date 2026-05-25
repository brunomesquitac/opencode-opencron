import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb } from './helpers/mock-db';
import { checkHeartbeats } from '../src/gateway/watchdog/heartbeat';
import { cleanupOldRecords } from '../src/gateway/watchdog/cleanup';
import { TaskService } from '../src/core/services/task.service';
import { TaskRunService } from '../src/core/services/task-run.service';
import type { ChannelName } from '../src/gateway/channels/channel.interface';

const defaultNotifications = {
    enabled: false,
    defaults: { on_success: [] as ChannelName[], on_failure: [] as ChannelName[], on_dead_letter: [] as ChannelName[] },
    channels: {},
};

async function createTask(overrides: Record<string, unknown> = {}) {
    return TaskService.add({
        name: 'Watchdog Test',
        agent: 'test-agent',
        prompt: 'test',
        ...overrides,
    });
}

describe('checkHeartbeats', () => {
    beforeEach(() => {
        setupTestDb();
    });

    test('do nothing when no stale run', async () => {
        await checkHeartbeats(-100000, defaultNotifications);
    });

    test('detect stale run and mark as dead_letter (max retries reached)', async () => {
        const task = await createTask({ maxRetries: 1 });
        await TaskService.start(task.id);
        await TaskRunService.create({ taskId: task.id, status: 'running' });

        await checkHeartbeats(-100000, defaultNotifications);

        const updatedTask = await TaskService.getById(task.id);
        expect(updatedTask!.status).toBe('dead_letter');
    });

    test('detect stale run and schedule retry (max retries not reached)', async () => {
        const task = await createTask({ maxRetries: 3 });
        await TaskService.start(task.id);
        await TaskRunService.create({ taskId: task.id, status: 'running' });

        await checkHeartbeats(-100000, defaultNotifications);

        const updatedTask = await TaskService.getById(task.id);
        expect(updatedTask!.status).toBe('pending');
        expect(updatedTask!.retryAfter).not.toBeNull();
        expect(updatedTask!.retryCount).toBe(1);
    });

    test('multiple heartbeat timeouts cause dead_letter', async () => {
        const task = await createTask({ maxRetries: 2 });
        await TaskService.start(task.id);
        await TaskRunService.create({ taskId: task.id, status: 'running' });

        await checkHeartbeats(-100000, defaultNotifications);

        let updatedTask = await TaskService.getById(task.id);
        expect(updatedTask!.status).toBe('pending');
        expect(updatedTask!.retryCount).toBe(1);

        await TaskService.start(task.id);
        await TaskRunService.create({ taskId: task.id, status: 'running' });

        await checkHeartbeats(-100000, defaultNotifications);

        updatedTask = await TaskService.getById(task.id);
        expect(updatedTask!.status).toBe('dead_letter');
        expect(updatedTask!.retryCount).toBe(2);
    });

    test('stale run record marked as failed', async () => {
        const task = await createTask({ maxRetries: 3 });
        await TaskService.start(task.id);
        const run = await TaskRunService.create({ taskId: task.id, status: 'running' });

        await checkHeartbeats(-100000, defaultNotifications);

        const updatedRun = await TaskRunService.getById(run.id);
        expect(updatedRun!.status).toBe('failed');
        expect(updatedRun!.log).toContain('Heartbeat timeout');
    });
});

describe('cleanupOldRecords', () => {
    beforeEach(() => {
        setupTestDb();
    });

    test('clean up old completed tasks', async () => {
        const task = await createTask();
        await TaskService.start(task.id);
        await TaskService.done(task.id, 'complete');

        const deleted = await cleanupOldRecords(-1);
        expect(deleted).toBe(1);

        const found = await TaskService.getById(task.id);
        expect(found).toBeNull();
    });

    test('clean up old failed and dead_letter tasks', async () => {
        const t1 = await createTask({ name: 'T1', maxRetries: 1 });
        await TaskService.start(t1.id);
        await TaskService.fail(t1.id, 'failed');

        const t2 = await createTask({ name: 'T2', maxRetries: 1 });
        await TaskService.start(t2.id);
        await TaskService.fail(t2.id, 'dead letter', {}, { setDeadLetter: true });

        const deleted = await cleanupOldRecords(-1);
        expect(deleted).toBe(2);
    });

    test('do not clean up pending/running tasks', async () => {
        const t1 = await createTask({ name: 'P' });
        const t2 = await createTask({ name: 'R' });
        await TaskService.start(t2.id);

        await cleanupOldRecords(-1);

        const found1 = await TaskService.getById(t1.id);
        const found2 = await TaskService.getById(t2.id);
        expect(found1).not.toBeNull();
        expect(found2).not.toBeNull();
    });

    test('also clean up associated run records', async () => {
        const task = await createTask();
        await TaskService.start(task.id);
        const run = await TaskRunService.create({ taskId: task.id, status: 'running' });
        await TaskRunService.done(run.id);
        await TaskService.done(task.id);

        await cleanupOldRecords(-1);

        const runs = await TaskRunService.listByTaskId(task.id);
        expect(runs.length).toBe(0);
    });
});
