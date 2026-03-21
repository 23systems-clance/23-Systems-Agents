-- CreateEnum: AdminRole
CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'VIEWER');

-- AlterTable: Add username, password_hash, role to admin_users; make api_key_hash nullable
ALTER TABLE "admin_users" ADD COLUMN "username" TEXT;
ALTER TABLE "admin_users" ADD COLUMN "password_hash" TEXT;
ALTER TABLE "admin_users" ADD COLUMN "role" "AdminRole" NOT NULL DEFAULT 'VIEWER';
ALTER TABLE "admin_users" ALTER COLUMN "api_key_hash" DROP NOT NULL;

-- CreateIndex: unique constraint on username
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateTable: session (for connect-pg-simple)
CREATE TABLE "session" (
  "sid" varchar NOT NULL,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX "IDX_session_expire" ON "session" ("expire");
