# scripts/ directory docs

> [Input]: File system scanning, TaskService
> [Output]: Batch operation scripts
> [Purpose]: One-off utility scripts for batch task management

## Files

| File | Purpose |
|------|---------|
| `batch-translate.ts` | Scan Chinese Markdown, create translation tasks for 9 target languages (en/ja/ko/de/es/fr/pt/ru/zh-tw), Agent is `localize-gen`, model is `zhipuai-coding-plan/glm-4.7` |
| `reset-status.ts` | Batch reset running/failed → pending, for cleanup after Worker abnormal exit |
