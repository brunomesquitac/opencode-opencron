import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb } from './helpers/mock-db';
import { TaskService } from '../src/core/services/task.service';

describe('TaskService', () => {
    beforeEach(() => {
        setupTestDb();
    });

    describe('add', () => {
        test('create basic task', async () => {
            const task = await TaskService.add({
                name: 'Translate Document',
                agent: 'translator',
                prompt: 'Translate README.md',
            });
            expect(task.id).toBeGreaterThan(0);
            expect(task.name).toBe('Translate Document');
            expect(task.agent).toBe('translator');
            expect(task.prompt).toBe('Translate README.md');
            expect(task.status).toBe('pending');
            expect(task.importance).toBe(3);
            expect(task.urgency).toBe(3);
            expect(task.retryCount).toBe(0);
            expect(task.maxRetries).toBe(3);
        });

        test('create task with all parameters', async () => {
            const task = await TaskService.add({
                name: 'Urgent Review',
                agent: 'reviewer',
                prompt: 'Review PR #42',
                model: 'gpt-4',
                category: 'review',
                importance: 5,
                urgency: 5,
                batchId: 'batch-001',
                dependsOn: undefined,
                cwd: '/project',
                maxRetries: 5,
            });
            expect(task.category).toBe('review');
            expect(task.importance).toBe(5);
            expect(task.urgency).toBe(5);
            expect(task.batchId).toBe('batch-001');
            expect(task.model).toBe('gpt-4');
            expect(task.cwd).toBe('/project');
            expect(task.maxRetries).toBe(5);
        });
    });

    describe('getById', () => {
        test('get existing task by ID', async () => {
            const created = await TaskService.add({
                name: 'Query Test',
                agent: 'agent-a',
                prompt: 'query',
            });
            const found = await TaskService.getById(created.id);
            expect(found).not.toBeNull();
            expect(found!.id).toBe(created.id);
            expect(found!.name).toBe('Query Test');
        });

        test('get non-existent task returns null', async () => {
            const found = await TaskService.getById(99999);
            expect(found).toBeNull();
        });

        test('filter by cwd', async () => {
            const t1 = await TaskService.add({
                name: 'Project A Task',
                agent: 'agent-a',
                prompt: 'test',
                cwd: '/project-a',
            });
            await TaskService.add({
                name: 'Project B Task',
                agent: 'agent-b',
                prompt: 'test',
                cwd: '/project-b',
            });

            const found = await TaskService.getById(t1.id, { cwd: '/project-a' });
            expect(found).not.toBeNull();

            const notFound = await TaskService.getById(t1.id, { cwd: '/project-b' });
            expect(notFound).toBeNull();
        });
    });

    describe('next', () => {
        test('return highest priority pending task', async () => {
            await TaskService.add({
                name: 'Low Priority',
                agent: 'agent-a',
                prompt: 'low',
                importance: 1,
                urgency: 1,
            });
            await TaskService.add({
                name: 'High Priority',
                agent: 'agent-a',
                prompt: 'high',
                importance: 5,
                urgency: 5,
            });
            await TaskService.add({
                name: 'Medium Priority',
                agent: 'agent-a',
                prompt: 'medium',
                importance: 3,
                urgency: 3,
            });

            const next = await TaskService.next();
            expect(next).not.toBeNull();
            expect(next!.name).toBe('High Priority');
        });

        test('same priority ordered by creation time (FIFO)', async () => {
            const first = await TaskService.add({
                name: 'First',
                agent: 'agent-a',
                prompt: 'one',
                importance: 3,
                urgency: 3,
            });
            await TaskService.add({
                name: 'Second',
                agent: 'agent-a',
                prompt: 'two',
                importance: 3,
                urgency: 3,
            });

            const next = await TaskService.next();
            expect(next!.id).toBe(first.id);
        });

        test('return null when no pending tasks', async () => {
            const next = await TaskService.next();
            expect(next).toBeNull();
        });

        test('skip running/done/cancelled tasks', async () => {
            const t1 = await TaskService.add({ name: 'T1', agent: 'a', prompt: 'p' });
            await TaskService.start(t1.id);

            const t2 = await TaskService.add({ name: 'T2', agent: 'a', prompt: 'p' });
            await TaskService.start(t2.id);
            await TaskService.done(t2.id);

            const t3 = await TaskService.add({ name: 'T3', agent: 'a', prompt: 'p' });
            await TaskService.cancel(t3.id);

            const next = await TaskService.next();
            expect(next).toBeNull();
        });

        test('filter by cwd', async () => {
            await TaskService.add({
                name: 'Project A',
                agent: 'a',
                prompt: 'p',
                cwd: '/project-a',
            });
            const t2 = await TaskService.add({
                name: 'Project B',
                agent: 'a',
                prompt: 'p',
                cwd: '/project-b',
            });

            const next = await TaskService.next({ cwd: '/project-b' });
            expect(next).not.toBeNull();
            expect(next!.id).toBe(t2.id);
        });

        test('exclude specific batchId', async () => {
            await TaskService.add({
                name: 'Batch Task',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-1',
            });
            const t2 = await TaskService.add({
                name: 'Independent Task',
                agent: 'a',
                prompt: 'p',
            });

            const next = await TaskService.next({ excludedBatchIds: ['batch-1'] });
            expect(next).not.toBeNull();
            expect(next!.id).toBe(t2.id);
        });

        test('do not return failed task when retryAfter has not expired', async () => {
            const task = await TaskService.add({
                name: 'Delayed Retry Task',
                agent: 'a',
                prompt: 'p',
            });
            await TaskService.start(task.id);
            await TaskService.fail(task.id, 'failed', {}, { retryAfterMs: Date.now() + 3600000 });

            const next = await TaskService.next();
            expect(next).toBeNull();
        });

        test('return failed task when retryAfter has expired', async () => {
            const task = await TaskService.add({
                name: 'Expired Retry Task',
                agent: 'a',
                prompt: 'p',
            });
            await TaskService.start(task.id);
            await TaskService.fail(task.id, 'failed', {}, { retryAfterMs: Date.now() - 1000 });

            const next = await TaskService.next();
            expect(next).not.toBeNull();
            expect(next!.id).toBe(task.id);
        });

        test('return task without dependency, skip dependent when dependsOn incomplete', async () => {
            const dep = await TaskService.add({
                name: 'Prerequisite Task',
                agent: 'a',
                prompt: 'p',
            });
            await TaskService.add({
                name: 'Dependent Task',
                agent: 'a',
                prompt: 'p',
                dependsOn: dep.id,
            });

            const next = await TaskService.next();
            expect(next).not.toBeNull();
            expect(next!.id).toBe(dep.id);
        });

        test('return dependent task after dependsOn completes', async () => {
            const dep = await TaskService.add({
                name: 'Prerequisite Task',
                agent: 'a',
                prompt: 'p',
            });
            const dependent = await TaskService.add({
                name: 'Dependent Task',
                agent: 'a',
                prompt: 'p',
                dependsOn: dep.id,
            });

            await TaskService.start(dep.id);
            await TaskService.done(dep.id);

            const next = await TaskService.next();
            expect(next).not.toBeNull();
            expect(next!.id).toBe(dependent.id);
        });

        test('do not return failed task when retryCount >= maxRetries (dead_letter)', async () => {
            const task = await TaskService.add({
                name: 'Final Failure Task',
                agent: 'a',
                prompt: 'p',
                maxRetries: 1,
            });
            await TaskService.start(task.id);
            await TaskService.fail(task.id, 'failed');

            expect(task.maxRetries).toBe(1);
            const next = await TaskService.next();
            expect(next).toBeNull();
        });
    });

    describe('start', () => {
        test('mark pending task as running', async () => {
            const task = await TaskService.add({
                name: 'Start Test',
                agent: 'a',
                prompt: 'p',
            });
            const started = await TaskService.start(task.id);
            expect(started).not.toBeNull();
            expect(started!.status).toBe('running');
            expect(started!.startedAt).not.toBeNull();
        });

        test('cannot start a done task', async () => {
            const task = await TaskService.add({ name: 'T', agent: 'a', prompt: 'p' });
            await TaskService.start(task.id);
            await TaskService.done(task.id);

            const result = await TaskService.start(task.id);
            expect(result).toBeNull();
        });

        test('cannot start a cancelled task', async () => {
            const task = await TaskService.add({ name: 'T', agent: 'a', prompt: 'p' });
            await TaskService.cancel(task.id);

            const result = await TaskService.start(task.id);
            expect(result).toBeNull();
        });

        test('can start failed task without exceeding retry limit', async () => {
            const task = await TaskService.add({
                name: 'T',
                agent: 'a',
                prompt: 'p',
                maxRetries: 3,
            });
            await TaskService.start(task.id);
            await TaskService.fail(task.id, 'first failure');

            const restarted = await TaskService.start(task.id);
            expect(restarted).not.toBeNull();
            expect(restarted!.status).toBe('running');
        });
    });

    describe('done', () => {
        test('mark task as done with log', async () => {
            const task = await TaskService.add({ name: 'T', agent: 'a', prompt: 'p' });
            await TaskService.start(task.id);
            const finished = await TaskService.done(task.id, 'execution complete');
            expect(finished).not.toBeNull();
            expect(finished!.status).toBe('done');
            expect(finished!.finishedAt).not.toBeNull();
            expect(finished!.resultLog).toBe('execution complete');
        });

        test('clear retryAfter after done', async () => {
            const task = await TaskService.add({ name: 'T', agent: 'a', prompt: 'p' });
            await TaskService.start(task.id);
            await TaskService.fail(task.id, 'failed', {}, { retryAfterMs: Date.now() + 60000 });

            await TaskService.retry(task.id);
            await TaskService.start(task.id);
            const finished = await TaskService.done(task.id);
            expect(finished!.retryAfter).toBeNull();
        });
    });

    describe('fail', () => {
        test('first failure → status=failed, retryCount=1', async () => {
            const task = await TaskService.add({
                name: 'T',
                agent: 'a',
                prompt: 'p',
                maxRetries: 3,
            });
            await TaskService.start(task.id);
            const failed = await TaskService.fail(task.id, 'first failure');
            expect(failed).not.toBeNull();
            expect(failed!.status).toBe('failed');
            expect(failed!.retryCount).toBe(1);
            expect(failed!.retryAfter).not.toBeNull();
        });

        test('reaching max retries → dead_letter', async () => {
            const task = await TaskService.add({
                name: 'T',
                agent: 'a',
                prompt: 'p',
                maxRetries: 1,
            });
            await TaskService.start(task.id);
            const failed = await TaskService.fail(task.id, 'final failure');
            expect(failed!.status).toBe('dead_letter');
            expect(failed!.retryAfter).toBeNull();
        });

        test('force setDeadLetter=true', async () => {
            const task = await TaskService.add({
                name: 'T',
                agent: 'a',
                prompt: 'p',
                maxRetries: 10,
            });
            await TaskService.start(task.id);
            const failed = await TaskService.fail(task.id, 'force dead letter', {}, { setDeadLetter: true });
            expect(failed!.status).toBe('dead_letter');
        });

        test('custom retryAfterMs', async () => {
            const task = await TaskService.add({
                name: 'T',
                agent: 'a',
                prompt: 'p',
                maxRetries: 3,
            });
            await TaskService.start(task.id);
            const customRetry = Date.now() + 120000;
            const failed = await TaskService.fail(task.id, 'custom delay', {}, { retryAfterMs: customRetry });
            expect(failed!.retryAfter).toBe(customRetry);
        });

        test('return null for non-existent task', async () => {
            const result = await TaskService.fail(99999, 'non-existent');
            expect(result).toBeNull();
        });
    });

    describe('cancel', () => {
        test('cancel pending task', async () => {
            const task = await TaskService.add({ name: 'T', agent: 'a', prompt: 'p' });
            const cancelled = await TaskService.cancel(task.id);
            expect(cancelled).not.toBeNull();
            expect(cancelled!.status).toBe('cancelled');
        });

        test('cancel running task', async () => {
            const task = await TaskService.add({ name: 'T', agent: 'a', prompt: 'p' });
            await TaskService.start(task.id);
            const cancelled = await TaskService.cancel(task.id);
            expect(cancelled!.status).toBe('cancelled');
        });

        test('return null for non-existent task cancel', async () => {
            const result = await TaskService.cancel(99999);
            expect(result).toBeNull();
        });
    });

    describe('retry', () => {
        test('retry failed task', async () => {
            const task = await TaskService.add({
                name: 'T',
                agent: 'a',
                prompt: 'p',
                maxRetries: 3,
            });
            await TaskService.start(task.id);
            await TaskService.fail(task.id, 'failed');

            const retried = await TaskService.retry(task.id);
            expect(retried).not.toBeNull();
            expect(retried!.status).toBe('pending');
            expect(retried!.startedAt).toBeNull();
            expect(retried!.finishedAt).toBeNull();
            expect(retried!.retryAfter).toBeNull();
        });

        test('retry dead_letter task', async () => {
            const task = await TaskService.add({
                name: 'T',
                agent: 'a',
                prompt: 'p',
                maxRetries: 1,
            });
            await TaskService.start(task.id);
            await TaskService.fail(task.id, 'final failure');

            const retried = await TaskService.retry(task.id);
            expect(retried).not.toBeNull();
            expect(retried!.status).toBe('pending');
        });

        test('cannot retry pending/running/done tasks', async () => {
            const task = await TaskService.add({ name: 'T', agent: 'a', prompt: 'p' });

            const r1 = await TaskService.retry(task.id);
            expect(r1).toBeNull();

            await TaskService.start(task.id);
            const r2 = await TaskService.retry(task.id);
            expect(r2).toBeNull();

            await TaskService.done(task.id);
            const r3 = await TaskService.retry(task.id);
            expect(r3).toBeNull();
        });
    });

    describe('retryBatch', () => {
        test('batch retry failed tasks in same batch', async () => {
            const t1 = await TaskService.add({
                name: 'T1',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-x',
                maxRetries: 3,
            });
            const t2 = await TaskService.add({
                name: 'T2',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-x',
                maxRetries: 3,
            });

            await TaskService.start(t1.id);
            await TaskService.fail(t1.id, 'failed');
            await TaskService.start(t2.id);
            await TaskService.fail(t2.id, 'failed');

            const count = await TaskService.retryBatch('batch-x');
            expect(count).toBe(2);

            const r1 = await TaskService.getById(t1.id);
            const r2 = await TaskService.getById(t2.id);
            expect(r1!.status).toBe('pending');
            expect(r2!.status).toBe('pending');
        });

        test('does not affect other batch tasks', async () => {
            const t1 = await TaskService.add({
                name: 'T1',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-a',
                maxRetries: 3,
            });
            const t2 = await TaskService.add({
                name: 'T2',
                agent: 'a',
                prompt: 'p',
                batchId: 'batch-b',
                maxRetries: 3,
            });

            await TaskService.start(t1.id);
            await TaskService.fail(t1.id, 'failed');
            await TaskService.start(t2.id);
            await TaskService.fail(t2.id, 'failed');

            await TaskService.retryBatch('batch-a');
            const r2 = await TaskService.getById(t2.id);
            expect(r2!.status).toBe('failed');
        });

        test('empty batch returns 0', async () => {
            const count = await TaskService.retryBatch('nonexistent-batch');
            expect(count).toBe(0);
        });
    });

    describe('list', () => {
        test('list all tasks', async () => {
            await TaskService.add({ name: 'T1', agent: 'a', prompt: 'p' });
            await TaskService.add({ name: 'T2', agent: 'a', prompt: 'p' });
            const tasks = await TaskService.list();
            expect(tasks.length).toBe(2);
        });

        test('filter by status', async () => {
            const t1 = await TaskService.add({ name: 'T1', agent: 'a', prompt: 'p' });
            await TaskService.start(t1.id);
            await TaskService.done(t1.id);
            await TaskService.add({ name: 'T2', agent: 'a', prompt: 'p' });

            const doneTasks = await TaskService.list({ status: 'done' });
            expect(doneTasks.length).toBe(1);
            expect(doneTasks[0].status).toBe('done');
        });

        test('filter by batchId', async () => {
            await TaskService.add({ name: 'T1', agent: 'a', prompt: 'p', batchId: 'b1' });
            await TaskService.add({ name: 'T2', agent: 'a', prompt: 'p', batchId: 'b2' });

            const tasks = await TaskService.list({ batchId: 'b1' });
            expect(tasks.length).toBe(1);
        });

        test('filter by category', async () => {
            await TaskService.add({ name: 'T1', agent: 'a', prompt: 'p', category: 'translate' });
            await TaskService.add({ name: 'T2', agent: 'a', prompt: 'p', category: 'generate' });

            const tasks = await TaskService.list({ category: 'translate' });
            expect(tasks.length).toBe(1);
        });

        test('pagination limit + offset', async () => {
            for (let i = 0; i < 5; i++) {
                await TaskService.add({ name: `T${i}`, agent: 'a', prompt: 'p' });
            }
            const page1 = await TaskService.list({ limit: 2 });
            const page2 = await TaskService.list({ limit: 2, offset: 2 });
            expect(page1.length).toBe(2);
            expect(page2.length).toBe(2);
            expect(page1[0].id).not.toBe(page2[0].id);
        });

        test('order by ID descending (newest first)', async () => {
            await TaskService.add({ name: 'T1', agent: 'a', prompt: 'p' });
            await TaskService.add({ name: 'T2', agent: 'a', prompt: 'p' });
            const tasks = await TaskService.list();
            expect(tasks.length).toBe(2);
            expect(tasks[0].id).toBeGreaterThan(tasks[1].id as number);
        });
    });

    describe('stats', () => {
        test('count by status', async () => {
            const t1 = await TaskService.add({ name: 'T1', agent: 'a', prompt: 'p' });
            const t2 = await TaskService.add({ name: 'T2', agent: 'a', prompt: 'p' });
            await TaskService.add({ name: 'T3', agent: 'a', prompt: 'p' });

            await TaskService.start(t1.id);
            await TaskService.done(t1.id);

            await TaskService.start(t2.id);
            await TaskService.fail(t2.id, 'failed', {}, { setDeadLetter: true });

            const stats = await TaskService.stats();
            expect(stats.total).toBe(3);
            expect(stats.done).toBe(1);
            expect(stats.dead_letter).toBe(1);
            expect(stats.pending).toBe(1);
        });

        test('empty database returns all zeros', async () => {
            const stats = await TaskService.stats();
            expect(stats.total).toBe(0);
            expect(stats.pending).toBe(0);
            expect(stats.running).toBe(0);
            expect(stats.done).toBe(0);
            expect(stats.failed).toBe(0);
            expect(stats.dead_letter).toBe(0);
            expect(stats.cancelled).toBe(0);
        });
    });

    describe('delete', () => {
        test('delete existing task', async () => {
            const task = await TaskService.add({ name: 'T', agent: 'a', prompt: 'p' });
            const result = await TaskService.delete(task.id);
            expect(result).toBe(true);

            const found = await TaskService.getById(task.id);
            expect(found).toBeNull();
        });

        test('delete non-existent task returns false', async () => {
            const result = await TaskService.delete(99999);
            expect(result).toBe(false);
        });
    });

    describe('markPendingForRetry', () => {
        test('mark task as pending with retryAfter', async () => {
            const task = await TaskService.add({
                name: 'T',
                agent: 'a',
                prompt: 'p',
                maxRetries: 3,
            });
            await TaskService.start(task.id);
            await TaskService.fail(task.id, 'failed');

            const retryAfter = Date.now() + 60000;
            const updated = await TaskService.markPendingForRetry(task.id, retryAfter, 2);
            expect(updated).not.toBeNull();
            expect(updated!.status).toBe('pending');
            expect(updated!.retryAfter).toBe(retryAfter);
            expect(updated!.retryCount).toBe(2);
            expect(updated!.startedAt).toBeNull();
            expect(updated!.finishedAt).toBeNull();
        });
    });

    describe('markDeadLetter', () => {
        test('mark task as dead_letter', async () => {
            const task = await TaskService.add({ name: 'T', agent: 'a', prompt: 'p' });
            await TaskService.start(task.id);

            const updated = await TaskService.markDeadLetter(task.id, 5);
            expect(updated).not.toBeNull();
            expect(updated!.status).toBe('dead_letter');
            expect(updated!.retryCount).toBe(5);
            expect(updated!.finishedAt).not.toBeNull();
        });
    });

    describe('batchId propagation chain', () => {
        test('batchId passed to add is returned by getById', async () => {
            const task = await TaskService.add({
                name: 'Document Translation Batch',
                agent: 'translator',
                prompt: 'Translate technical documentation',
                batchId: 'translate-batch-001',
            });

            const found = await TaskService.getById(task.id);
            expect(found).not.toBeNull();
            expect(found!.batchId).toBe('translate-batch-001');
        });

        test('batchId defaults to null when not provided to add', async () => {
            const task = await TaskService.add({
                name: 'Independent Review Task',
                agent: 'reviewer',
                prompt: 'Review code quality',
            });

            const found = await TaskService.getById(task.id);
            expect(found).not.toBeNull();
            expect(found!.batchId).toBeNull();
        });

        test('next correctly filters by batchId when excluding active batches', async () => {
            await TaskService.add({
                name: 'Batch A Task 1',
                agent: 'a',
                prompt: 'process data',
                batchId: 'batch-a',
            });
            await TaskService.add({
                name: 'Batch A Task 2',
                agent: 'a',
                prompt: 'clean data',
                batchId: 'batch-a',
            });
            const batchBTask = await TaskService.add({
                name: 'Batch B Task',
                agent: 'a',
                prompt: 'generate report',
                batchId: 'batch-b',
            });

            const next = await TaskService.next({ excludedBatchIds: ['batch-a'] });
            expect(next).not.toBeNull();
            expect(next!.id).toBe(batchBTask.id);
            expect(next!.batchId).toBe('batch-b');
        });

        test('batchId unchanged after start', async () => {
            const task = await TaskService.add({
                name: 'Data Analysis Task',
                agent: 'analyst',
                prompt: 'Analyze user behavior data',
                batchId: 'analytics-batch',
            });

            const started = await TaskService.start(task.id);
            expect(started).not.toBeNull();
            expect(started!.status).toBe('running');
            expect(started!.batchId).toBe('analytics-batch');

            const found = await TaskService.getById(task.id);
            expect(found!.batchId).toBe('analytics-batch');
        });

        test('batchId unchanged after done', async () => {
            const task = await TaskService.add({
                name: 'Image Generation Task',
                agent: 'designer',
                prompt: 'Generate homepage Banner',
                batchId: 'design-batch',
            });

            await TaskService.start(task.id);
            const finished = await TaskService.done(task.id, 'generation complete');
            expect(finished!.batchId).toBe('design-batch');

            const found = await TaskService.getById(task.id);
            expect(found!.batchId).toBe('design-batch');
        });

        test('batchId unchanged after fail', async () => {
            const task = await TaskService.add({
                name: 'Deployment Task',
                agent: 'devops',
                prompt: 'Deploy to staging environment',
                batchId: 'deploy-batch',
                maxRetries: 3,
            });

            await TaskService.start(task.id);
            const failed = await TaskService.fail(task.id, 'deployment timeout');
            expect(failed!.batchId).toBe('deploy-batch');

            const found = await TaskService.getById(task.id);
            expect(found!.batchId).toBe('deploy-batch');
        });

        test('retryCount increases but batchId unchanged after retryBatch', async () => {
            const task = await TaskService.add({
                name: 'Email Send Task',
                agent: 'mailer',
                prompt: 'Send campaign notification email',
                batchId: 'notification-batch',
                maxRetries: 5,
            });

            await TaskService.start(task.id);
            const failed = await TaskService.fail(task.id, 'SMTP connection timeout');
            expect(failed!.retryCount).toBe(1);
            expect(failed!.batchId).toBe('notification-batch');

            await TaskService.retryBatch('notification-batch');

            const found = await TaskService.getById(task.id);
            expect(found!.status).toBe('pending');
            expect(found!.batchId).toBe('notification-batch');
            expect(found!.retryCount).toBe(1);
        });

        test('different batches do not interfere', async () => {
            const t1 = await TaskService.add({
                name: 'Data Processing Task 1',
                agent: 'a',
                prompt: 'Clean order data',
                batchId: 'batch-x',
            });
            const t2 = await TaskService.add({
                name: 'Data Processing Task 2',
                agent: 'a',
                prompt: 'Calculate statistics',
                batchId: 'batch-x',
            });
            await TaskService.start(t1.id);
            await TaskService.done(t1.id);
            await TaskService.start(t2.id);
            await TaskService.done(t2.id);
            await TaskService.add({
                name: 'Data Processing Task 3',
                agent: 'a',
                prompt: 'Generate visualization report',
                batchId: 'batch-x',
            });

            const t4 = await TaskService.add({
                name: 'Log Analysis Task',
                agent: 'a',
                prompt: 'Analyze server error logs',
                batchId: 'batch-y',
                maxRetries: 3,
            });
            await TaskService.start(t4.id);
            await TaskService.fail(t4.id, 'log file not found');

            const statsX = await TaskService.stats({ batchId: 'batch-x' });
            expect(statsX.total).toBe(3);
            expect(statsX.done).toBe(2);
            expect(statsX.pending).toBe(1);
            expect(statsX.failed).toBe(0);

            const listY = await TaskService.list({ batchId: 'batch-y' });
            expect(listY.length).toBe(1);
            expect(listY[0].batchId).toBe('batch-y');
            expect(listY[0].status).toBe('failed');
        });
    });

    describe('resetRunningToPending', () => {
        test('batch reset running tasks to pending', async () => {
            const t1 = await TaskService.add({ name: 'T1', agent: 'a', prompt: 'p' });
            const t2 = await TaskService.add({ name: 'T2', agent: 'a', prompt: 'p' });
            await TaskService.start(t1.id);
            await TaskService.start(t2.id);

            const count = await TaskService.resetRunningToPending([t1.id, t2.id]);
            expect(count).toBe(2);

            const r1 = await TaskService.getById(t1.id);
            const r2 = await TaskService.getById(t2.id);
            expect(r1!.status).toBe('pending');
            expect(r2!.status).toBe('pending');
        });

        test('do not reset non-running tasks', async () => {
            const t1 = await TaskService.add({ name: 'T1', agent: 'a', prompt: 'p' });
            const count = await TaskService.resetRunningToPending([t1.id]);
            expect(count).toBe(0);
        });

        test('empty array returns 0', async () => {
            const count = await TaskService.resetRunningToPending([]);
            expect(count).toBe(0);
        });
    });
});
