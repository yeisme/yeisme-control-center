CREATE TABLE `prompt_recipe_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`facets` text DEFAULT '{}' NOT NULL,
	`content_state` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `prompt_recipes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_recipe_revision_idx` ON `prompt_recipe_revisions` (`recipe_id`,`revision`);--> statement-breakpoint
CREATE TABLE `prompt_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`owner` text NOT NULL,
	`project_ref` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`facets` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`content_state` text DEFAULT 'metadata_only' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prompt_recipe_scope_idx` ON `prompt_recipes` (`scope_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `prompt_recipe_owner_idx` ON `prompt_recipes` (`scope_id`,`owner`,`project_ref`);