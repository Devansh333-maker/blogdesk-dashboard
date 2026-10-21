CREATE TABLE `cost_access_limits` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`attempts` integer NOT NULL,
	`blocked_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cost_admin_sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`csrf_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cost_admin_sessions_expiry` ON `cost_admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `openai_admin_credentials` (
	`id` integer PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`key_hint` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
