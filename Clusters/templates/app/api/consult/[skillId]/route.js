import { NextResponse } from 'next/server';
import { z } from 'zod';

// ── Rate limiting (in-memory, per IP) ──
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX = 3;

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

// ── Disposable email blocklist ──
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
  'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la',
  'dispostable.com', 'trashmail.com', 'fakeinbox.com', 'temp-mail.org',
]);

function isDisposableEmail(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return DISPOSABLE_DOMAINS.has(domain);
}

export async function POST(request, { params }) {
  try {
    const { skillId } = await params;

    // Load skill config
    const { getPublicSkillConfig } = await import('23wf/skills/public');
    const skill = getPublicSkillConfig(skillId);

    if (!skill) {
      return NextResponse.json({ error: 'Skill not found or not public.' }, { status: 404 });
    }

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

    const systemPrompt = skill.config.systemPrompt
      || `You are an expert advisor. Given this profile, generate structured recommendations as JSON with "projectProfile" and "recommendations" arrays.`;

    const userPrompt = `Here is the project profile:\n\n${profileSummary}\n\nPersona mode: ${personaMode || 'simple'}\nInclude partner recommendations: ${wantsPartners ? 'yes' : 'no'}\n\nGenerate the recommendation JSON.`;

    // Single LLM call
    const { createModel } = await import('23wf/ai/model');
    const model = await createModel({ maxTokens: 2048 });

    const recommendationsSchema = z.object({
      projectProfile: z.object({
        name: z.string(),
        description: z.string(),
        stage: z.string().optional(),
        teamSize: z.string().optional(),
        timeline: z.string().optional(),
        scale: z.string().optional(),
        constraints: z.array(z.string()).optional(),
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
      ['system', systemPrompt],
      ['human', userPrompt],
    ]);

    // Store lead
    const { createLead } = await import('23wf/db/leads');
    const leadId = createLead({
      name: contactName.trim(),
      email: contactEmail.trim(),
      projectSummary: response.projectProfile?.description || '',
      conversationJson: projectProfile,
      recommendationsJson: response,
      personaMode: personaMode || 'simple',
      source: `consult-${skillId}`,
    });

    // Generate report if skill has a reportCommand
    let reportUrl = null;
    if (skill.config.reportCommand) {
      try {
        const { writeFileSync, mkdirSync, existsSync } = await import('fs');
        const { resolve } = await import('path');

        const reportsDir = resolve(process.cwd(), 'references/reports');
        if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

        const reportFilename = `${skillId}-report-${leadId}.json`;
        const reportPath = resolve(reportsDir, reportFilename);

        const reportData = {
          ...response,
          wantsPartners,
          contactName: contactName.trim(),
          contactEmail: contactEmail.trim(),
          generatedAt: new Date().toISOString(),
        };
        writeFileSync(reportPath, JSON.stringify(reportData, null, 2));

        // Try to run the report command
        const htmlFilename = `${skillId}-report-${leadId}.html`;
        const htmlPath = resolve(reportsDir, htmlFilename);

        const cmd = skill.config.reportCommand
          .replace('{{recommendations}}', reportPath)
          .replace('{{includePartners}}', wantsPartners ? 'true' : 'false')
          .replace('{{output}}', htmlPath);

        const { execSync } = await import('child_process');
        const scriptFile = cmd.split(' ')[1];
        if (existsSync(resolve(process.cwd(), scriptFile))) {
          try {
            execSync(cmd, { timeout: 15000, cwd: process.cwd() });
            reportUrl = `/api/consult/report/${leadId}`;
          } catch {
            reportUrl = null;
          }
        }
      } catch {
        // Non-critical
      }
    }

    return NextResponse.json({
      success: true,
      recommendations: response.recommendations,
      projectProfile: response.projectProfile,
      reportUrl,
      leadId,
    });
  } catch (err) {
    console.error(`[consult/${(await params).skillId}] Error:`, err);
    return NextResponse.json(
      { error: 'Failed to generate recommendations. Please try again.' },
      { status: 500 }
    );
  }
}
