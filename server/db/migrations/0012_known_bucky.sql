CREATE TABLE `prompt_collection_links` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`collection_id` text NOT NULL,
	`owner` text NOT NULL,
	`project_ref` text NOT NULL,
	`prompt_id` text NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `prompt_collections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `prompt_collection_link_scope_idx` ON `prompt_collection_links` (`scope_id`,`collection_id`);--> statement-breakpoint
CREATE TABLE `prompt_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prompt_collection_scope_idx` ON `prompt_collections` (`scope_id`);