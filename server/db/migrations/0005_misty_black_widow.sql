CREATE TABLE `action_records` (
	`id` text PRIMARY KEY NOT NULL,
	`context` text NOT NULL,
	`key` text NOT NULL,
	`request_digest` text NOT NULL,
	`request` text NOT NULL,
	`preview` text NOT NULL,
	`created_at` integer NOT NULL,
	`started` integer DEFAULT false NOT NULL,
	`receipt` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `action_context_key_idx` ON `action_records` (`context`,`key`);--> statement-breakpoint
CREATE TABLE `collaboration_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`items` text NOT NULL,
	`total_cost` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collaboration_batch_key_idx` ON `collaboration_batches` (`project_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `collaboration_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `collaboration_folder_project_idx` ON `collaboration_folders` (`project_id`);--> statement-breakpoint
CREATE TABLE `collaboration_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`folder_id` text,
	`owner` text NOT NULL,
	`task_key` text NOT NULL,
	`artifact_ref` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`revision` text NOT NULL,
	`batch_ref` text,
	`created_at` text NOT NULL,
	`source_state` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `collaboration_items_project_idx` ON `collaboration_items` (`project_id`,`id`);--> statement-breakpoint
CREATE TABLE `collaboration_members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`identity` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collaboration_member_identity_idx` ON `collaboration_members` (`organization_id`,`identity`);--> statement-breakpoint
CREATE TABLE `collaboration_organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_tenant` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collaboration_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`team_id` text,
	`name` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`generation_enabled` integer DEFAULT false NOT NULL,
	`budget_cap` real DEFAULT 0 NOT NULL,
	`bindings` text DEFAULT '[]' NOT NULL,
	`grants` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `collaboration_projects_org_idx` ON `collaboration_projects` (`organization_id`);--> statement-breakpoint
CREATE TABLE `collaboration_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`member_ids` text DEFAULT '[]' NOT NULL
);
