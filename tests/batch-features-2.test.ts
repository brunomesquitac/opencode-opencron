import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb } from './helpers/mock-db';
import { TaskService } from '../src/core/services/task.service';

describe('batch features test #2', () => {
    beforeEach(() => {
        setupTestDb();
    });

    describe('next() excludes multiple batches, null batchId tasks unaffected', () => {
        test('tasks without batchId can still be fetched when multiple batches excluded', async () => {
            const independentTask = await TaskService.add({
                name: 'Independent Task',
                agent: 'a',
                prompt: 'p',
            });
            await TaskService.add({
                name: 'Batch A',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-a',
            });
            await TaskService.add({
                name: 'Batch B',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-b',
            });
            await TaskService.add({
                name: 'Batch C',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-c',
            });

            const next = await TaskService.next({
                excludedBatchIds: ['batch-a', 'batch-b', 'batch-c'],
            });
            expect(next).not.toBeNull();
            expect(next!.id).toBe(independentTask.id);
            expect(next!.batchId).toBeNull();
        });

        test('only tasks without batchId remain after excluding all batches', async () => {
            const t1 = await TaskService.add({ name: 'Independent 1', agent: 'a', prompt: 'p' });
            const t2 = await TaskService.add({ name: 'Independent 2', agent: 'a', prompt: 'p' });
            await TaskService.add({ name: 'Batch A', agent: 'a', prompt: 'p', batchId: 'batch-a' });

            const next1 = await TaskService.next({ excludedBatchIds: ['batch-a'] });
            expect(next1!.id).toBe(t1.id);

            await TaskService.start(t1.id);
            await TaskService.done(t1.id);

            const next2 = await TaskService.next({ excludedBatchIds: ['batch-a'] });
            expect(next2!.id).toBe(t2.id);
        });

        test('excludedBatchIds empty array produces no filter effect', async () => {
            const batchTask = await TaskService.add({
                name: 'Batch Task',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-x',
                importance: 5,
                urgency: 5,
            });
            await TaskService.add({
                name: 'Independent Task',
                agent: 'a',
                prompt: 'p',
                importance: 1,
                urgency: 1,
            });

            const next = await TaskService.next({ excludedBatchIds: [] });
            expect(next).not.toBeNull();
            expect(next!.id).toBe(batchTask.id);
        });
    });

    describe('retryBatch edge cases', () => {
        test('retryBatch retries both failed and dead_letter status', async () => {
            const t1 = await TaskService.add({
                name: 'Task 1',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-retry',
                maxRetries: 3,
            });
            const t2 = await TaskService.add({
                name: 'Task 2',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-retry',
                maxRetries: 1,
            });

            await TaskService.start(t1.id);
            await TaskService.fail(t1.id, 'first failure');
            expect((await TaskService.getById(t1.id))!.status).toBe('failed');

            await TaskService.start(t2.id);
            await TaskService.fail(t2.id, 'reached limit');
            expect((await TaskService.getById(t2.id))!.status).toBe('dead_letter');

            const count = await TaskService.retryBatch('batch-retry');
            expect(count).toBe(2);

            const r1 = await TaskService.getById(t1.id);
            const r2 = await TaskService.getById(t2.id);
            expect(r1!.status).toBe('pending');
            expect(r2!.status).toBe('pending');
        });

        test('retryBatch does not affect pending/running/done/cancelled tasks', async () => {
            const pending = await TaskService.add({
                name: 'Pending',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-mixed',
            });
            const running = await TaskService.add({
                name: 'Running',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-mixed',
            });
            const done = await TaskService.add({
                name: 'Done',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-mixed',
            });
            const cancelled = await TaskService.add({
                name: 'Cancelled',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-mixed',
            });

            await TaskService.start(running.id);
            await TaskService.start(done.id);
            await TaskService.done(done.id);
            await TaskService.cancel(cancelled.id);

            const count = await TaskService.retryBatch('batch-mixed');
            expect(count).toBe(0);

            expect((await TaskService.getById(pending.id))!.status).toBe('pending');
            expect((await TaskService.getById(running.id))!.status).toBe('running');
            expect((await TaskService.getById(done.id))!.status).toBe('done');
            expect((await TaskService.getById(cancelled.id))!.status).toBe('cancelled');
        });

        test('retryBatch with cwd filter', async () => {
            const t1 = await TaskService.add({
                name: 'Project A Task',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-cwd',
                cwd: '/project-a',
                maxRetries: 3,
            });
            const t2 = await TaskService.add({
                name: 'Project B Task',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-cwd',
                cwd: '/project-b',
                maxRetries: 3,
            });

            await TaskService.start(t1.id);
            await TaskService.fail(t1.id, 'failed');
            await TaskService.start(t2.id);
            await TaskService.fail(t2.id, 'failed');

            const countA = await TaskService.retryBatch('batch-cwd', { cwd: '/project-a' });
            expect(countA).toBe(1);

            const r1 = await TaskService.getById(t1.id);
            const r2 = await TaskService.getById(t2.id);
            expect(r1!.status).toBe('pending');
            expect(r2!.status).toBe('failed');
        });

        test('retryBatch preserves retryCount (manual retry does not reset counter)', async () => {
            const task = await TaskService.add({
                name: 'Retry Count Verify',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-count',
                maxRetries: 5,
            });

            await TaskService.start(task.id);
            await TaskService.fail(task.id, 'failed once');
            expect((await TaskService.getById(task.id))!.retryCount).toBe(1);

            await TaskService.start(task.id);
            await TaskService.fail(task.id, 'failed twice');
            expect((await TaskService.getById(task.id))!.retryCount).toBe(2);

            await TaskService.retryBatch('batch-count');

            const found = await TaskService.getById(task.id);
            expect(found!.status).toBe('pending');
            expect(found!.retryCount).toBe(2);
        });
    });

    describe('stats filter by batchId', () => {
        test('stats only returns data for specified batch', async () => {
            for (let i = 0; i < 3; i++) {
                const t = await TaskService.add({
                    name: `Batch A Task ${i}`,
                    agent: 'a',
                    prompt: 'p',
                    batchId: 'stats-batch-a',
                });
                await TaskService.start(t.id);
                await TaskService.done(t.id);
            }

            const failed = await TaskService.add({
                name: 'Batch B Failed Task',
                agent: 'a',
                prompt: 'p',
                batchId: 'stats-batch-b',
                maxRetries: 3,
            });
            await TaskService.start(failed.id);
            await TaskService.fail(failed.id, 'failed');

            const statsA = await TaskService.stats({ batchId: 'stats-batch-a' });
            expect(statsA.total).toBe(3);
            expect(statsA.done).toBe(3);
            expect(statsA.failed).toBe(0);
            expect(statsA.pending).toBe(0);

            const statsB = await TaskService.stats({ batchId: 'stats-batch-b' });
            expect(statsB.total).toBe(1);
            expect(statsB.failed).toBe(1);
        });

        test('stats returns all zeros for non-existent batch', async () => {
            const stats = await TaskService.stats({ batchId: 'nonexistent' });
            expect(stats.total).toBe(0);
        });

        test('stats filter by both batchId and cwd', async () => {
            const t1 = await TaskService.add({
                name: 'Project A Batch X',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-x',
                cwd: '/project-a',
            });
            const t2 = await TaskService.add({
                name: 'Project B Batch X',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-x',
                cwd: '/project-b',
            });

            await TaskService.start(t1.id);
            await TaskService.done(t1.id);

            const stats = await TaskService.stats({ batchId: 'batch-x', cwd: '/project-a' });
            expect(stats.total).toBe(1);
            expect(stats.done).toBe(1);
        });
    });

    describe('batch tasks with dependencies', () => {
        test('dependent task in batch can be fetched after dependency completes when dependency not in batch', async () => {
            const dep = await TaskService.add({
                name: 'Prerequisite (no batch)',
                agent: 'a',
                prompt: 'p',
            });
            const dependent = await TaskService.add({
                name: 'Dependent (has batch)',
                agent: 'a',
                prompt: 'p',
                dependsOn: dep.id,
                batchId: 'batch-dep',
            });

            const nextBefore = await TaskService.next();
            expect(nextBefore).not.toBeNull();
            expect(nextBefore!.id).toBe(dep.id);

            await TaskService.start(dep.id);
            await TaskService.done(dep.id);

            const nextAfter = await TaskService.next();
            expect(nextAfter).not.toBeNull();
            expect(nextAfter!.id).toBe(dependent.id);
            expect(nextAfter!.batchId).toBe('batch-dep');
        });

        test('dependent task in batch cannot be fetched when batch excluded', async () => {
            const dep = await TaskService.add({
                name: 'Prerequisite',
                agent: 'a',
                prompt: 'p',
            });
            await TaskService.add({
                name: 'Dependent',
                agent: 'a',
                prompt: 'p',
                dependsOn: dep.id,
                batchId: 'batch-excluded',
            });

            await TaskService.start(dep.id);
            await TaskService.done(dep.id);

            const next = await TaskService.next({ excludedBatchIds: ['batch-excluded'] });
            expect(next).toBeNull();
        });

        test('multi-level dependency chain (A→B→C) all in same batch', async () => {
            const a = await TaskService.add({
                name: 'Step A',
                agent: 'a',
                prompt: 'p',
                batchId: 'chain',
            });
            const b = await TaskService.add({
                name: 'Step B',
                agent: 'a',
                prompt: 'p',
                dependsOn: a.id,
                batchId: 'chain',
            });
            const c = await TaskService.add({
                name: 'Step C',
                agent: 'a',
                prompt: 'p',
                dependsOn: b.id,
                batchId: 'chain',
            });

            const next1 = await TaskService.next();
            expect(next1!.id).toBe(a.id);

            await TaskService.start(a.id);
            await TaskService.done(a.id);

            const next2 = await TaskService.next();
            expect(next2!.id).toBe(b.id);

            await TaskService.start(b.id);
            await TaskService.done(b.id);

            const next3 = await TaskService.next();
            expect(next3!.id).toBe(c.id);
        });
    });

    describe('batch and priority interaction', () => {
        test('different batches with different priorities, next returns highest priority', async () => {
            const low = await TaskService.add({
                name: 'Batch A Low Priority',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-prio-a',
                importance: 1,
                urgency: 1,
            });
            const high = await TaskService.add({
                name: 'Batch B High Priority',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-prio-b',
                importance: 5,
                urgency: 5,
            });

            const next = await TaskService.next();
            expect(next!.id).toBe(high.id);
            expect(next!.batchId).toBe('batch-prio-b');
        });

        test('when high priority batch excluded, return next highest priority from other batches', async () => {
            const low = await TaskService.add({
                name: 'Batch A',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-ex-high',
                importance: 5,
                urgency: 5,
            });
            const high = await TaskService.add({
                name: 'Batch B',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-ex-low',
                importance: 3,
                urgency: 3,
            });

            const next = await TaskService.next({ excludedBatchIds: ['batch-ex-high'] });
            expect(next!.id).toBe(high.id);
            expect(next!.batchId).toBe('batch-ex-low');
        });

        test('multiple pending tasks in same batch ordered by priority', async () => {
            const low = await TaskService.add({
                name: 'Low',
                agent: 'a',
                prompt: 'p',
                batchId: 'same-batch',
                importance: 1,
                urgency: 1,
            });
            const high = await TaskService.add({
                name: 'High',
                agent: 'a',
                prompt: 'p',
                batchId: 'same-batch',
                importance: 5,
                urgency: 5,
            });

            const next = await TaskService.next();
            expect(next!.id).toBe(high.id);
        });
    });

    describe('batch task lifecycle state transitions', () => {
        test('batch task lifecycle: pending → running → done', async () => {
            const task = await TaskService.add({
                name: 'Batch Lifecycle',
                agent: 'a',
                prompt: 'p',
                batchId: 'lifecycle-batch',
            });

            expect((await TaskService.getById(task.id))!.status).toBe('pending');

            const started = await TaskService.start(task.id);
            expect(started!.status).toBe('running');
            expect(started!.batchId).toBe('lifecycle-batch');

            const finished = await TaskService.done(task.id, 'complete');
            expect(finished!.status).toBe('done');
            expect(finished!.batchId).toBe('lifecycle-batch');
            expect(finished!.resultLog).toBe('complete');
        });

        test('batch task failure lifecycle: pending → running → failed → retryBatch → pending → running → done', async () => {
            const task = await TaskService.add({
                name: 'Failure Recovery Test',
                agent: 'a',
                prompt: 'p',
                batchId: 'lifecycle-fail',
                maxRetries: 3,
            });

            await TaskService.start(task.id);
            await TaskService.fail(task.id, 'first failure');
            expect((await TaskService.getById(task.id))!.status).toBe('failed');
            expect((await TaskService.getById(task.id))!.retryCount).toBe(1);

            await TaskService.retryBatch('lifecycle-fail');
            expect((await TaskService.getById(task.id))!.status).toBe('pending');

            await TaskService.start(task.id);
            await TaskService.done(task.id, 'second success');
            expect((await TaskService.getById(task.id))!.status).toBe('done');
        });

        test('cancelled batch task cannot be restored by retryBatch', async () => {
            const task = await TaskService.add({
                name: 'Cancelled Batch Task',
                agent: 'a',
                prompt: 'p',
                batchId: 'cancelled-batch',
            });

            await TaskService.cancel(task.id);
            expect((await TaskService.getById(task.id))!.status).toBe('cancelled');

            const count = await TaskService.retryBatch('cancelled-batch');
            expect(count).toBe(0);
            expect((await TaskService.getById(task.id))!.status).toBe('cancelled');
        });

        test('dead_letter batch task can be restored by retryBatch', async () => {
            const task = await TaskService.add({
                name: 'Dead Letter Recovery',
                agent: 'a',
                prompt: 'p',
                batchId: 'dead-batch',
                maxRetries: 1,
            });

            await TaskService.start(task.id);
            await TaskService.fail(task.id, 'immediate dead letter');
            expect((await TaskService.getById(task.id))!.status).toBe('dead_letter');

            await TaskService.retryBatch('dead-batch');
            expect((await TaskService.getById(task.id))!.status).toBe('pending');

            await TaskService.start(task.id);
            await TaskService.done(task.id, 'recovery successful');
            expect((await TaskService.getById(task.id))!.status).toBe('done');
        });
    });

    describe('deleteOlderThan with batches', () => {
        test('deleteOlderThan removes expired completed batch tasks, batch stats reset to zero', async () => {
            const { getDb } = await import('../src/core/db');
            const sqliteDb = getDb();

            const t1 = await TaskService.add({
                name: 'Batch Task A',
                agent: 'a',
                prompt: 'p',
                batchId: 'old-batch',
            });
            const t2 = await TaskService.add({
                name: 'Batch Task B',
                agent: 'a',
                prompt: 'p',
                batchId: 'old-batch',
            });

            await TaskService.start(t1.id);
            await TaskService.done(t1.id);
            await TaskService.start(t2.id);
            await TaskService.done(t2.id);

            const statsBefore = await TaskService.stats({ batchId: 'old-batch' });
            expect(statsBefore.done).toBe(2);

            const { tasks } = await import('../src/core/db/schema');
            const { sql } = await import('drizzle-orm');
            await sqliteDb
                .update(tasks)
                .set({ finishedAt: new Date(1000) })
                .where(sql`${tasks.id} IN (${t1.id}, ${t2.id})`);

            const deleted = await TaskService.deleteOlderThan(-1);
            expect(deleted).toBe(2);

            const statsAfter = await TaskService.stats({ batchId: 'old-batch' });
            expect(statsAfter.total).toBe(0);
        });
    });
});
