CREATE TABLE `payment_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` text NOT NULL,
	`wallet_address` text NOT NULL,
	`amount` text NOT NULL,
	`network` text NOT NULL,
	`domain` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_records_payment_id_unique` ON `payment_records` (`payment_id`);