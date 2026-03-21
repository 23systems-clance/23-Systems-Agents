import { NextResponse } from 'next/server';
import { z } from 'zod';

// ── Rate limiting (in-memory, per IP) ──
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_MAX = 3; // 3 requests per IP per day

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ── Disposable email blocklist (common domains) ──
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
  'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la',
  'dispostable.com', 'trashmail.com', 'fakeinbox.com', 'temp-mail.org',
]);

function isDisposableEmail(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return DISPOSABLE_DOMAINS.has(domain);
}

// ── LLM prompt ──
const SYSTEM_PROMPT = `You are a senior solutions architect for 23 Systems. Given a project profile collected from a prospective client, generate technology stack recommendations.

Respond with a JSON object matching this exact structure:
{
  "projectProfile": {
    "name": "short project name",
    "description": "one-paragraph summary of what they're building",
    "stage": "mvp" | "production" | "unsure" | "migration",
    "teamSize": "solo" | "small_team" | "large_team" | "no_team" | free text,
    "timeline": "weeks" | "months" | "long" | "ongoing",
    "scale": "brief scale description",
    "constraints": ["array of constraints"],
    "calendarUrl": "https://cal.com/23systems"
  },
  "recommendations": [
    {
      "category": "Frontend" | "Backend" | "Database" | "Hosting / Infra" | "Auth" | "Payments" | "DevOps / CI" | "Monitoring",
      "recommendation": "specific technology name",
      "confidence": 0.0-1.0,
      "why": "one sentence reasoning",
      "alternatives": ["alt1", "alt2"],
      "tradeoffs": "one sentence tradeoff"
    }
  ]
}

Cover all 8 categories. Skip categories that don't apply (e.g. Payments for non-transactional projects). Be specific — name exact technologies, not generic categories. Confidence reflects how strongly you recommend this choice given the constraints.`;

export async function POST(request) {
  try {
    // Rate limit by IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again tomorrow.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { projectProfile, contactName, contactEmail, personaMode, wantsPartners } = body;

    // Validate required fields
    if (!projectProfile || !contactName?.trim() || !contactEmail?.trim()) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(contactEmail)) {
      return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
    }
    if (isDisposableEmail(contactEmail)) {
      return NextResponse.json({ error: 'Please use a non-disposable email address.' }, { status: 400 });
    }

    // Build LLM prompt from profile
    const profileSummary = Object.entries(projectProfile)
      .filter(([, v]) => v && v !== '')
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    const userPrompt = `Here is the project profile:\n\n${profileSummary}\n\nPersona mode: ${personaMode || 'simple'}\nInclude partner recommendations: ${wantsPartners ? 'yes' : 'no'}\n\nGenerate the tech stack recommendation JSON.`;

    // Single LLM call
    const { createModel } = await import('23wf/ai/model');
    const model = await createModel({ maxTokens: 2048 });

    const recommendationsSchema = z.object({
      projectProfile: z.object({
        name: z.string(),
        description: z.string(),
        stage: z.string(),
        teamSize: z.string(),
        timeline: z.string(),
        scale: z.string(),
        constraints: z.array(z.string()),
        calendarUrl: z.string().optional(),
      }),
      recommendations: z.array(z.object({
        category: z.string(),
        recommendation: z.string(),
        confidence: z.number(),
        why: z.string(),
        alternatives: z.array(z.string()),
        tradeoffs: z.string(),
      })),
    });

    const response = await model.withStructuredOutput(recommendationsSchema).invoke([
      ['system', SYSTEM_PROMPT],
      ['human', userPrompt],
    ]);

    // Store lead in database
    const { createLead } = await import('23wf/db/leads');
    const leadId = createLead({
      name: contactName.trim(),
      email: contactEmail.trim(),
      projectSummary: response.projectProfile?.description || '',
      conversationJson: projectProfile,
      recommendationsJson: response,
      personaMode: personaMode || 'simple',
      source: 'consult-page',
    });

    // Generate report
    let reportUrl = null;
    try {
      const { writeFileSync, mkdirSync, existsSync } = await import('fs');
      const { resolve } = await import('path');

      const reportsDir = resolve(process.cwd(), 'references/reports');
      if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

      const reportFilename = `tech-stack-report-${leadId}.json`;
      const reportPath = resolve(reportsDir, reportFilename);

      // Write recommendations JSON (report generation script can pick this up)
      const reportData = {
        ...response,
        wantsPartners,
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        generatedAt: new Date().toISOString(),
      };
      writeFileSync(reportPath, JSON.stringify(reportData, null, 2));

      // Try to generate HTML report
      const { execSync } = await import('child_process');
      const htmlFilename = `tech-stack-report-${leadId}.html`;
      const htmlPath = resolve(reportsDir, htmlFilename);
      const scriptPath = resolve(process.cwd(), 'skills/tech-stack-advisor/generate-report.js');

      if (existsSync(scriptPath)) {
        try {
          execSync(
            `node "${scriptPath}" --recommendations "${reportPath}" --include-partners ${wantsPartners ? 'true' : 'false'} --output "${htmlPath}"`,
            { timeout: 15000 }
          );
          reportUrl = `/api/consult/report/${leadId}`;
        } catch {
          // Report generation failed — still return recommendations
          reportUrl = null;
        }
      }
    } catch {
      // Non-critical — lead is stored, recommendations generated
    }

    return NextResponse.json({
      success: true,
      recommendations: response.recommendations,
      projectProfile: response.projectProfile,
      reportUrl,
      leadId,
    });
  } catch (err) {
    console.error('[consult] Error:', err);
    return NextResponse.json(
      { error: 'Failed to generate recommendations. Please try again.' },
      { status: 500 }
    );
  }
}
