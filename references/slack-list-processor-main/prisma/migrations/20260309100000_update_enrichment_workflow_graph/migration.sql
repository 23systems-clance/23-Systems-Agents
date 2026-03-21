-- Update the CSV File Enrichment workflow graph with proper node configurations
-- matching the exact hardcoded enrichment flow.
--
-- Previous seed had 8 nodes with only labels/descriptions (no functional config).
-- This migration replaces the graph with 11 fully-configured nodes and 21 edges
-- that mirror the production Slack bot flow:
--   File Upload → List Type → Enrichment Type → Purpose → Co-sell → Cloud Provider
--   → Context Collection → File Validation → Enrichment → Generate Output → Deliver Results

UPDATE "workflow_versions"
SET graph = '{
  "nodes": [
    {
      "id": "trigger",
      "type": "TRIGGER",
      "position": { "x": 400, "y": 50 },
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
      "position": { "x": 400, "y": 180 },
      "data": {
        "type": "BUTTON_CHOICE",
        "label": "List Type",
        "description": "Ask the user what type of list they uploaded. Company lists show enrichment type options; Contact lists skip directly to purpose selection.",
        "prompt": "I detected your file — *{{fileName}}*\n\nWhat type of list is this?",
        "buttons": [
          { "id": "company", "label": "Company List", "value": "company", "style": "primary" },
          { "id": "contact", "label": "Contact List", "value": "contact" }
        ],
        "outputVariable": "listType"
      }
    },
    {
      "id": "enrich-type",
      "type": "BUTTON_CHOICE",
      "position": { "x": 200, "y": 320 },
      "data": {
        "type": "BUTTON_CHOICE",
        "label": "Enrichment Type",
        "description": "For company lists, ask what enrichment to perform. Technographics uses BuiltWith API, Contacts uses Apollo API, Both runs both sequentially.",
        "prompt": "What would you like me to do with this list?",
        "buttons": [
          { "id": "technographics", "label": "Get Technographics", "value": "technographic", "style": "primary" },
          { "id": "contacts", "label": "Get Contacts", "value": "contact" },
          { "id": "both", "label": "Get Both", "value": "combined" }
        ],
        "outputVariable": "enrichmentType"
      }
    },
    {
      "id": "purpose",
      "type": "BUTTON_CHOICE",
      "position": { "x": 600, "y": 320 },
      "data": {
        "type": "BUTTON_CHOICE",
        "label": "Purpose",
        "description": "Ask the user what the enriched list will be used for. This determines which contact fields (email, phone, LinkedIn) to prioritize in the output.",
        "prompt": "What is this list for?",
        "buttons": [
          { "id": "just_a_list", "label": "Just a List", "value": "JUST_A_LIST", "style": "primary" },
          { "id": "emailing", "label": "Email", "value": "EMAILING" },
          { "id": "cold_calling", "label": "Cold Call", "value": "COLD_CALLING" },
          { "id": "linkedin", "label": "LinkedIn", "value": "LINKEDIN" },
          { "id": "all", "label": "All", "value": "ALL" }
        ],
        "outputVariable": "purpose"
      }
    },
    {
      "id": "cosell",
      "type": "BUTTON_CHOICE",
      "position": { "x": 500, "y": 460 },
      "data": {
        "type": "BUTTON_CHOICE",
        "label": "Co-sell Check",
        "description": "Ask whether this is a co-sell list. If yes, the user will be asked to select a cloud provider (AWS, Azure, GCP). Co-sell metadata is stored with the job.",
        "prompt": "Is this a co-sell list?",
        "buttons": [
          { "id": "cosell_yes", "label": "Yes", "value": "yes" },
          { "id": "cosell_no", "label": "No", "value": "no" }
        ],
        "outputVariable": "isCosell"
      }
    },
    {
      "id": "cloud-provider",
      "type": "BUTTON_CHOICE",
      "position": { "x": 350, "y": 600 },
      "data": {
        "type": "BUTTON_CHOICE",
        "label": "Cloud Provider",
        "description": "For co-sell lists, ask which cloud provider the co-sell is for. This metadata is stored with the enrichment job for reporting.",
        "prompt": "Which cloud provider?",
        "buttons": [
          { "id": "aws", "label": "AWS", "value": "AWS" },
          { "id": "azure", "label": "Azure", "value": "Azure" },
          { "id": "gcp", "label": "GCP", "value": "GCP" },
          { "id": "other", "label": "Other", "value": "Other" }
        ],
        "outputVariable": "cosellProvider"
      }
    },
    {
      "id": "context",
      "type": "MESSAGE",
      "position": { "x": 650, "y": 600 },
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
      "position": { "x": 400, "y": 750 },
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
      "position": { "x": 400, "y": 880 },
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
      "position": { "x": 400, "y": 1010 },
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
      "position": { "x": 400, "y": 1140 },
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
  "viewport": { "x": 0, "y": 0, "zoom": 0.85 }
}'::jsonb,
updated_at = NOW()
WHERE id = '00000000-0000-4000-a000-000000000002';
