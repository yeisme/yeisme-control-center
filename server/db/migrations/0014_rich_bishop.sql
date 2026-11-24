CREATE TABLE `personal_invite_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_invite_token_hash_idx` ON `personal_invite_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `personal_invite_username_idx` ON `personal_invite_tokens` (`username`,`created_at`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `invite_id` text;--> statement-breakpoint
CREATE INDEX `sessions_invite_idx` ON `sessions` (`invite_id`);