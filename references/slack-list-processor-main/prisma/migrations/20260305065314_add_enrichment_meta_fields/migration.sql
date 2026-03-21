-- AlterTable
ALTER TABLE "job_companies" ADD COLUMN     "company_name_from_api" TEXT,
ADD COLUMN     "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "employee_count" INTEGER,
ADD COLUMN     "followers" INTEGER,
ADD COLUMN     "location_zip" TEXT,
ADD COLUMN     "meta_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "product_count" INTEGER,
ADD COLUMN     "sales_revenue" INTEGER,
ADD COLUMN     "social_profiles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tech_spend_usd" INTEGER,
ADD COLUMN     "telephones" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "vertical" TEXT;
