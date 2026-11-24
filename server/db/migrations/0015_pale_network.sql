CREATE TABLE `project_collection_bindings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`source_scope` text NOT NULL,
	`project_ref` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `collaboration_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
