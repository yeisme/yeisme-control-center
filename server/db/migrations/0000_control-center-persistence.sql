CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`occurred_at` text NOT NULL,
	`actor` text NOT NULL,
	`session_id` text,
	`scope_id` text,
	`action` text NOT NULL,
	`owner` text,
	`target_ref` text,
	`purpose` text,
	`outcome` text NOT NULL,
	`error_code` text,
	`meta` text
);
--> statement-breakpoint
CREATE INDEX `audit_action_idx` ON `audit_events` (`action`);--> statement-breakpoint
CREATE INDEX `audit_occurred_idx` ON `audit_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`run_ref` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_runs` (
	`run_ref` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`modality` text NOT NULL,
	`model_ref` text NOT NULL,
	`scope_id` text NOT NULL,
	`project_ref` text NOT NULL,
	`trace_ref` text NOT NULL,
	`source_ref` text,
	`state` text NOT NULL,
	`output_refs` text DEFAULT '[]' NOT NULL,
	`upstream_cost` real,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`cost_state` text DEFAULT 'unknown' NOT NULL,
	`observed_at` text NOT NULL,
	`created_at` text NOT NULL,
	`evidence_refs` text DEFAULT '[]' NOT NULL,
	`error_code` text,
	`connection_state` text DEFAULT 'configured' NOT NULL,
	`budget_reserved` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_state_idx` ON `provider_runs` (`state`);--> statement-breakpoint
CREATE INDEX `runs_project_idx` ON `provider_runs` (`project_ref`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`name` text NOT NULL,
	`csrf` text NOT NULL,
	`access_token` text DEFAULT '' NOT NULL,
	`access_audience` text DEFAULT '[]' NOT NULL,
	`expires` integer NOT NULL,
	`personal` integer DEFAULT false NOT NULL,
	`last_seen` integer,
	`credential_version` text,
	`epoch` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_subject_idx` ON `sessions` (`issuer`,`subject`);--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_key` text NOT NULL,
	`source_ref` text NOT NULL,
	`trace_ref` text NOT NULL,
	`owner` text NOT NULL,
	`model_ref` text NOT NULL,
	`modality` text NOT NULL,
	`quantity` integer,
	`unit` text NOT NULL,
	`upstream_cost` real,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`cost_state` text DEFAULT 'unknown' NOT NULL,
	`status` text NOT NULL,
	`project_ref` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_events_source_key_unique` ON `usage_events` (`source_key`);--> statement-breakpoint
CREATE INDEX `usage_project_idx` ON `usage_events` (`project_ref`);