-- Drop orphan chats (legacy 'telegram'/'unknown' userId literals) and their messages.
-- Forward-only: never user-owned data.
DELETE FROM `messages` WHERE `chat_id` IN (SELECT `id` FROM `chats` WHERE `user_id` IN ('telegram','unknown'));--> statement-breakpoint
DELETE FROM `chats` WHERE `user_id` IN ('telegram','unknown');--> statement-breakpoint

-- Drop legacy notification tables (folded into messages).
DROP TABLE `notifications`;--> statement-breakpoint
DROP TABLE `subscriptions`;--> statement-breakpoint

-- Recreate messages with new shape, backfilling user_id from chats join.
-- Orphan messages (chat row missing) are dropped by the INNER JOIN.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`payload` text,
	`read` integer DEFAULT 0 NOT NULL,
	`delivered_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_messages` (`id`, `chat_id`, `user_id`, `role`, `content`, `payload`, `read`, `delivered_at`, `created_at`)
SELECT `m`.`id`, `m`.`chat_id`, `c`.`user_id`, `m`.`role`, `m`.`content`, NULL, 0, NULL, `m`.`created_at`
FROM `messages` `m` INNER JOIN `chats` `c` ON `c`.`id` = `m`.`chat_id`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `messages_inbox_lookup` ON `messages` (`user_id`,`read`,`created_at`);--> statement-breakpoint

-- Recreate users with subscribed_to_system_messages column (defaults to 1 for existing rows).
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`first_name` text,
	`last_name` text,
	`nickname` text,
	`subscribed_to_system_messages` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users` (`id`, `email`, `password_hash`, `role`, `first_name`, `last_name`, `nickname`, `subscribed_to_system_messages`, `created_at`, `updated_at`)
SELECT `id`, `email`, `password_hash`, `role`, `first_name`, `last_name`, `nickname`, 1, `created_at`, `updated_at` FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
