import { db, closeDb } from '@core/db';
import { tasks } from '@core/db/schema';
import { inArray } from 'drizzle-orm';

async function main() {
    console.log('🔄 Resetting task status (Running/Failed -> Pending)...');

    // SQLite driver: run() returns result with changes count
    const result = await db.update(tasks)
        .set({
            status: 'pending',
            startedAt: null,
            finishedAt: null
        })
        .where(inArray(tasks.status, ['running', 'failed']))
        .run();

    console.log(`✅ Operation complete.`);

    closeDb();
}

main().catch(console.error);
