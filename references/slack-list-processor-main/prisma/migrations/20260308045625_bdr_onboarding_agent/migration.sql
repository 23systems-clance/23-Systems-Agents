-- CreateEnum
CREATE TYPE "TrainingItemType" AS ENUM ('VIDEO', 'READING', 'QUIZ', 'PRACTICE_TASK', 'CHECKLIST', 'RESOURCE_LINK', 'REIMBURSEMENT_INFO');

-- CreateEnum
CREATE TYPE "AutomationType" AS ENUM ('CHECK_IN', 'REMINDER', 'WEEKLY_SUMMARY', 'CUSTOM_MESSAGE');

-- CreateEnum
CREATE TYPE "OnboardingEnrollmentStatus" AS ENUM ('ACTIVE', 'SUPERVISED', 'PENDING_GRADUATION', 'GRADUATED', 'EXTENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnboardingModuleStatus" AS ENUM ('PENDING', 'DELIVERED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ManagerReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "onboarding_plans" (
    "id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration_days" INTEGER NOT NULL,
    "supervised_start_day" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_latest" BOOLEAN NOT NULL DEFAULT true,
    "parent_plan_id" UUID,
    "weekdays_only" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_modules" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "day_number" INTEGER NOT NULL,
    "week_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "estimated_minutes" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_items" (
    "id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "type" "TrainingItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "metadata" JSONB,
    "estimated_minutes" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "library_item_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_automations" (
    "id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "type" "AutomationType" NOT NULL,
    "trigger_time" TEXT NOT NULL,
    "content" TEXT,
    "conditions" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_enrollments" (
    "id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "bdr_name" TEXT NOT NULL,
    "plan_id" UUID NOT NULL,
    "manager_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "delivery_hour" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "OnboardingEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_day" INTEGER NOT NULL DEFAULT 0,
    "supervised_campaign_id" UUID,
    "graduated_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "extended_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_progress" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "day_number" INTEGER NOT NULL,
    "status" "OnboardingModuleStatus" NOT NULL DEFAULT 'PENDING',
    "delivered_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "quiz_responses" JSONB,
    "quiz_score" DOUBLE PRECISION,
    "practice_submission" TEXT,
    "manager_review_status" "ManagerReviewStatus",
    "manager_reviewed_at" TIMESTAMP(3),
    "checklist_progress" JSONB,
    "delivery_message_ts" TEXT,
    "delivery_failed" BOOLEAN NOT NULL DEFAULT false,
    "delivery_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "module_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkin_responses" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "day_number" INTEGER NOT NULL,
    "response" TEXT NOT NULL,
    "responded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkin_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_library_items" (
    "id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "type" "TrainingItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "metadata" JSONB,
    "estimated_minutes" INTEGER,
    "category_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_library_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "onboarding_plans_slack_team_id_is_latest_idx" ON "onboarding_plans"("slack_team_id", "is_latest");

-- CreateIndex
CREATE INDEX "onboarding_plans_parent_plan_id_idx" ON "onboarding_plans"("parent_plan_id");

-- CreateIndex
CREATE INDEX "onboarding_modules_plan_id_day_number_idx" ON "onboarding_modules"("plan_id", "day_number");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_modules_plan_id_day_number_key" ON "onboarding_modules"("plan_id", "day_number");

-- CreateIndex
CREATE INDEX "training_items_module_id_sort_order_idx" ON "training_items"("module_id", "sort_order");

-- CreateIndex
CREATE INDEX "onboarding_automations_module_id_idx" ON "onboarding_automations"("module_id");

-- CreateIndex
CREATE INDEX "onboarding_enrollments_slack_user_id_status_idx" ON "onboarding_enrollments"("slack_user_id", "status");

-- CreateIndex
CREATE INDEX "onboarding_enrollments_slack_team_id_status_idx" ON "onboarding_enrollments"("slack_team_id", "status");

-- CreateIndex
CREATE INDEX "onboarding_enrollments_plan_id_idx" ON "onboarding_enrollments"("plan_id");

-- CreateIndex
CREATE INDEX "module_progress_enrollment_id_day_number_idx" ON "module_progress"("enrollment_id", "day_number");

-- CreateIndex
CREATE INDEX "module_progress_enrollment_id_status_idx" ON "module_progress"("enrollment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "module_progress_enrollment_id_day_number_key" ON "module_progress"("enrollment_id", "day_number");

-- CreateIndex
CREATE INDEX "checkin_responses_enrollment_id_day_number_idx" ON "checkin_responses"("enrollment_id", "day_number");

-- CreateIndex
CREATE INDEX "content_library_items_slack_team_id_idx" ON "content_library_items"("slack_team_id");

-- CreateIndex
CREATE INDEX "content_library_items_type_idx" ON "content_library_items"("type");

-- AddForeignKey
ALTER TABLE "onboarding_plans" ADD CONSTRAINT "onboarding_plans_parent_plan_id_fkey" FOREIGN KEY ("parent_plan_id") REFERENCES "onboarding_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_modules" ADD CONSTRAINT "onboarding_modules_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "onboarding_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_items" ADD CONSTRAINT "training_items_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "onboarding_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_items" ADD CONSTRAINT "training_items_library_item_id_fkey" FOREIGN KEY ("library_item_id") REFERENCES "content_library_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_automations" ADD CONSTRAINT "onboarding_automations_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "onboarding_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_enrollments" ADD CONSTRAINT "onboarding_enrollments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "onboarding_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_enrollments" ADD CONSTRAINT "onboarding_enrollments_supervised_campaign_id_fkey" FOREIGN KEY ("supervised_campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_progress" ADD CONSTRAINT "module_progress_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "onboarding_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_progress" ADD CONSTRAINT "module_progress_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "onboarding_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_responses" ADD CONSTRAINT "checkin_responses_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "onboarding_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_responses" ADD CONSTRAINT "checkin_responses_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "onboarding_automations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
