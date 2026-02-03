CREATE TABLE `domains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`tld` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`owner_wallet` text NOT NULL,
	`target_url` text,
	`payment_id` text,
	`registrar_order_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_name_unique` ON `domains` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `domains_payment_id_unique` ON `domains` (`payment_id`);--> statement-breakpoint
CREATE TABLE `system` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `system_key_unique` ON `system` (`key`);