#!/usr/bin/env node

/**
 * Tech Stack Report Generator
 *
 * Takes a project profile + recommendations JSON and populates the
 * tech-stack-report.html template to produce a branded HTML report.
 *
 * Usage:
 *   node generate-report.js \
 *     --recommendations recommendations.json \
 *     --include-partners true \
 *     --output references/reports/tech-stack-report-abc123.html
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, '../../references/SOP Templates/tech-stack-report.html');
const PARTNERS_PATH = resolve(__dirname, 'partners.json');

const { values: args } = parseArgs({
  options: {
    recommendations: { type: 'string' },
    'include-partners': { type: 'string', default: 'false' },
    output: { type: 'string' },
  },
});

function loadJSON(path) {
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function formatDate() {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function stageLabel(stage) {
  const labels = { mvp: 'MVP', production: 'Production', unsure: 'TBD', migration: 'POC → Prod' };
  return labels[stage] || stage;
}

function teamLabel(team) {
  if (typeof team === 'string' && !['solo', 'small_team', 'large_team', 'no_team'].includes(team)) {
    return team; // free-text answer from dev mode
  }
  const labels = { solo: 'Solo Dev', small_team: 'Small (2-5)', large_team: 'Large (6+)', no_team: 'No Team Yet' };
  return labels[team] || team;
}

function timelineLabel(timeline) {
  const labels = { weeks: 'Weeks', months: '1-3 Months', long: '6+ Months', ongoing: 'Ongoing' };
  return labels[timeline] || timeline;
}

function confidenceDisplay(confidence) {
  const pct = Math.round(confidence * 100);
  return `${pct}% confidence`;
}

function generateStackCards(recommendations) {
  return recommendations
    .map((rec) => {
      const altsHtml = (rec.alternatives || [])
        .map((alt) => `<span>${alt}</span>`)
        .join(' ');

      const tradeoffHtml = rec.tradeoffs
        ? `<div class="card-tradeoff">${rec.tradeoffs}</div>`
        : '';

      return `
        <div class="stack-card">
          <div class="card-category">${rec.category}</div>
          <div class="card-title">${rec.recommendation}</div>
          <div class="card-confidence">${confidenceDisplay(rec.confidence)}</div>
          <div class="card-why">${rec.why}</div>
          ${altsHtml ? `<div class="card-alts">Alternatives: ${altsHtml}</div>` : ''}
          ${tradeoffHtml}
        </div>`;
    })
    .join('\n');
}

function generateAlternativesRows(recommendations) {
  return recommendations
    .map((rec) => {
      const alts = (rec.alternatives || []).join(', ') || 'N/A';
      const tradeoff = rec.tradeoffs || 'N/A';
      return `
          <tr>
            <td><strong>${rec.category}</strong></td>
            <td>${rec.recommendation}</td>
            <td>${alts}</td>
            <td>${tradeoff}</td>
          </tr>`;
    })
    .join('\n');
}

function generatePartnerCards(matchedPartners) {
  return matchedPartners
    .map((p) => {
      return `
        <div class="partner-card">
          <div class="partner-type">${p.type.replace(/_/g, ' ')}</div>
          <div class="partner-name">${p.name}</div>
          <div class="partner-value">${p.value}</div>
          <div class="partner-desc">${p.description}</div>
        </div>`;
    })
    .join('\n');
}

function matchPartners(recommendations, allPartners) {
  const recTechnologies = recommendations
    .map((r) => r.recommendation.toLowerCase())
    .join(' ');

  return allPartners.filter((partner) =>
    partner.matchStacks.some(
      (stack) =>
        recTechnologies.includes(stack.toLowerCase()) ||
        recommendations.some((r) =>
          r.recommendation.toLowerCase().includes(stack.toLowerCase())
        )
    )
  );
}

function calculatePartnerValue(partners) {
  const values = partners
    .map((p) => p.value)
    .filter((v) => v.includes('$'));
  if (values.length === 0) return 'Significant savings available';
  return `${values.length} programs with credits and resources`;
}

function generateArchitectureDiagram(recommendations) {
  const frontend = recommendations.find((r) => r.category === 'Frontend');
  const backend = recommendations.find((r) => r.category === 'Backend');
  const database = recommendations.find((r) => r.category === 'Database');
  const hosting = recommendations.find((r) => r.category === 'Hosting / Infra');
  const auth = recommendations.find((r) => r.category === 'Auth');
  const monitoring = recommendations.find((r) => r.category === 'Monitoring');

  const fe = frontend ? frontend.recommendation : 'Frontend';
  const be = backend ? backend.recommendation : 'Backend';
  const db = database ? database.recommendation : 'Database';
  const host = hosting ? hosting.recommendation : 'Hosting';
  const authName = auth ? auth.recommendation : 'Auth';
  const mon = monitoring ? monitoring.recommendation : 'Monitoring';

  return `
┌─────────────────────────────────────────────────────────┐
│  Client                                                 │
│  ┌───────────────────┐                                  │
│  │  ${fe.padEnd(18)}│                                  │
│  └────────┬──────────┘                                  │
│           │ HTTPS                                       │
├───────────┼─────────────────────────────────────────────┤
│  Server   │                                             │
│  ┌────────▼──────────┐    ┌─────────────────┐          │
│  │  ${be.padEnd(18)}│───▶│  ${db.padEnd(14)}│          │
│  └────────┬──────────┘    └─────────────────┘          │
│           │                                             │
│  ┌────────▼──────────┐    ┌─────────────────┐          │
│  │  ${authName.padEnd(18)}│    │  ${mon.padEnd(14)}│          │
│  └───────────────────┘    └─────────────────┘          │
│                                                         │
│  Hosted on: ${host.padEnd(44)}│
└─────────────────────────────────────────────────────────┘`.trim();
}

// ── Main ──

const recsData = loadJSON(resolve(args.recommendations));
const includePartners = args['include-partners'] === 'true';

const profile = recsData.projectProfile || {};
const recommendations = recsData.recommendations || [];

let template = readFileSync(TEMPLATE_PATH, 'utf-8');

// Basic replacements
template = template.replace(/\{\{PROJECT_NAME\}\}/g, profile.name || 'Your Project');
template = template.replace(/\{\{PROJECT_SUMMARY\}\}/g, profile.description || profile.name || '');
template = template.replace(/\{\{PROJECT_DESCRIPTION\}\}/g, profile.description || '');
template = template.replace(/\{\{DATE\}\}/g, formatDate());
template = template.replace(/\{\{PROJECT_STAGE\}\}/g, stageLabel(profile.stage));
template = template.replace(/\{\{TEAM_SIZE\}\}/g, teamLabel(profile.teamSize));
template = template.replace(/\{\{TIMELINE\}\}/g, timelineLabel(profile.timeline));
template = template.replace(/\{\{SCALE\}\}/g, profile.scale || 'TBD');
template = template.replace(/\{\{CALENDAR_URL\}\}/g, profile.calendarUrl || '#');

// Stack cards
template = template.replace('<!-- {{STACK_CARDS}} -->', generateStackCards(recommendations));

// Architecture diagram
template = template.replace('{{ARCHITECTURE_DIAGRAM}}', generateArchitectureDiagram(recommendations));

// Alternatives table
template = template.replace('<!-- {{ALTERNATIVES_TABLE_ROWS}} -->', generateAlternativesRows(recommendations));

// Constraints section
if (profile.constraints && profile.constraints.length > 0) {
  const constraintsList = profile.constraints
    .map((c) => `<li>${c}</li>`)
    .join('\n');
  template = template.replace(
    '<!-- {{CONSTRAINTS_SECTION}} -->',
    `<div class="sub-header">Constraints</div>\n<ul>\n${constraintsList}\n</ul>`
  );
} else {
  template = template.replace('<!-- {{CONSTRAINTS_SECTION}} -->', '');
}

// Partners section (conditional)
if (includePartners) {
  const allPartners = loadJSON(PARTNERS_PATH);
  const matched = recsData.matchedPartners || matchPartners(recommendations, allPartners);

  if (matched.length > 0) {
    template = template.replace('<!-- {{PARTNER_NAV}} -->', '<a href="#s5"><span class="num">5</span> Partners &amp; Resources</a>');
    template = template.replace('<!-- {{PARTNERS_SECTION_START}} -->', '');
    template = template.replace('<!-- {{PARTNERS_SECTION_END}} -->', '');
    template = template.replace('<!-- {{PARTNER_CARDS}} -->', generatePartnerCards(matched));
    template = template.replace('{{TOTAL_PARTNER_VALUE}}', calculatePartnerValue(matched));
  } else {
    // No matched partners — remove the section
    template = template.replace('<!-- {{PARTNER_NAV}} -->', '');
    template = template.replace(/<!-- \{\{PARTNERS_SECTION_START\}\} -->[\s\S]*?<!-- \{\{PARTNERS_SECTION_END\}\} -->/, '');
  }
} else {
  template = template.replace('<!-- {{PARTNER_NAV}} -->', '');
  template = template.replace(/<!-- \{\{PARTNERS_SECTION_START\}\} -->[\s\S]*?<!-- \{\{PARTNERS_SECTION_END\}\} -->/, '');
}

// Architecture notes
template = template.replace('<!-- {{ARCHITECTURE_NOTES}} -->', '');

// Write output
const outputPath = resolve(args.output);
writeFileSync(outputPath, template, 'utf-8');
console.log(`Report generated: ${outputPath}`);
