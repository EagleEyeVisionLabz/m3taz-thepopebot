DROP INDEX `user_channels_code_lookup`;--> statement-breakpoint
ALTER TABLE `user_channels` ADD `code_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `user_channels_code_unique` ON `user_channels` (`code`);--> statement-breakpoint
ALTER TABLE `settings` ADD `key_hash` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `settings_key_hash_lookup` ON `settings` (`key_hash`);