/*
  Warnings:

  - You are about to drop the `session` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "campaign_name" TEXT;

-- DropTable
DROP TABLE "session";
