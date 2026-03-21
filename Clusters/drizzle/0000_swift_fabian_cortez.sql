CREATE TABLE "capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"version" text DEFAULT '1.0.0',
	"source_path" text,
	"config" text,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New Chat' NOT NULL,
	"starred" integer DEFAULT 0 NOT NULL,
	"code_workspace_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"cluster_id" text NOT NULL,
	"role_name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"prompt" text DEFAULT 'Execute your role.' NOT NULL,
	"trigger_config" text,
	"max_concurrency" integer DEFAULT 1 NOT NULL,
	"cleanup_worker_dir" integer DEFAULT 0 NOT NULL,
	"folders" text,
	"mcp_servers" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'New Cluster' NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"folders" text,
	"enabled" integer DEFAULT 0 NOT NULL,
	"starred" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"container_name" text,
	"repo" text,
	"branch" text,
	"feature_branch" text,
	"title" text DEFAULT 'Code Workspace' NOT NULL,
	"coding_agent" text DEFAULT 'claude-code' NOT NULL,
	"last_interactive_commit" text,
	"starred" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "code_workspaces_container_name_unique" UNIQUE("container_name")
);
--> statement-breakpoint
CREATE TABLE "job_capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"tokens_used" integer DEFAULT 0,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"branch" text,
	"pr_url" text,
	"pr_number" integer,
	"commit_sha" text,
	"log_sha" text,
	"exit_code" integer,
	"error" text,
	"merge_result" text,
	"changed_files" text,
	"llm_provider" text,
	"llm_model" text,
	"agent_backend" text DEFAULT 'pi',
	"started_at" bigint,
	"completed_at" bigint,
	"duration_ms" bigint,
	"current_step" text,
	"step_history" text,
	"retry_count" integer DEFAULT 0,
	"validation_errors" text,
	"bullmq_job_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"project_summary" text,
	"conversation_json" text,
	"recommendations_json" text,
	"report_path" text,
	"persona_mode" text,
	"source" text DEFAULT 'consult-page' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"notification" text NOT NULL,
	"payload" text NOT NULL,
	"read" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_by" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"channel_id" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "idx_capabilities_type" ON "capabilities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_capabilities_category" ON "capabilities" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_job_capabilities_job" ON "job_capabilities" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_status" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_jobs_created_at" ON "jobs" USING btree ("created_at");