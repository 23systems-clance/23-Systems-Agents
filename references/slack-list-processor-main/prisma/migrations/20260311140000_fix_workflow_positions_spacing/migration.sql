-- Fix the CSV File Enrichment workflow node positions.
-- Previous positions caused vertical overlap on tall nodes (e.g. Purpose with
-- 5 buttons is ~330px tall at y=480, overlapping Co-sell starting at y=710).
-- New positions use generous vertical gaps based on estimated node heights.

UPDATE "workflow_versions"
SET graph = '{
  "nodes": [
    {
      "id": "trigger",
      "type": "TRIGGER",
      "position": { "x": 400, "y": 0 },
      "data": {
        "type": "TRIGGER",
        "triggerType": "file_upload",
        "label": "File Upload",
        "description": "User uploads a CSV or XLSX file to a Slack channel. The bot detects the file and starts the enrichment workflow."
      }
    },
    {
      "id": "list-type",
      "type": "BUTTON_CHOICE",
      "position": { "x": 400, "y": 210 },
      "data": {
        "type": "BUTTON_CHOICE",
        "label": "List Type",
        "description": "Ask the user what type of list they uploaded. Company lists show enrichment type options; Contact lists skip directly to purpose selection.",
        "prompt": "I detected your file — *{{fileName}}*\n\nWhat type of list is this?",
        "buttons": [
          { "id": "company", "label": "Company List", "value": "company", "style": "primary" },
          { "id": "contact", "label": "Contact List", "value": "contact", "style": "" }
        ],
        "outputVariable": "listType"
      }
    },
    {
      "id": "enrich-type",
      "type": "BUTTON_CHOICE",
      "position": { "x": 50, "y": 510 },
      "data": {
        "type": "BUTTON_CHOICE",
        "label": "Enrichment Type",
        "description": "For company lists, ask what enrichment to perform. Technographics uses BuiltWith API, Contacts uses Apollo API, Both runs both sequentially.",
        "prompt": "What would you like me to do with this list?",
        "buttons": [
          { "id": "technographics", "label": "Get Technographics", "value": "technographic", "style": "primary" },
          { "id": "contacts", "label": "Get Contacts", "value": "contact", "style": "" },
          { "id": "both", "label": "Get Both", "value": "combined", "style": "" }
        ],
        "outputVariable": "enrichmentType"
      }
    },
    {
      "id": "purpose",
      "type": "BUTTON_CHOICE",
      "position": { "x": 750, "y": 510 },
      "data": {
        "type": "BUTTON_CHOICE",
        "label": "Purpose",
        "description": "Ask the user what the enriched list will be used for. This determines which contact fields (email, phone, LinkedIn) to prioritize in the output.",
        "prompt": "What is this list for?",
        "buttons": [
          { "id": "just_a_list", "label": "Just a List", "value": "JUST_A_LIST", "style": "primary" },
          { "id": "emailing", "label": "Email", "value": "EMAILING", "style": "" },
          { "id": "cold_calling", "label": "Cold Call", "value": "COLD_CALLING", "style": "" },
          { "id": "linkedin", "label": "LinkedIn", "value": "LINKEDIN", "style": "" },
          { "id": "all", "label": "All", "value": "ALL", "style": "" }
        ],
        "outputVariable": "purpose"
      }
    },
    {
      "id": "cosell",
      "type": "BUTTON_CHOICE",
      "position": { "x": 750, "y": 910 },
      "data": {
        "type": "BUTTON_CHOICE",
        "label": "Co-sell Check",
        "description": "Ask whether this is a co-sell list. If yes, the user will be asked to select a cloud provider (AWS, Azure, GCP). Co-sell metadata is stored with the job.",
        "prompt": "Is this a co-sell list?",
        "buttons": [
          { "id": "cosell_yes", "label": "Yes", "value": "yes", "style": "primary" },
          { "id": "cosell_no", "label": "No", "value": "no", "style": "" }
        ],
        "outputVariable": "isCosell"
      }
    },
    {
      "id": "cloud-provider",
      "type": "BUTTON_CHOICE",
      "position": { "x": 250, "y": 1190 },
      "data": {
        "type": "BUTTON_CHOICE",
        "label": "Cloud Provider",
        "description": "For co-sell lists, ask which cloud provider the co-sell is for. This metadata is stored with the enrichment job for reporting.",
        "prompt": "Which cloud provider?",
        "buttons": [
          { "id": "aws", "label": "AWS", "value": "AWS", "style": "primary" },
          { "id": "azure", "label": "Azure", "value": "Azure", "style": "" },
          { "id": "gcp", "label": "GCP", "value": "GCP", "style": "" },
          { "id": "other", "label": "Other", "value": "Other", "style": "" }
        ],
        "outputVariable": "cosellProvider"
      }
    },
    {
      "id": "context",
      "type": "MESSAGE",
      "position": { "x": 750, "y": 1190 },
      "data": {
        "type": "MESSAGE",
        "label": "Collect Context",
        "description": "Ask the user for the list owner name and any additional context. The user replies in the Slack thread and the bot captures the response.",
        "text": "Who is the owner of this list and is there any additional context? (Reply in this thread)"
      }
    },
    {
      "id": "validate",
      "type": "CONDITION",
      "position": { "x": 400, "y": 1530 },
      "data": {
        "type": "CONDITION",
        "label": "Validate File",
        "description": "Download the uploaded file, parse CSV/XLSX, validate structure (requires domain or company name column), check row count (max 5,000 rows, default 1,000), clean HTML entities, and normalize domains.",
        "evaluationField": "fileValid"
      }
    },
    {
      "id": "enrich",
      "type": "ENRICHMENT",
      "position": { "x": 400, "y": 1790 },
      "data": {
        "type": "ENRICHMENT",
        "label": "Run Enrichment",
        "description": "Create a Job record in the database, create JobCompany records for each row, and enqueue a BullMQ enrichment job. Technographic uses BuiltWith API, Contact uses Apollo API, Combined runs both.",
        "enrichmentType": "combined",
        "fileSourceVariable": "fileId",
        "outputJobIdVariable": "jobId"
      }
    },
    {
      "id": "generate",
      "type": "ACTION",
      "position": { "x": 400, "y": 2040 },
      "data": {
        "type": "ACTION",
        "label": "Generate Output",
        "description": "Build the enriched CSV/XLSX file with tech stack data, contact information, tech spend tiers, and metadata columns. Upload the result to S3 and generate a download link.",
        "actionType": "generate_enriched_file",
        "params": {
          "uploadToS3": true,
          "format": "csv",
          "includeMetadata": true
        },
        "outputVariable": "outputFileUrl"
      }
    },
    {
      "id": "results",
      "type": "MESSAGE",
      "position": { "x": 400, "y": 2280 },
      "data": {
        "type": "MESSAGE",
        "label": "Deliver Results",
        "description": "Post a summary message back to the Slack thread with enrichment statistics (companies processed, contacts found, success rate) and a download link for the enriched file.",
        "text": "Enrichment complete! Your enriched file is ready.\n\n*Results:*\n- Companies processed: {{companiesProcessed}}\n- Contacts found: {{contactsFound}}\n- Success rate: {{successRate}}%\n\nDownload your enriched file: {{outputFileUrl}}"
      }
    }
  ],
  "edges": [
    { "id": "e-1", "source": "trigger", "target": "list-type" },
    { "id": "e-2", "source": "list-type", "target": "enrich-type", "sourceHandle": "company", "label": "Company" },
    { "id": "e-3", "source": "list-type", "target": "purpose", "sourceHandle": "contact", "label": "Contact" },
    { "id": "e-4", "source": "enrich-type", "target": "validate", "sourceHandle": "technographics", "label": "Tech Only" },
    { "id": "e-5", "source": "enrich-type", "target": "purpose", "sourceHandle": "contacts", "label": "Contacts" },
    { "id": "e-6", "source": "enrich-type", "target": "purpose", "sourceHandle": "both", "label": "Both" },
    { "id": "e-7", "source": "purpose", "target": "cosell", "sourceHandle": "just_a_list" },
    { "id": "e-8", "source": "purpose", "target": "cosell", "sourceHandle": "emailing" },
    { "id": "e-9", "source": "purpose", "target": "cosell", "sourceHandle": "cold_calling" },
    { "id": "e-10", "source": "purpose", "target": "cosell", "sourceHandle": "linkedin" },
    { "id": "e-11", "source": "purpose", "target": "cosell", "sourceHandle": "all" },
    { "id": "e-12", "source": "cosell", "target": "cloud-provider", "sourceHandle": "cosell_yes", "label": "Yes" },
    { "id": "e-13", "source": "cosell", "target": "context", "sourceHandle": "cosell_no", "label": "No" },
    { "id": "e-14", "source": "cloud-provider", "target": "context", "sourceHandle": "aws" },
    { "id": "e-15", "source": "cloud-provider", "target": "context", "sourceHandle": "azure" },
    { "id": "e-16", "source": "cloud-provider", "target": "context", "sourceHandle": "gcp" },
    { "id": "e-17", "source": "cloud-provider", "target": "context", "sourceHandle": "other" },
    { "id": "e-18", "source": "context", "target": "validate" },
    { "id": "e-19", "source": "validate", "target": "enrich", "condition": { "field": "fileValid", "operator": "default" } },
    { "id": "e-20", "source": "enrich", "target": "generate" },
    { "id": "e-21", "source": "generate", "target": "results" }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 0.55 }
}'::jsonb,
updated_at = NOW()
WHERE template_id = '00000000-0000-4000-a000-000000000001'
  AND status = 'PUBLISHED';
