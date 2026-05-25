import { db, schema } from '@core/db';
import { eq, desc } from 'drizzle-orm';
import type { TaskTemplate, NewTaskTemplate, ScheduleType } from '@core/db/schema';
import { getNextCronRun, isValidCronExpr } from '@core/cron-parser';

const { taskTemplates } = schema;

export class TaskTemplateService {
    static async create(data: NewTaskTemplate): Promise<TaskTemplate> {
        const now = Date.now();
        const result = await db.insert(taskTemplates).values({ ...data, createdAt: now, updatedAt: now }).returning();
        const tmpl = result[0];

        if (tmpl.nextRunAt == null) {
            const nextRunAt = this.calculateNextRunAt(
                tmpl.scheduleType as ScheduleType,
                tmpl,
            );
            if (nextRunAt != null) {
                await db.update(taskTemplates).set({ nextRunAt }).where(eq(taskTemplates.id, tmpl.id));
                tmpl.nextRunAt = nextRunAt;
            }
        }

        return tmpl;
    }

    static async list(limit = 50): Promise<TaskTemplate[]> {
        return await db
            .select()
            .from(taskTemplates)
            .orderBy(desc(taskTemplates.createdAt))
            .limit(limit);
    }

    static async getById(id: number): Promise<TaskTemplate | null> {
        const result = await db.select().from(taskTemplates).where(eq(taskTemplates.id, id));
        return result[0] || null;
    }

    static async enable(id: number): Promise<TaskTemplate | null> {
        const result = await db
            .update(taskTemplates)
            .set({ enabled: true, updatedAt: Date.now() })
            .where(eq(taskTemplates.id, id))
            .returning();
        return result[0] || null;
    }

    static async disable(id: number): Promise<TaskTemplate | null> {
        const result = await db
            .update(taskTemplates)
            .set({ enabled: false, updatedAt: Date.now() })
            .where(eq(taskTemplates.id, id))
            .returning();
        return result[0] || null;
    }

    static async update(id: number, data: Partial<Omit<NewTaskTemplate, 'id' | 'createdAt' | 'lastRunAt' | 'nextRunAt' | 'enabled'>>): Promise<TaskTemplate | null> {
        const current = await this.getById(id);
        if (!current) return null;

        const allowedFields: Record<string, keyof typeof current> = {
            name: 'name',
            agent: 'agent',
            model: 'model',
            prompt: 'prompt',
            cwd: 'cwd',
            category: 'category',
            importance: 'importance',
            urgency: 'urgency',
            maxRetries: 'maxRetries',
            scheduleType: 'scheduleType',
            cronExpr: 'cronExpr',
            intervalMs: 'intervalMs',
            runAt: 'runAt',
            maxInstances: 'maxInstances',
            retryBackoffMs: 'retryBackoffMs',
        };

        const updateData: Record<string, unknown> = { updatedAt: Date.now() };
        for (const [key, field] of Object.entries(allowedFields)) {
            if (data[key as keyof typeof data] !== undefined) {
                updateData[field as string] = data[key as keyof typeof data];
            }
        }

        const result = await db
            .update(taskTemplates)
            .set(updateData as any)
            .where(eq(taskTemplates.id, id))
            .returning();
        const updated = result[0] || null;

        if (updated) {
            const nextRunAt = this.calculateNextRunAt(
                (data.scheduleType ?? current.scheduleType) as ScheduleType,
                { ...current, ...updateData },
            );
            if (nextRunAt != null) {
                await db.update(taskTemplates).set({ nextRunAt }).where(eq(taskTemplates.id, id));
                updated.nextRunAt = nextRunAt;
            }
        }

        return updated;
    }

    static async delete(id: number): Promise<boolean> {
        const result = await db.delete(taskTemplates).where(eq(taskTemplates.id, id)).returning();
        return result.length > 0;
    }

    static calculateNextRunAt(
        scheduleType: ScheduleType,
        template: {
            cronExpr: string | null;
            intervalMs: number | null;
            runAt: number | null;
        },
        afterMs?: number,
    ): number | null {
        const base = afterMs ?? Date.now();

        switch (scheduleType) {
            case 'cron': {
                if (!template.cronExpr || !isValidCronExpr(template.cronExpr)) return null;
                return getNextCronRun(template.cronExpr, base);
            }
            case 'recurring': {
                if (!template.intervalMs) return null;
                return base + template.intervalMs;
            }
            case 'delayed': {
                return template.runAt ?? null;
            }
            default:
                return null;
        }
    }
}
