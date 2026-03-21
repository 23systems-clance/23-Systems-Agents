-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "bullmq_job_id" TEXT;
