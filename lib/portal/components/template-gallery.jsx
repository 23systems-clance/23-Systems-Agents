'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { matchTemplate } from '../actions.js';

const ICON_MAP = {
  search: SearchIcon,
  pencil: PencilIcon,
  eye: EyeIcon,
  database: DatabaseIcon,
  code: CodeIcon,
  headphones: HeadphonesIcon,
  briefcase: BriefcaseIcon,
  bar_chart: BarChartIcon,
};

const CATEGORY_LABELS = {
  all: 'All',
  research: 'Research',
  content: 'Content',
  data: 'Data',
  development: 'Development',
  support: 'Support',
  marketing: 'Marketing',
};

export function TemplateGallery({ templates }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [describe, setDescribe] = useState('');
  const [matching, setMatching] = useState(false);
  const [matchResult, setMatchResult] = useState(null);

  const categories = ['all', ...new Set(templates.map(t => t.category).filter(Boolean))];

  const filtered = templates.filter(t => {
    const matchesSearch = !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = category === 'all' || t.category === category;
    return matchesSearch && matchesCategory;
  });

  const handleDescribe = async (e) => {
    e.preventDefault();
    if (!describe.trim() || matching) return;
    setMatching(true);
    setMatchResult(null);
    try {
      const result = await matchTemplate(describe);
      if (result.templateId && result.confidence !== 'low') {
        // Build query params with suggested inputs
        const params = new URLSearchParams({ template: result.templateId });
        for (const [key, value] of Object.entries(result.suggestedInputs || {})) {
          if (value) params.set(`input_${key}`, value);
        }
        setMatchResult(result);
        // Auto-navigate after a brief moment so user sees the match
        setTimeout(() => router.push(`/team/new?${params.toString()}`), 800);
      } else {
        setMatchResult({ ...result, templateId: null });
      }
    } catch {
      setMatchResult({ templateId: null, reason: 'Something went wrong. Try picking a template instead.' });
    }
    setMatching(false);
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
        <p className="text-muted-foreground mt-1">
          Pre-built agent teams ready to deploy. Pick one, or describe what you need.
        </p>
      </div>

      {/* Describe what you need */}
      <form onSubmit={handleDescribe} className="mb-8">
        <div className="rounded-xl border border-border p-4 bg-muted/30">
          <label className="block text-sm font-medium mb-2">
            Or describe what you need in plain English
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              value={describe}
              onChange={e => setDescribe(e.target.value)}
              placeholder="e.g., I need someone to research my competitors and write a report"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={!describe.trim() || matching}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {matching ? 'Finding...' : 'Find a Match'}
            </button>
          </div>
          {matchResult && (
            <div className={`mt-3 text-sm ${matchResult.templateId ? 'text-green-600' : 'text-muted-foreground'}`}>
              {matchResult.templateId ? (
                <>
                  Matched: <strong>{templates.find(t => t.id === matchResult.templateId)?.name}</strong>
                  {' '}&mdash; {matchResult.reason}. Redirecting...
                </>
              ) : (
                <>
                  {matchResult.reason} Try picking a template below instead.
                </>
              )}
            </div>
          )}
        </div>
      </form>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Filter templates..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex gap-1 flex-wrap">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                category === cat
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {CATEGORY_LABELS[cat] || cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(template => (
          <TemplateCard key={template.id} template={template} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No templates match your search.
        </div>
      )}
    </div>
  );
}

function TemplateCard({ template }) {
  const Icon = ICON_MAP[template.icon] || SearchIcon;
  const roleCount = template.cluster?.roles?.length || 0;

  return (
    <Link
      href={`/team/new?template=${template.id}`}
      className="group block rounded-xl border border-border p-5 transition-all hover:border-primary/50 hover:shadow-md"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm group-hover:text-primary transition-colors">
            {template.name}
          </h3>
          <span className="text-xs text-muted-foreground capitalize">
            {template.category}
          </span>
        </div>
      </div>

      <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
        {template.description}
      </p>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>{roleCount} team member{roleCount !== 1 ? 's' : ''}</span>
        <span>{template.estimatedTime}</span>
        <span className={`px-1.5 py-0.5 rounded ${
          template.difficulty === 'beginner' ? 'bg-green-500/10 text-green-600' :
          template.difficulty === 'intermediate' ? 'bg-yellow-500/10 text-yellow-600' :
          'bg-red-500/10 text-red-600'
        }`}>
          {template.difficulty}
        </span>
      </div>
    </Link>
  );
}

// ── Inline SVG Icons ───────────────────────────────────

function SearchIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function PencilIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function EyeIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function DatabaseIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

function CodeIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16,18 22,12 16,6" /><polyline points="8,6 2,12 8,18" />
    </svg>
  );
}

function HeadphonesIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

function BriefcaseIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="14" x="2" y="7" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function BarChartIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  );
}
