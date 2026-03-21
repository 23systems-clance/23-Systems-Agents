-- Fix 1: Delete the stale draft v2 that was created from v1 before the
-- graph-update migration ran.  The user will re-create a draft from the
-- corrected published v1.
DELETE FROM "workflow_versions"
WHERE template_id = '00000000-0000-4000-a000-000000000001'
  AND status = 'DRAFT';

-- Fix 2: Add ON DELETE CASCADE to the workflow_executions -> workflow_versions
-- FK so that deleting a workflow template cascades through versions to
-- executions without FK violation errors.
ALTER TABLE "workflow_executions"
  DROP CONSTRAINT IF EXISTS "workflow_executions_version_id_fkey",
  ADD CONSTRAINT "workflow_executions_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "workflow_versions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
