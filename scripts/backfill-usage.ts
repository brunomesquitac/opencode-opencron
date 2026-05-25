import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';

const dbPath = process.env.OPENCRON_DB_PATH || join(homedir(), '.local/share/opencode/opencron.db');
const db = new Database(dbPath);

const rows = db.query(`
    SELECT id, messages_json FROM task_runs
    WHERE messages_json IS NOT NULL AND total_tokens IS NULL
`).all() as { id: number; messages_json: string }[];

console.log(`Found ${rows.length} runs to backfill...`);

let updated = 0;
for (const row of rows) {
    try {
        const messages = JSON.parse(row.messages_json) as any[];
        let inputTokens = 0, outputTokens = 0, totalTokens = 0, costUsd = 0;

        for (const msg of messages) {
            if (msg.info?.role === 'assistant') {
                const t = msg.info.tokens;
                if (t) {
                    inputTokens += Number(t.input ?? 0);
                    outputTokens += Number(t.output ?? 0);
                    totalTokens += Number(t.total ?? 0);
                }
                if (typeof msg.info.cost === 'number') {
                    costUsd += msg.info.cost;
                }
            }
        }

        if (totalTokens > 0 || costUsd > 0) {
            db.query(`
                UPDATE task_runs SET input_tokens = ?, output_tokens = ?, total_tokens = ?, cost_usd = ?
                WHERE id = ?
            `).run(inputTokens, outputTokens, totalTokens, costUsd, row.id);
            updated++;
        }

        if (updated % 10 === 0) {
            console.log(`  ${updated}/${rows.length} updated...`);
        }
    } catch (err) {
        console.error(`  Error processing run #${row.id}:`, err);
    }
}

console.log(`Done. ${updated} runs updated with token/cost data.`);
