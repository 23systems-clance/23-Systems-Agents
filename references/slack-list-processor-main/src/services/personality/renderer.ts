/**
 * Renders personality analysis data as a self-contained HTML page
 * using the V2 Dark Analytics design.
 *
 * All CSS is inline — no external dependencies. The returned string
 * is a complete HTML document that can be served with Content-Type: text/html.
 */

import type {
  PersonalityAnalysisResponse,
  PersonalityContactMeta,
} from '../../types/personality.js';

/**
 * Escape HTML special characters to prevent XSS in rendered output.
 */
function esc(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build initials from a name string (e.g. "Satya Nadella" -> "SN").
 */
function initials(name: string | undefined | null): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join('');
}

/**
 * Convert a score (0-10) to a bar width percentage (0-100).
 */
function pct(score: number | undefined): string {
  return `${((score ?? 0) / 10) * 100}%`;
}

/**
 * Format a score to 2 decimal places.
 */
function fmt(score: number | undefined): string {
  return (score ?? 0).toFixed(2);
}

// ---------------------------------------------------------------------------
// CSS (exact replica of V2 Dark Analytics mockup)
// ---------------------------------------------------------------------------

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e4e4e7; line-height: 1.5; }

  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }

  /* Header */
  .header { background: linear-gradient(135deg, #1a1b2e 0%, #16182b 100%); border: 1px solid #2a2d3e; border-radius: 16px; padding: 28px 32px; margin-bottom: 16px; display: flex; align-items: center; gap: 20px; }
  .avatar { width: 64px; height: 64px; border-radius: 16px; background: linear-gradient(135deg, #6366f1, #a855f7); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 24px; font-weight: 700; flex-shrink: 0; }
  .header-info h1 { font-size: 22px; font-weight: 700; color: #f4f4f5; }
  .header-info .subtitle { font-size: 14px; color: #71717a; }
  .header-links { display: flex; gap: 12px; margin-top: 8px; }
  .header-links a { color: #818cf8; text-decoration: none; font-size: 12px; padding: 4px 10px; border: 1px solid #3730a3; border-radius: 6px; transition: all .15s; }
  .header-links a:hover { background: #3730a3; color: #fff; }
  .header-right { margin-left: auto; text-align: right; }
  .header-right .campaign-name { font-size: 13px; color: #a1a1aa; }
  .header-right .client-name { font-size: 12px; color: #52525b; }

  /* Grid */
  .grid-3 { display: grid; grid-template-columns: 260px 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .grid-full { margin-bottom: 16px; }

  /* Cards */
  .card { background: #1a1b2e; border: 1px solid #2a2d3e; border-radius: 14px; padding: 20px; }
  .card-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #52525b; margin-bottom: 14px; }

  /* Archetype */
  .archetype-card { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .archetype-ring { width: 120px; height: 120px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; position: relative; }
  .archetype-ring-inner { width: 100px; height: 100px; border-radius: 50%; background: #1a1b2e; display: flex; align-items: center; justify-content: center; flex-direction: column; }
  .archetype-ring-inner .score { font-size: 28px; font-weight: 800; color: #a78bfa; }
  .archetype-ring-inner .label { font-size: 10px; color: #71717a; }
  .archetype-name { font-size: 20px; font-weight: 700; color: #c4b5fd; }
  .archetype-desc { font-size: 12px; color: #52525b; margin-top: 4px; }

  /* Bar Charts */
  .bar-row { display: flex; align-items: center; margin-bottom: 10px; }
  .bar-row:last-child { margin-bottom: 0; }
  .bar-label { width: 22px; font-weight: 700; font-size: 13px; flex-shrink: 0; }
  .bar-name { width: 100px; font-size: 11px; color: #71717a; flex-shrink: 0; }
  .bar-track { flex: 1; height: 8px; background: #27272a; border-radius: 4px; overflow: hidden; margin-right: 10px; }
  .bar-fill { height: 100%; border-radius: 4px; }
  .bar-score { font-size: 13px; font-weight: 600; width: 36px; text-align: right; flex-shrink: 0; }
  .bar-level { font-size: 10px; color: #52525b; width: 60px; text-align: right; flex-shrink: 0; }

  /* DISC neon colors */
  .disc-d .bar-fill { background: #ef4444; box-shadow: 0 0 8px rgba(239,68,68,0.4); }
  .disc-d .bar-label, .disc-d .bar-score { color: #ef4444; }
  .disc-i .bar-fill { background: #eab308; box-shadow: 0 0 8px rgba(234,179,8,0.4); }
  .disc-i .bar-label, .disc-i .bar-score { color: #eab308; }
  .disc-s .bar-fill { background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,0.4); }
  .disc-s .bar-label, .disc-s .bar-score { color: #22c55e; }
  .disc-c .bar-fill { background: #3b82f6; box-shadow: 0 0 8px rgba(59,130,246,0.4); }
  .disc-c .bar-label, .disc-c .bar-score { color: #3b82f6; }

  /* OCEAN neon colors */
  .ocean-o .bar-fill { background: #a78bfa; box-shadow: 0 0 8px rgba(167,139,250,0.4); }
  .ocean-o .bar-label, .ocean-o .bar-score { color: #a78bfa; }
  .ocean-c .bar-fill { background: #22d3ee; box-shadow: 0 0 8px rgba(34,211,238,0.4); }
  .ocean-c .bar-label, .ocean-c .bar-score { color: #22d3ee; }
  .ocean-e .bar-fill { background: #fb923c; box-shadow: 0 0 8px rgba(251,146,60,0.4); }
  .ocean-e .bar-label, .ocean-e .bar-score { color: #fb923c; }
  .ocean-a .bar-fill { background: #f472b6; box-shadow: 0 0 8px rgba(244,114,182,0.4); }
  .ocean-a .bar-label, .ocean-a .bar-score { color: #f472b6; }
  .ocean-n .bar-fill { background: #2dd4bf; box-shadow: 0 0 8px rgba(45,212,191,0.4); }
  .ocean-n .bar-label, .ocean-n .bar-score { color: #2dd4bf; }

  /* Tags */
  .tag-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .tag { padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 500; }
  .tag-purple { background: #2e1065; color: #c4b5fd; border: 1px solid #3b0764; }

  /* Traits */
  .trait-row { display: flex; gap: 12px; margin-bottom: 12px; }
  .trait-row:last-child { margin-bottom: 0; }
  .trait-dot { width: 8px; height: 8px; border-radius: 50%; background: #6366f1; margin-top: 6px; flex-shrink: 0; }
  .trait-content .trait-label { font-size: 11px; color: #52525b; text-transform: uppercase; font-weight: 600; }
  .trait-content .trait-value { font-size: 13px; color: #d4d4d8; }

  /* Say / Avoid */
  .guidance-item { padding: 10px 14px; border-radius: 8px; margin-bottom: 8px; font-size: 13px; }
  .guidance-item:last-child { margin-bottom: 0; }
  .guidance-say { background: rgba(34,197,94,0.08); border-left: 3px solid #22c55e; color: #86efac; }
  .guidance-avoid { background: rgba(239,68,68,0.08); border-left: 3px solid #ef4444; color: #fca5a5; }

  /* Email Guide */
  .email-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .email-chip { background: #27272a; border: 1px solid #3f3f46; border-radius: 8px; padding: 8px 14px; }
  .email-chip-label { font-size: 10px; color: #52525b; text-transform: uppercase; font-weight: 600; }
  .email-chip-value { font-size: 12px; color: #d4d4d8; margin-top: 2px; }
`;

// ---------------------------------------------------------------------------
// Render function
// ---------------------------------------------------------------------------

/**
 * Render a complete standalone HTML page for a personality analysis result.
 *
 * @param data - Personality analysis response from AI ARK
 * @param meta - Optional app-specific context (campaign name, etc.)
 * @returns Complete HTML document string
 */
export function renderPersonalityHtml(
  data: PersonalityAnalysisResponse,
  meta?: PersonalityContactMeta,
): string {
  const name = esc(data.name) || 'Unknown Contact';
  const title = esc(data.title) || '';
  const company = esc(data.company) || '';
  const subtitle = [title, company].filter(Boolean).join(' at ');
  const linkedinUrl = data.linkedin_url || '#';
  const emailAddr = data.email || '#';

  const archetypeScore = data.archetype?.score ?? 0;
  const archetypePct = Math.min(archetypeScore, 100);

  const disc = data.disc;
  const ocean = data.ocean;
  const comms = data.communication_style;
  const traits = data.decision_traits;
  const emailGuide = data.email_approach;

  const enrichedDate = meta?.enrichedAt
    ? meta.enrichedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${name} | Personality Profile</title>
<style>${CSS}</style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div class="header">
    <div class="avatar">${initials(data.name)}</div>
    <div class="header-info">
      <h1>${name}</h1>
      ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ''}
      <div class="header-links">
        ${data.linkedin_url ? `<a href="${esc(linkedinUrl)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>` : ''}
        ${data.email ? `<a href="mailto:${esc(emailAddr)}">Email</a>` : ''}
      </div>
    </div>
    ${meta?.campaignName ? `
    <div class="header-right">
      <div class="campaign-name">${esc(meta.campaignName)}</div>
      ${meta.clientName ? `<div class="client-name">Client: ${esc(meta.clientName)}</div>` : ''}
    </div>` : ''}
  </div>

  <!-- Row 1: Archetype + DISC + OCEAN -->
  <div class="grid-3">
    <div class="card archetype-card">
      <div class="card-title">Archetype</div>
      <div class="archetype-ring" style="background: conic-gradient(#6366f1 0% ${archetypePct}%, #2a2d3e ${archetypePct}% 100%);">
        <div class="archetype-ring-inner">
          <span class="score">${archetypeScore}</span>
          <span class="label">SCORE</span>
        </div>
      </div>
      <div class="archetype-name">${esc(data.archetype?.name) || 'N/A'}</div>
      <div class="archetype-desc">${esc(data.archetype?.description) || ''}</div>
    </div>

    <div class="card">
      <div class="card-title">DISC Profile</div>
      <div class="bar-row disc-d">
        <span class="bar-label">D</span>
        <span class="bar-name">Dominance</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct(disc?.dominance?.score)}"></div></div>
        <span class="bar-score">${fmt(disc?.dominance?.score)}</span>
        <span class="bar-level">${esc(disc?.dominance?.level) || ''}</span>
      </div>
      <div class="bar-row disc-i">
        <span class="bar-label">I</span>
        <span class="bar-name">Influence</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct(disc?.influence?.score)}"></div></div>
        <span class="bar-score">${fmt(disc?.influence?.score)}</span>
        <span class="bar-level">${esc(disc?.influence?.level) || ''}</span>
      </div>
      <div class="bar-row disc-s">
        <span class="bar-label">S</span>
        <span class="bar-name">Steadiness</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct(disc?.steadiness?.score)}"></div></div>
        <span class="bar-score">${fmt(disc?.steadiness?.score)}</span>
        <span class="bar-level">${esc(disc?.steadiness?.level) || ''}</span>
      </div>
      <div class="bar-row disc-c">
        <span class="bar-label">C</span>
        <span class="bar-name">Calculativeness</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct(disc?.calculativeness?.score)}"></div></div>
        <span class="bar-score">${fmt(disc?.calculativeness?.score)}</span>
        <span class="bar-level">${esc(disc?.calculativeness?.level) || ''}</span>
      </div>
    </div>

    <div class="card">
      <div class="card-title">OCEAN / Big Five</div>
      <div class="bar-row ocean-o">
        <span class="bar-label">O</span>
        <span class="bar-name">Openness</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct(ocean?.openness?.score)}"></div></div>
        <span class="bar-score">${fmt(ocean?.openness?.score)}</span>
        <span class="bar-level">${esc(ocean?.openness?.level) || ''}</span>
      </div>
      <div class="bar-row ocean-c">
        <span class="bar-label">C</span>
        <span class="bar-name">Conscientious</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct(ocean?.conscientiousness?.score)}"></div></div>
        <span class="bar-score">${fmt(ocean?.conscientiousness?.score)}</span>
        <span class="bar-level">${esc(ocean?.conscientiousness?.level) || ''}</span>
      </div>
      <div class="bar-row ocean-e">
        <span class="bar-label">E</span>
        <span class="bar-name">Extraversion</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct(ocean?.extraversion?.score)}"></div></div>
        <span class="bar-score">${fmt(ocean?.extraversion?.score)}</span>
        <span class="bar-level">${esc(ocean?.extraversion?.level) || ''}</span>
      </div>
      <div class="bar-row ocean-a">
        <span class="bar-label">A</span>
        <span class="bar-name">Agreeableness</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct(ocean?.agreeableness?.score)}"></div></div>
        <span class="bar-score">${fmt(ocean?.agreeableness?.score)}</span>
        <span class="bar-level">${esc(ocean?.agreeableness?.level) || ''}</span>
      </div>
      <div class="bar-row ocean-n">
        <span class="bar-label">N</span>
        <span class="bar-name">Emo. Stability</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct(ocean?.emotional_stability?.score)}"></div></div>
        <span class="bar-score">${fmt(ocean?.emotional_stability?.score)}</span>
        <span class="bar-level">${esc(ocean?.emotional_stability?.level) || ''}</span>
      </div>
    </div>
  </div>

  <!-- Row 2: Communication + Traits -->
  <div class="grid-2">
    <div class="card">
      <div class="card-title">Communication Style</div>
      ${comms?.tags?.length ? `
      <div class="tag-row" style="margin-bottom:14px;">
        ${comms.tags.map((t) => `<span class="tag tag-purple">${esc(t)}</span>`).join('\n        ')}
      </div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <div style="font-size:11px;color:#52525b;margin-bottom:6px;font-weight:600;">WHAT TO SAY</div>
          ${(comms?.what_to_say ?? []).map((s) => `<div class="guidance-item guidance-say">${esc(s)}</div>`).join('\n          ')}
        </div>
        <div>
          <div style="font-size:11px;color:#52525b;margin-bottom:6px;font-weight:600;">WHAT TO AVOID</div>
          ${(comms?.what_to_avoid ?? []).map((s) => `<div class="guidance-item guidance-avoid">${esc(s)}</div>`).join('\n          ')}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Key Decision Traits</div>
      <div class="trait-row">
        <div class="trait-dot"></div>
        <div class="trait-content">
          <div class="trait-label">Risk Tolerance</div>
          <div class="trait-value">${esc(traits?.risk_tolerance) || 'N/A'}</div>
        </div>
      </div>
      <div class="trait-row">
        <div class="trait-dot" style="background:#eab308"></div>
        <div class="trait-content">
          <div class="trait-label">Ability to Say No</div>
          <div class="trait-value">${esc(traits?.ability_to_say_no) || 'N/A'}</div>
        </div>
      </div>
      <div class="trait-row">
        <div class="trait-dot" style="background:#22c55e"></div>
        <div class="trait-content">
          <div class="trait-label">Decision Speed</div>
          <div class="trait-value">${esc(traits?.decision_speed) || 'N/A'}</div>
        </div>
      </div>
      <div class="trait-row">
        <div class="trait-dot" style="background:#ef4444"></div>
        <div class="trait-content">
          <div class="trait-label">Decision Drivers</div>
          <div class="trait-value">${esc(traits?.decision_drivers) || 'N/A'}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Row 3: Email Guide -->
  <div class="grid-full">
    <div class="card">
      <div class="card-title">Email Approach Guide</div>
      <div class="email-chips">
        <div class="email-chip"><div class="email-chip-label">Tone</div><div class="email-chip-value">${esc(emailGuide?.tone) || 'N/A'}</div></div>
        <div class="email-chip"><div class="email-chip-label">Length</div><div class="email-chip-value">${esc(emailGuide?.length) || 'N/A'}</div></div>
        <div class="email-chip"><div class="email-chip-label">Greeting</div><div class="email-chip-value">${esc(emailGuide?.greeting) || 'N/A'}</div></div>
        <div class="email-chip"><div class="email-chip-label">Subject</div><div class="email-chip-value">${esc(emailGuide?.subject) || 'N/A'}</div></div>
        <div class="email-chip"><div class="email-chip-label">Messaging</div><div class="email-chip-value">${esc(emailGuide?.messaging) || 'N/A'}</div></div>
        <div class="email-chip"><div class="email-chip-label">Closing</div><div class="email-chip-value">${esc(emailGuide?.closing) || 'N/A'}</div></div>
        <div class="email-chip"><div class="email-chip-label">Bullet Points</div><div class="email-chip-value">${esc(emailGuide?.bullet_points) || 'N/A'}</div></div>
      </div>
    </div>
  </div>

  <div style="text-align:center;padding:12px;font-size:11px;color:#3f3f46;">
    AI Ark Personality Analysis &middot; Enriched ${enrichedDate}
  </div>
</div>
</body>
</html>`;
}
