ALTER TABLE `task_notifications` ADD `category` text DEFAULT 'failure' NOT NULL;--> statement-breakpoint
ALTER TABLE `task_notifications` ADD `read_at` text;--> statement-breakpoint
ALTER TABLE `task_notifications` ADD `target_path` text;