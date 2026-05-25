import { glob } from 'glob';
import { existsSync } from 'fs';
import { join, basename, relative } from 'path';
import { TaskService } from '@core/services/task.service';
import { closeDb } from '@core/db';

// config
const LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'de', name: 'German' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ru', name: 'Russian' },
    { code: 'zh-tw', name: 'Traditional Chinese' }
];

// project root
const PROJECT_ROOT = '/Users/javazys/code/opencodedocs';
const ZH_DOCS_ROOT = join(PROJECT_ROOT, 'site/docs/zh');

async function main() {
    console.log(`🔍 Scanning Chinese docs: ${ZH_DOCS_ROOT} `);

    // 1. fetch existing task names for deduplication
    console.log('📊 Fetching existing task list...');
    const allTasks = await TaskService.list({ limit: 10000 });
    const existTaskNames = new Set(allTasks.map(t => t.name));
    console.log(`✅ ${existTaskNames.size} existing tasks found`);

    // 2. scan all .md files
    const files = await glob('**/*.md', { cwd: ZH_DOCS_ROOT });
    console.log(`📄 Found ${files.length} Chinese documents`);

    let taskCount = 0;
    const BATCH_ID = `translate - batch - ${Date.now()} `;

    for (const file of files) {
        const sourcePath = join('site/docs/zh', file);

        for (const lang of LANGUAGES) {
            let targetPath;
            if (lang.code === 'en') {
                targetPath = join('site/docs', file);
            } else {
                targetPath = join('site/docs', lang.code, file);
            }

            const targetAbsPath = join(PROJECT_ROOT, targetPath);

            // check if target file exists
            if (existsSync(targetAbsPath)) {
                continue;
            }

            // check if task already exists
            const taskName = `Translate ${file} to ${lang.name}`;
            if (existTaskNames.has(taskName)) {
                continue;
            }

            console.log(`🆕[${lang.code}] Creating task: ${taskName} `);

            const prompt = `Please translate the Chinese tutorial page to ${lang.name}:

Source file: ${sourcePath}
Target language: ${lang.code} (${lang.name})

Requirements:
1. Preserve Markdown formatting and Front Matter structure
2. Accurately translate content, maintain technical term consistency
3. ${lang.name} output directory: ${targetPath}
4. If the target directory does not exist, create it first`;

            // create task directly via Service
            await TaskService.add({
                name: taskName,
                agent: 'localize-gen',
                model: 'zhipuai-coding-plan/glm-4.7',
                prompt: prompt,
                category: 'translation',
                importance: 3,
                urgency: 3,
                batchId: BATCH_ID,
                cwd: PROJECT_ROOT,
                status: 'pending'
            });

            taskCount++;
        }
    }

    console.log(`\n\n🎉 Scan complete!`);
    console.log(`📦 Batch ID: ${BATCH_ID} `);
    console.log(`➕ New tasks: ${taskCount}`);

    closeDb();
}

main().catch(console.error);
