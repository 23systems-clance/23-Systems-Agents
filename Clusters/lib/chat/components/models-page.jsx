'use client';

import { useState, useEffect } from 'react';
import { WrenchIcon, SpinnerIcon, ChevronDownIcon, CheckIcon, XIcon } from './icons.js';
import { getModelInventory } from '../actions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Badges
// ─────────────────────────────────────────────────────────────────────────────

const providerBadgeStyles = {
  anthropic: 'bg-orange-500/10 text-orange-500',
  openai: 'bg-green-500/10 text-green-500',
  google: 'bg-blue-500/10 text-blue-500',
  custom: 'bg-purple-500/10 text-purple-500',
};

const sourceBadgeStyles = {
  cron: 'bg-purple-500/10 text-purple-500',
  trigger: 'bg-orange-500/10 text-orange-500',
};

// ─────────────────────────────────────────────────────────────────────────────
// Section
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, description, children }) {
  return (
    <div className="pb-6 mb-6 border-b border-border last:border-b-0">
      <h2 className="text-base font-medium mb-1">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground mb-4">{description}</p>
      )}
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Override Card
// ─────────────────────────────────────────────────────────────────────────────

function OverrideCard({ override, defaultProvider, defaultModels }) {
  const provider = override.provider || defaultProvider;
  const model = override.model || defaultModels[provider] || '(default)';

  return (
    <div className={`rounded-lg border bg-card transition-opacity ${!override.enabled ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-3 p-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{override.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{model}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${providerBadgeStyles[provider] || providerBadgeStyles.custom}`}>
            {provider}
          </span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${sourceBadgeStyles[override.source]}`}>
            {override.source}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
              override.enabled ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground'
            }`}
          >
            {override.enabled ? 'enabled' : 'disabled'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export function ModelsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getModelInventory()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-border/50" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <WrenchIcon size={24} />
        </div>
        <p className="text-sm font-medium mb-1">Could not load model configuration</p>
      </div>
    );
  }

  const { eventHandler, cronOverrides, triggerOverrides, defaultModels, uniqueModels } = data;
  const overrides = [...cronOverrides, ...triggerOverrides];

  return (
    <>
      <p className="text-sm text-muted-foreground mb-6">
        {uniqueModels.length} unique model{uniqueModels.length !== 1 ? 's' : ''} configured across {1 + overrides.length} location{overrides.length !== 0 ? 's' : ''}
      </p>

      {/* Event Handler (primary) */}
      <Section
        title="Event Handler"
        description="Primary model used for chat, job planning, titles, and summaries. Configured via .env variables."
      >
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="shrink-0 rounded-md bg-muted p-2">
              <WrenchIcon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Primary Model</p>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">{eventHandler.model}</p>
            </div>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${providerBadgeStyles[eventHandler.provider] || providerBadgeStyles.custom}`}>
              {eventHandler.provider}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">API Key:</span>
              {eventHandler.hasApiKey ? (
                <span className="inline-flex items-center gap-1 text-green-500"><CheckIcon size={12} /> configured</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-red-500"><XIcon size={12} /> missing</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Max tokens:</span>
              <span className="font-mono">{eventHandler.maxTokens.toLocaleString()}</span>
            </div>
            {eventHandler.baseUrl && (
              <div className="col-span-2 flex items-center gap-2">
                <span className="text-muted-foreground">Base URL:</span>
                <span className="font-mono truncate">{eventHandler.baseUrl}</span>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* Per-job overrides */}
      <Section
        title="Per-Job Overrides"
        description="Crons and triggers with custom model settings. These override the primary model when their jobs run."
      >
        {overrides.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No overrides configured. All jobs use the primary model.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Add <span className="font-mono">llm_provider</span> or <span className="font-mono">llm_model</span> to cron/trigger entries to override.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {overrides.map((o, i) => (
              <OverrideCard
                key={`${o.source}-${i}`}
                override={o}
                defaultProvider={eventHandler.provider}
                defaultModels={defaultModels}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Unique models summary */}
      <Section
        title="Model Summary"
        description="All unique models in use. When a model is deprecated, check each location listed above."
      >
        <div className="flex flex-wrap gap-2">
          {uniqueModels.map((m) => {
            const [prov, ...rest] = m.split('/');
            const modelName = rest.join('/');
            return (
              <div key={m} className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${providerBadgeStyles[prov] || providerBadgeStyles.custom}`}>
                  {prov}
                </span>
                <span className="text-xs font-mono">{modelName}</span>
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}
