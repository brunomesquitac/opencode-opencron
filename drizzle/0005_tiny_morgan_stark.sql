ALTER TABLE `task_runs` ADD `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `task_runs` ADD `output_tokens` integer;--> statement-breakpoint
ALTER TABLE `task_runs` ADD `total_tokens` integer;--> statement-breakpoint
ALTER TABLE `task_runs` ADD `cost_usd` real;