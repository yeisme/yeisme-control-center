CREATE TABLE `tool_catalog_baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`established_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tool_catalog_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`entry_id` text NOT NULL,
	`digest` text NOT NULL,
	`baseline` integer DEFAULT false NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`changed_at` text,
	`removed_at` text
);
--> statement-breakpoint
CREATE INDEX `tool_catalog_scope_idx` ON `tool_catalog_entries` (`scope_id`,`owner`,`kind`);