CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`project_summary` text,
	`conversation_json` text,
	`recommendations_json` text,
	`report_path` text,
	`persona_mode` text,
	`source` text DEFAULT 'consult-page' NOT NULL,
	`created_at` integer NOT NULL
);
