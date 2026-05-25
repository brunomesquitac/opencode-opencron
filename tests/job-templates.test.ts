import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb } from './helpers/mock-db';
import { cloneTaskFromTemplate, getDueTemplates, initializeNextRunAt } from '../src/gateway/scheduler/job-templates';
import { TaskTemplateService } from '../src/core/services/task-template.service';
import { TaskService } from '../src/core/services/task.service';

describe('job-templates', () => {
    beforeEach(() => {
        setupTestDb();
    });

    describe('cloneTaskFromTemplate', () => {
        test('clone task from template', async () => {
            const tmpl = await TaskTemplateService.create({
                name: 'Daily Report',
                agent: 'reporter',
                prompt: 'Generate daily report',
                scheduleType: 'recurring',
                intervalMs: 86400000,
            });

            const task = await cloneTaskFromTemplate(tmpl.id);
            expect(task).not.toBeNull();
            expect(task!.name).toBe('Daily Report');
            expect(task!.agent).toBe('reporter');
            expect(task!.templateId).toBe(tmpl.id);
            expect(task!.status).toBe('pending');
        });

        test('non-existent template returns null', async () => {
            const result = await cloneTaskFromTemplate(99999);
            expect(result).toBeNull();
        });

        test('maxInstances limits concurrent instances', async () => {
            const tmpl = await TaskTemplateService.create({
                name: 'Limited Template',
                agent: 'a',
                prompt: 'p',
                scheduleType: 'recurring',
                intervalMs: 3600000,
                maxInstances: 1,
            });

            const task1 = await cloneTaskFromTemplate(tmpl.id);
            expect(task1).not.toBeNull();

            const task2 = await cloneTaskFromTemplate(tmpl.id);
            expect(task2).toBeNull();
        });

        test('clone allowed again when template completes', async () => {
            const tmpl = await TaskTemplateService.create({
                name: 'Repeatable Template',
                agent: 'a',
                prompt: 'p',
                scheduleType: 'recurring',
                intervalMs: 3600000,
                maxInstances: 1,
            });

            const task1 = await cloneTaskFromTemplate(tmpl.id);
            expect(task1).not.toBeNull();

            await TaskService.start(task1!.id);
            await TaskService.done(task1!.id);

            const task2 = await cloneTaskFromTemplate(tmpl.id);
            expect(task2).not.toBeNull();
        });

        test('update template lastRunAt and nextRunAt', async () => {
            const before = Date.now();
            const tmpl = await TaskTemplateService.create({
                name: 'Update Check',
                agent: 'a',
                prompt: 'p',
                scheduleType: 'recurring',
                intervalMs: 3600000,
            });

            await cloneTaskFromTemplate(tmpl.id);

            const updated = await TaskTemplateService.getById(tmpl.id);
            expect(updated!.lastRunAt!).toBeGreaterThanOrEqual(before);
            expect(updated!.nextRunAt).not.toBeNull();
        });
    });

    describe('getDueTemplates', () => {
        test('return due enabled templates', async () => {
            await TaskTemplateService.create({
                name: 'Due Template',
                agent: 'a',
                prompt: 'p',
                scheduleType: 'delayed',
                runAt: Date.now() - 1000,
            });

            const due = await getDueTemplates();
            expect(due.length).toBe(1);
        });

        test('do not return non-due templates', async () => {
            await TaskTemplateService.create({
                name: 'Non-due Template',
                agent: 'a',
                prompt: 'p',
                scheduleType: 'delayed',
                runAt: Date.now() + 3600000,
            });

            const due = await getDueTemplates();
            expect(due.length).toBe(0);
        });

        test('do not return disabled templates', async () => {
            const tmpl = await TaskTemplateService.create({
                name: 'Disabled Template',
                agent: 'a',
                prompt: 'p',
                scheduleType: 'delayed',
                runAt: Date.now() - 1000,
            });
            await TaskTemplateService.disable(tmpl.id);

            const due = await getDueTemplates();
            expect(due.length).toBe(0);
        });
    });

    describe('initializeNextRunAt', () => {
        test('initialize templates with null nextRunAt', async () => {
            const tmpl = await TaskTemplateService.create({
                name: 'Init Test',
                agent: 'a',
                prompt: 'p',
                scheduleType: 'recurring',
                intervalMs: 3600000,
            });

            expect(tmpl.nextRunAt).not.toBeNull();
        });
    });
});
