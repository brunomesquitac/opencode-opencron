PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_task_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`agent` text NOT NULL,
	`model` text DEFAULT 'default',
	`prompt` text NOT NULL,
	`cwd` text,
	`category` text DEFAULT 'general',
	`importance` integer DEFAULT 3,
	`urgency` integer DEFAULT 3,
	`schedule_type` text NOT NULL,
	`cron_expr` text,
	`interval_ms` integer,
	`run_at` integer,
	`max_instances` integer DEFAULT 1,
	`max_retries` integer DEFAULT 3,
	`retry_backoff_ms` integer DEFAULT 30000,
	`last_run_at` integer,
	`next_run_at` integer,
	`enabled` integer DEFAULT true,
	`created_at` integer DEFAULT 0,
	`updated_at` integer DEFAULT 0
);
--> statement-breakpoint
INSERT INTO `__new_task_templates`("id", "name", "agent", "model", "prompt", "cwd", "category", "importance", "urgency", "schedule_type", "cron_expr", "interval_ms", "run_at", "max_instances", "max_retries", "retry_backoff_ms", "last_run_at", "next_run_at", "enabled", "created_at", "updated_at") SELECT "id", "name", "agent", "model", "prompt", "cwd", "category", "importance", "urgency", "schedule_type", "cron_expr", "interval_ms", "run_at", "max_instances", "max_retries", "retry_backoff_ms", "last_run_at", "next_run_at", "enabled", "created_at", "updated_at" FROM `task_templates`;--> statement-breakpoint
DROP TABLE `task_templates`;--> statement-breakpoint
ALTER TABLE `__new_task_templates` RENAME TO `task_templates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `task_runs` ADD `messages_json` text;