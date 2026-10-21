CREATE TABLE `task_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`session_id` text NOT NULL,
	`subject` text NOT NULL,
	`task_key` text NOT NULL,
	`task_revision` text DEFAULT '' NOT NULL,
	`failure_fingerprint` text NOT NULL,
	`state` text DEFAULT 'unread' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`presence` text DEFAULT 'live' NOT NULL,
	`task_state` text DEFAULT '' NOT NULL,
	`native_state` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`project` text DEFAULT '' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`acknowledged_at` text,
	`muted_at` text,
	`archived_at` text,
	`snoozed_until` text,
	`last_error_code` text DEFAULT '' NOT NULL,
	`reopened` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_scope_session_idx` ON `task_notifications` (`scope_id`,`session_id`,`subject`);--> statement-breakpoint
CREATE INDEX `notifications_fingerprint_idx` ON `task_notifications` (`session_id`,`failure_fingerprint`);--> statement-breakpoint
CREATE INDEX `notifications_task_idx` ON `task_notifications` (`scope_id`,`task_key`);