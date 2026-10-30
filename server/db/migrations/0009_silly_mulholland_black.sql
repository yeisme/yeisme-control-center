CREATE TABLE `control_state` (
	`name` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_mute_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`subject` text NOT NULL,
	`kind` text NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`key` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notification_mute_rules_subject_idx` ON `notification_mute_rules` (`scope_id`,`subject`);--> statement-breakpoint
ALTER TABLE `task_notifications` ADD `task_identity` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `task_notifications` ADD `recovered_at` text;--> statement-breakpoint
CREATE INDEX `notifications_identity_idx` ON `task_notifications` (`scope_id`,`subject`,`task_identity`);