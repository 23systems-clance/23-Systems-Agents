-- Seed the core CSV enrichment workflow as a WorkflowTemplate so it appears
-- in the admin dashboard workflows list.  Uses ON CONFLICT to be idempotent.

INSERT INTO "workflow_templates" (
  id,
  slack_team_id,
  name,
  description,
  trigger_type,
  is_active,
  created_by_user_id,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-4000-a000-000000000001',
  'T_DEFAULT',
  'CSV File Enrichment',
  'Upload a CSV/XLSX file in any Slack channel, reply with ENRICH, and the bot classifies intent (technographic, contact, or combined), runs BuiltWith + Apollo enrichment, and delivers an enriched file back.',
  'FILE_UPLOAD',
  true,
  'system',
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO "workflow_versions" (
  id,
  template_id,
  version,
  status,
  graph,
  published_at,
  published_by_user_id,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-a000-000000000001',
  1,
  'PUBLISHED',
  '{
    "nodes": [
      {
        "id": "trigger-1",
        "type": "TRIGGER",
        "position": { "x": 400, "y": 50 },
        "data": { "label": "File Upload", "triggerType": "FILE_UPLOAD", "description": "User uploads CSV/XLSX file to a Slack channel" }
      },
      {
        "id": "msg-1",
        "type": "MESSAGE",
        "position": { "x": 400, "y": 180 },
        "data": { "label": "Wait for ENRICH", "description": "Bot detects the file and waits for user to reply with ENRICH keyword + optional instructions" }
      },
      {
        "id": "action-classify",
        "type": "ACTION",
        "position": { "x": 400, "y": 310 },
        "data": { "label": "AI Classification", "description": "Claude 3.5 Haiku classifies intent as technographic, contact, combined, or tech-report" }
      },
      {
        "id": "form-1",
        "type": "FORM_MODAL",
        "position": { "x": 400, "y": 440 },
        "data": { "label": "Collect Context", "description": "Slack modal collects purpose, co-sell status, list owner, and notes" }
      },
      {
        "id": "condition-1",
        "type": "CONDITION",
        "position": { "x": 400, "y": 570 },
        "data": { "label": "Validate File", "description": "Check row count (max 5000), file format, detect domain/company columns" }
      },
      {
        "id": "enrich-1",
        "type": "ENRICHMENT",
        "position": { "x": 400, "y": 700 },
        "data": { "label": "Run Enrichment", "enrichmentType": "combined", "description": "BuiltWith (technographic) + Apollo (contacts) enrichment via BullMQ queue" }
      },
      {
        "id": "action-generate",
        "type": "ACTION",
        "position": { "x": 400, "y": 830 },
        "data": { "label": "Generate Output", "description": "Build enriched CSV/XLSX with tech stack, contacts, and metadata; upload to S3" }
      },
      {
        "id": "msg-result",
        "type": "MESSAGE",
        "position": { "x": 400, "y": 960 },
        "data": { "label": "Deliver Results", "description": "Post summary stats and download link back to the Slack thread" }
      }
    ],
    "edges": [
      { "id": "e-1", "source": "trigger-1", "target": "msg-1" },
      { "id": "e-2", "source": "msg-1", "target": "action-classify" },
      { "id": "e-3", "source": "action-classify", "target": "form-1" },
      { "id": "e-4", "source": "form-1", "target": "condition-1" },
      { "id": "e-5", "source": "condition-1", "target": "enrich-1" },
      { "id": "e-6", "source": "enrich-1", "target": "action-generate" },
      { "id": "e-7", "source": "action-generate", "target": "msg-result" }
    ],
    "viewport": { "x": 0, "y": 0, "zoom": 1 }
  }'::jsonb,
  NOW(),
  'system',
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;
