CREATE TABLE `owner_project_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`tenant` text NOT NULL,
	`template_id` text NOT NULL,
	`owner` text NOT NULL,
	`project_ref` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_project_connections_scope_idx` ON `owner_project_connections` (`scope_id`,`tenant`,`owner`,`project_ref`);