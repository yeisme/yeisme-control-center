CREATE TABLE `auctra_collection_cursors` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`binding_fingerprint` text NOT NULL,
	`cursor` text DEFAULT '' NOT NULL,
	`source_snapshot_digest` text DEFAULT '' NOT NULL,
	`last_success_at` text,
	`coverage` text DEFAULT 'unknown' NOT NULL,
	`reason` text
);
--> statement-breakpoint
CREATE INDEX `auctra_collection_cursor_scope_idx` ON `auctra_collection_cursors` (`scope_id`,`binding_fingerprint`);--> statement-breakpoint
CREATE TABLE `auctra_collection_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`record_ref` text NOT NULL,
	`confirmed_at` text,
	`confirmed_by` text,
	`archived_at` text,
	`archived_by` text,
	`labels` text DEFAULT '[]' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auctra_collection_metadata_scope_idx` ON `auctra_collection_metadata` (`scope_id`,`record_ref`);--> statement-breakpoint
CREATE TABLE `auctra_collection_records` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`record_ref` text NOT NULL,
	`record_kind` text NOT NULL,
	`project_ref` text NOT NULL,
	`work_ref` text,
	`unit_ref` text,
	`candidate_ref` text,
	`review_ref` text,
	`version_ref` text,
	`run_ref` text,
	`kind` text,
	`title` text,
	`source_revision` text,
	`source_digest` text,
	`source_state` text DEFAULT 'fresh' NOT NULL,
	`review_state` text,
	`status` text,
	`evidence_refs` text DEFAULT '[]' NOT NULL,
	`created_at` text,
	`source_updated_at` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`collection_state` text DEFAULT 'active' NOT NULL,
	`metadata_revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auctra_collection_scope_idx` ON `auctra_collection_records` (`scope_id`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `auctra_collection_kind_idx` ON `auctra_collection_records` (`scope_id`,`record_kind`);--> statement-breakpoint
CREATE INDEX `auctra_collection_state_idx` ON `auctra_collection_records` (`scope_id`,`collection_state`);