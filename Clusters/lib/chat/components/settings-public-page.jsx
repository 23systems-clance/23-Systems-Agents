'use client';

import { useState, useEffect } from 'react';
import { getPublicSkillsList, toggleSkillPublic } from '../actions.js';
import { GlobeIcon, ExternalLinkIcon, CheckIcon, XIcon, SpinnerIcon } from './icons.js';

function Section({ title, description, children }) {
  return (
    <div className="pb-8 mb-8 border-b border-border last:border-b-0 last:pb-0 last:mb-0">
      <h2 className="text-base font-medium mb-1">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground mb-4">{description}</p>
      )}
      {children}
    </div>
  );
}

function SkillRow({ skill, onToggle }) {
  const [busy, setBusy] = useState(false);

  const handleToggle = async () => {
    setBusy(true);
    try {
      await onToggle(skill.skillId, !skill.isPublic);
    } finally {
      setBusy(false);
    }
  };

  const ready = skill.isPublic && skill.hasTree && skill.hasConfig;

  return (
    <div className="flex items-center justify-between gap-4 py-3 px-4 rounded-lg border border-border">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
          skill.isPublic ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'
        }`}>
          <GlobeIcon size={14} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{skill.name}</span>
            {skill.isPublic && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                ready ? 'bg-emerald-500/10 text-emerald-500' : 'bg-yellow-500/10 text-yellow-500'
              }`}>
                {ready ? 'Live' : 'Incomplete'}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">{skill.description}</p>
          {skill.isPublic && !skill.hasTree && (
            <p className="text-xs text-yellow-500 mt-0.5">Missing conversation-tree.json</p>
          )}
          {skill.isPublic && !skill.hasConfig && (
            <p className="text-xs text-yellow-500 mt-0.5">Missing public-config.json</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {skill.isPublic && ready && (
          <a
            href={`/consult/${skill.skillId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLinkIcon size={12} />
            Preview
          </a>
        )}
        <button
          type="button"
          onClick={handleToggle}
          disabled={busy}
          className="inline-flex items-center gap-2 group disabled:opacity-50 shrink-0"
          role="switch"
          aria-checked={skill.isPublic}
        >
          <span
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
              skill.isPublic ? 'bg-primary' : 'bg-muted-foreground/30'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                skill.isPublic ? 'translate-x-4' : ''
              }`}
            />
          </span>
        </button>
      </div>
    </div>
  );
}

export function SettingsPublicPage() {
  const [skills, setSkills] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchSkills = () => {
    getPublicSkillsList()
      .then(setSkills)
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchSkills(); }, []);

  const handleToggle = async (skillId, makePublic) => {
    const result = await toggleSkillPublic(skillId, makePublic);
    if (result.success) {
      fetchSkills();
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-border/50" />
        ))}
      </div>
    );
  }

  const publicSkills = (skills || []).filter(s => s.isPublic);
  const privateSkills = (skills || []).filter(s => !s.isPublic);

  return (
    <>
      <p className="text-sm text-muted-foreground mb-6">
        Manage which skills are accessible as public consultation pages. Public skills get a landing page at <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">/consult/skill-id</code> — no login required.
      </p>

      <Section
        title="Public Consultations"
        description={publicSkills.length > 0
          ? `${publicSkills.length} skill${publicSkills.length !== 1 ? 's' : ''} published. The directory is live at /consult.`
          : 'No skills are currently public. Toggle a skill below to publish it.'
        }
      >
        {publicSkills.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            <a
              href="/consult"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline w-fit"
            >
              <GlobeIcon size={14} />
              View public directory
              <ExternalLinkIcon size={12} />
            </a>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {publicSkills.map((skill) => (
            <SkillRow key={skill.skillId} skill={skill} onToggle={handleToggle} />
          ))}
        </div>
      </Section>

      {privateSkills.length > 0 && (
        <Section
          title="Available Skills"
          description="These skills can be made public. They need a conversation-tree.json and public-config.json to be fully functional."
        >
          <div className="flex flex-col gap-2">
            {privateSkills.map((skill) => (
              <SkillRow key={skill.skillId} skill={skill} onToggle={handleToggle} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
