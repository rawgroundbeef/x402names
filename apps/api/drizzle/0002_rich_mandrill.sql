CREATE TABLE `registration_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_name` text NOT NULL,
	`tld` text NOT NULL,
	`owner_wallet` text NOT NULL,
	`payment_id` text NOT NULL,
	`amount_paid` text NOT NULL,
	`target_url` text,
	`state` text DEFAULT 'processing' NOT NULL,
	`progress` integer DEFAULT 0,
	`current_step` text,
	`error` text,
	`error_code` text,
	`registrar_order_id` text,
	`attempts` integer DEFAULT 0,
	`next_retry_at` integer,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_jobs_payment_id_unique` ON `registration_jobs` (`payment_id`);