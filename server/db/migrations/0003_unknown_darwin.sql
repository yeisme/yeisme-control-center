CREATE TABLE `project_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`owner` text NOT NULL,
	`project_ref` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_metadata_scope_project_idx` ON `project_metadata` (`scope_id`,`owner`,`project_ref`);