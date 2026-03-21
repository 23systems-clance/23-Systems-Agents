-- CreateTable
CREATE TABLE "enrichment_presets" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "person_seniorities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "person_titles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "person_departments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "person_functions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "per_page" INTEGER NOT NULL DEFAULT 25,
    "created_by_user_id" TEXT NOT NULL,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrichment_presets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enrichment_presets_is_default_idx" ON "enrichment_presets"("is_default");

-- Seed default preset
INSERT INTO "enrichment_presets" ("id", "name", "is_default", "person_seniorities", "per_page", "created_by_user_id", "created_by_name", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'Standard Decision Makers', true, '{c_suite,founder,owner,vp,director}', 25, 'system', 'System', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
