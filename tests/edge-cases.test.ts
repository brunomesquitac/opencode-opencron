import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb } from './helpers/mock-db';
import { TaskService } from '../src/core/services/task.service';
import { TaskRunService } from '../src/core/services/task-run.service';
import { TaskTemplateService } from '../src/core/services/task-template.service';

describe('edge case tests', () => {
    beforeEach(() => {
        setupTestDb();
    });

    describe('TaskService edge cases', () => {
        test('done a task without starting it (direct done)', async () => {
            const task = await TaskService.add({ name: 'T', agent: 'a', prompt: 'p' });
            const result = await TaskService.done(task.id);
            expect(result).not.toBeNull();
            expect(result!.status).toBe('done');
        });

        test('cancel a done task', async () => {
            const task = await TaskService.add({ name: 'T', agent: 'a', prompt: 'p' });
            await TaskService.start(task.id);
            await TaskService.done(task.id);
            const cancelled = await TaskService.cancel(task.id);
            expect(cancelled).not.toBeNull();
            expect(cancelled!.status).toBe('cancelled');
        });

        test('retry cancelled task returns null', async () => {
            const task = await TaskService.add({ name: 'T', agent: 'a', prompt: 'p' });
            await TaskService.cancel(task.id);
            const result = await TaskService.retry(task.id);
            expect(result).toBeNull();
        });

        test('same task fails multiple times until dead_letter', async () => {
            const task = await TaskService.add({
                name: 'T',
                agent: 'a',
                prompt: 'p',
                maxRetries: 3,
            });

            for (let i = 1; i <= 3; i++) {
                await TaskService.start(task.id);
                await TaskService.fail(task.id, `failure #${i}`);
            }

            const updated = await TaskService.getById(task.id);
            expect(updated!.status).toBe('dead_letter');
            expect(updated!.retryCount).toBe(3);
        });

        test('deleteOlderThan only deletes terminal tasks', async () => {
            const t1 = await TaskService.add({ name: 'Done', agent: 'a', prompt: 'p' });
            await TaskService.start(t1.id);
            await TaskService.done(t1.id);

            const t2 = await TaskService.add({ name: 'Pending', agent: 'a', prompt: 'p' });

            const count = await TaskService.deleteOlderThan(-1);
            expect(count).toBe(1);

            const found = await TaskService.getById(t2.id);
            expect(found).not.toBeNull();
        });

        test('stats filter by batchId', async () => {
            await TaskService.add({ name: 'T1', agent: 'a', prompt: 'p', batchId: 'b1' });
            await TaskService.add({ name: 'T2', agent: 'a', prompt: 'p', batchId: 'b2' });

            const stats = await TaskService.stats({ batchId: 'b1' });
            expect(stats.total).toBe(1);
        });

        test('stats filter by cwd', async () => {
            await TaskService.add({ name: 'T1', agent: 'a', prompt: 'p', cwd: '/dir1' });
            await TaskService.add({ name: 'T2', agent: 'a', prompt: 'p', cwd: '/dir2' });

            const stats = await TaskService.stats({ cwd: '/dir1' });
            expect(stats.total).toBe(1);
        });

        test('next prioritizes high urgency over high importance', async () => {
            await TaskService.add({
                name: 'High importance Low urgency',
                agent: 'a',
                prompt: 'p',
                importance: 5,
                urgency: 1,
            });
            const t2 = await TaskService.add({
                name: 'Low importance High urgency',
                agent: 'a',
                prompt: 'p',
                importance: 1,
                urgency: 5,
            });

            const next = await TaskService.next();
            expect(next!.id).toBe(t2.id);
        });

        test('next handles dependsOn pointing to non-existent task', async () => {
            await TaskService.add({
                name: 'Dangling Dependency',
                agent: 'a',
                prompt: 'p',
                dependsOn: 99999,
            });

            const next = await TaskService.next();
            expect(next).toBeNull();
        });
    });

    describe('TaskRunService edge cases', () => {
        test('multiple parallel runs for same task', async () => {
            const task = await TaskService.add({ name: 'T', agent: 'a', prompt: 'p' });
            const r1 = await TaskRunService.create({ taskId: task.id, status: 'running' });
            const r2 = await TaskRunService.create({ taskId: task.id, status: 'running' });

            const runningRuns = await TaskRunService.getAllRunningRuns();
            expect(runningRuns.length).toBe(2);
            expect(runningRuns.map((r) => r.id)).toContain(r1.id);
            expect(runningRuns.map((r) => r.id)).toContain(r2.id);
        });

        test('getStaleRuns returns correct retry info', async () => {
            const task = await TaskService.add({ name: 'T', agent: 'a', prompt: 'p', maxRetries: 5 });
            await TaskService.start(task.id);
            await TaskRunService.create({ taskId: task.id, status: 'running' });

            const stale = await TaskRunService.getStaleRuns(-100000);
            expect(stale.length).toBe(1);
            expect(stale[0].taskRetryCount).toBe(0);
            expect(stale[0].taskMaxRetries).toBe(5);
        });
    });

    describe('TaskTemplateService edge cases', () => {
        test('create cron template auto-calculates nextRunAt', async () => {
            const tmpl = await TaskTemplateService.create({
                name: 'Cron Template',
                agent: 'a',
                prompt: 'p',
                scheduleType: 'cron',
                cronExpr: '0 9 * * *',
            });
            expect(tmpl.nextRunAt).not.toBeNull();
            expect(tmpl.nextRunAt!).toBeGreaterThan(Date.now() - 1000);
        });

        test('create recurring template auto-calculates nextRunAt', async () => {
            const tmpl = await TaskTemplateService.create({
                name: 'Recurring Template',
                agent: 'a',
                prompt: 'p',
                scheduleType: 'recurring',
                intervalMs: 3600000,
            });
            expect(tmpl.nextRunAt).not.toBeNull();
        });

        test('create delayed template uses specified runAt', async () => {
            const runAt = Date.now() + 86400000;
            const tmpl = await TaskTemplateService.create({
                name: 'Delayed Template',
                agent: 'a',
                prompt: 'p',
                scheduleType: 'delayed',
                runAt,
            });
            expect(tmpl.nextRunAt).toBe(runAt);
        });

        test('delete non-existent template returns false', async () => {
            const result = await TaskTemplateService.delete(99999);
            expect(result).toBe(false);
        });

        test('enable/disable non-existent template returns null', async () => {
            expect(await TaskTemplateService.enable(99999)).toBeNull();
            expect(await TaskTemplateService.disable(99999)).toBeNull();
        });

        test('getById non-existent returns null', async () => {
            expect(await TaskTemplateService.getById(99999)).toBeNull();
        });

        test('calculateNextRunAt invalid cron returns null', () => {
            const result = TaskTemplateService.calculateNextRunAt('cron', {
                cronExpr: 'invalid-cron',
                intervalMs: null,
                runAt: null,
            });
            expect(result).toBeNull();
        });

        test('calculateNextRunAt recurring without intervalMs returns null', () => {
            const result = TaskTemplateService.calculateNextRunAt('recurring', {
                cronExpr: null,
                intervalMs: null,
                runAt: null,
            });
            expect(result).toBeNull();
        });

        test('calculateNextRunAt delayed without runAt returns null', () => {
            const result = TaskTemplateService.calculateNextRunAt('delayed', {
                cronExpr: null,
                intervalMs: null,
                runAt: null,
            });
            expect(result).toBeNull();
        });

        test('calculateNextRunAt unknown type returns null', () => {
            const result = TaskTemplateService.calculateNextRunAt('unknown' as never, {
                cronExpr: null,
                intervalMs: null,
                runAt: null,
            });
            expect(result).toBeNull();
        });
    });

    describe('full task flow integration', () => {
        test('template → clone → execute → complete', async () => {
            const tmpl = await TaskTemplateService.create({
                name: 'Flow Test',
                agent: 'worker',
                prompt: 'execute task',
                scheduleType: 'recurring',
                intervalMs: 3600000,
                maxRetries: 2,
            });

            const { cloneTaskFromTemplate } = await import('../src/gateway/scheduler/job-templates');
            const task = await cloneTaskFromTemplate(tmpl.id);
            expect(task).not.toBeNull();

            await TaskService.start(task!.id);
            const run = await TaskRunService.create({
                taskId: task!.id,
                status: 'running',
                model: 'glm-4',
            });

            await TaskRunService.done(run.id, 'execution successful');
            await TaskService.done(task!.id, 'task complete');

            const final = await TaskService.getById(task!.id);
            expect(final!.status).toBe('done');

            const tmplAfter = await TaskTemplateService.getById(tmpl.id);
            expect(tmplAfter!.lastRunAt).not.toBeNull();
            expect(tmplAfter!.nextRunAt).not.toBeNull();
        });

        test('multi-task priority scheduling', async () => {
            const tasks = [];
            for (let i = 5; i >= 1; i--) {
                tasks.push(await TaskService.add({
                    name: `Priority ${i}`,
                    agent: 'a',
                    prompt: `importance=${i}`,
                    importance: i,
                    urgency: i,
                }));
            }

            const order: number[] = [];
            for (let i = 0; i < 5; i++) {
                const next = await TaskService.next();
                expect(next).not.toBeNull();
                order.push(next!.importance!);
                await TaskService.start(next!.id);
                await TaskService.done(next!.id);
            }

            for (let i = 0; i < order.length - 1; i++) {
                expect(order[i]).toBeGreaterThanOrEqual(order[i + 1]!);
            }
        });

        test('batch tasks execute sequentially', async () => {
            const batchId = 'sequential-batch';
            const t1 = await TaskService.add({
                name: 'Batch Task 1',
                agent: 'a',
                prompt: 'p',
                batchId,
            });
            const t2 = await TaskService.add({
                name: 'Batch Task 2',
                agent: 'a',
                prompt: 'p',
                batchId,
            });

            const next1 = await TaskService.next();
            expect(next1!.id).toBe(t1.id);
            await TaskService.start(t1.id);

            const next2 = await TaskService.next({ excludedBatchIds: [batchId] });
            expect(next2).toBeNull();

            await TaskService.done(t1.id);

            const next3 = await TaskService.next();
            expect(next3!.id).toBe(t2.id);
        });
    });
});
