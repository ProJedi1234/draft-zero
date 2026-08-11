CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`default_model_id` text NOT NULL,
	`openrouter_key` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lorebook_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`keys_json` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`always_active` integer DEFAULT 0 NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lorebook_entries_name_idx` ON `lorebook_entries` (`name`);--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`genre` text DEFAULT '' NOT NULL,
	`memory` text DEFAULT '' NOT NULL,
	`authors_note` text DEFAULT '' NOT NULL,
	`model_id` text NOT NULL,
	`temperature` real NOT NULL,
	`top_p` real NOT NULL,
	`max_tokens` integer NOT NULL,
	`frequency_penalty` real NOT NULL,
	`presence_penalty` real NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `story_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`position` integer NOT NULL,
	`source` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_entries_story_id_position_idx` ON `story_entries` (`story_id`,`position`);