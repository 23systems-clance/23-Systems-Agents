-- CreateTable
CREATE TABLE "personality_analyses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "linkedin_url" TEXT NOT NULL,
    "contact_name" TEXT,
    "raw_response" JSONB NOT NULL,
    "archetype_name" TEXT,
    "archetype_score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personality_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "personality_analyses_linkedin_url_key" ON "personality_analyses"("linkedin_url");
