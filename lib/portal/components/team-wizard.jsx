'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createTeamFromTemplate } from '../actions.js';
import { SCHEDULE_PRESETS, DAYS_OF_WEEK, getNextRuns, humanToCron } from '../schedule.js';

/**
 * 3-step wizard for creating a team from a template.
 *
 * Step 1: Template already selected (via URL param) — skip to Step 2
 * Step 2: Customize — fill in template inputs
 * Step 3: Schedule & Launch
 */
export function TeamWizard({ template, prefilled = {} }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [inputs, setInputs] = useState(() => {
    const defaults = {};
    for (const input of template.inputs) {
      // Prefilled values from LLM matcher take priority over defaults
      defaults[input.id] = prefilled[input.id] || input.default || '';
    }
    return defaults;
  });
  const [schedule, setSchedule] = useState({ preset: 'now' });
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const updateInput = (id, value) => {
    setInputs(prev => ({ ...prev, [id]: value }));
  };

  const handleLaunch = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await createTeamFromTemplate(template.id, inputs, schedule, { requiresApproval });
      if (result.success) {
        router.push(`/team/${result.teamId}`);
      } else {
        setError(result.error || 'Something went wrong');
        setLoading(false);
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const canProceed = template.inputs
    .filter(i => i.required)
    .every(i => inputs[i.id] && inputs[i.id].toString().trim());

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress */}
      <div className="flex items-center gap-2 mb-8">
        <StepDot active={step >= 1} label="1. Customize" />
        <div className="flex-1 h-px bg-border" />
        <StepDot active={step >= 2} label="2. Launch" />
      </div>

      {/* Template Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{template.name}</h1>
        <p className="text-muted-foreground mt-1">{template.description}</p>
      </div>

      {step === 1 && (
        <div>
          {/* Input Fields */}
          <div className="space-y-5 mb-8">
            {template.inputs.map(input => (
              <InputField
                key={input.id}
                input={input}
                value={inputs[input.id]}
                onChange={value => updateInput(input.id, value)}
              />
            ))}
          </div>

          {/* Team Members Preview */}
          <div className="border border-border rounded-xl p-4 mb-8">
            <h3 className="text-sm font-medium mb-3">Team Members</h3>
            <div className="space-y-2">
              {template.cluster.roles.map((role, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    role.dependsOn ? 'bg-muted-foreground' : 'bg-primary'
                  }`} />
                  <span className="text-sm font-medium">{role.roleName}</span>
                  <span className="text-xs text-muted-foreground">
                    {role.role.substring(0, 60)}...
                  </span>
                  {role.dependsOn && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      after {role.dependsOn}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              disabled={!canProceed}
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          {/* Schedule Picker */}
          <div className="mb-8">
            <h3 className="text-sm font-medium mb-3">When should this run?</h3>
            <div className="space-y-2">
              {SCHEDULE_PRESETS.filter(p => !p.advanced).map(preset => (
                <label
                  key={preset.id}
                  className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    schedule.preset === preset.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/30'
                  }`}
                >
                  <input
                    type="radio"
                    name="schedule"
                    value={preset.id}
                    checked={schedule.preset === preset.id}
                    onChange={() => setSchedule({ ...schedule, preset: preset.id })}
                    className="accent-primary"
                  />
                  <span className="text-sm">{preset.label}</span>
                </label>
              ))}
            </div>

            {/* Time picker for configurable presets */}
            {schedule.preset && SCHEDULE_PRESETS.find(p => p.id === schedule.preset)?.configurable && (
              <div className="mt-4 flex gap-3">
                {SCHEDULE_PRESETS.find(p => p.id === schedule.preset)?.configurable?.day && (
                  <select
                    value={schedule.dayOfWeek ?? 1}
                    onChange={e => setSchedule({ ...schedule, dayOfWeek: Number(e.target.value) })}
                    className="rounded-lg border border-border bg-input px-3 py-2 text-sm"
                  >
                    {DAYS_OF_WEEK.map(d => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                )}
                {SCHEDULE_PRESETS.find(p => p.id === schedule.preset)?.configurable?.time && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">at</span>
                    <select
                      value={schedule.hour ?? 9}
                      onChange={e => setSchedule({ ...schedule, hour: Number(e.target.value) })}
                      className="rounded-lg border border-border bg-input px-3 py-2 text-sm"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>
                          {i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Next runs preview */}
            {schedule.preset && schedule.preset !== 'now' && (
              <div className="mt-4 text-xs text-muted-foreground">
                <span className="font-medium">Next runs: </span>
                {(() => {
                  const { cron } = humanToCron(schedule);
                  if (!cron) return 'N/A';
                  const runs = getNextRuns(cron, 3);
                  return runs.map(d =>
                    d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  ).join(' / ') || 'Calculating...';
                })()}
              </div>
            )}
          </div>

          {/* Human Review Toggle */}
          <div className="mb-8">
            <label className="flex items-start gap-3 rounded-lg border border-border p-4 cursor-pointer hover:border-primary/30 transition-colors">
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={e => setRequiresApproval(e.target.checked)}
                className="accent-primary mt-0.5"
              />
              <div>
                <span className="text-sm font-medium">Review between steps</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Pause the pipeline after each member finishes so you can review their output
                  and provide feedback before the next member starts.
                </p>
              </div>
            </label>
          </div>

          {/* Summary */}
          <div className="border border-border rounded-xl p-4 mb-8">
            <h3 className="text-sm font-medium mb-3">Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Team</span>
                <span>{template.name}</span>
              </div>
              {template.inputs.filter(i => inputs[i.id]).map(input => (
                <div key={input.id} className="flex justify-between">
                  <span className="text-muted-foreground">{input.label}</span>
                  <span className="text-right max-w-[60%] truncate">
                    {input.type === 'select'
                      ? input.options.find(o => o.value === inputs[input.id])?.label || inputs[input.id]
                      : inputs[input.id]
                    }
                  </span>
                </div>
              ))}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Members</span>
                <span>{template.cluster.roles.map(r => r.roleName).join(' → ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Schedule</span>
                <span>{humanToCron(schedule).humanLabel}</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleLaunch}
              disabled={loading}
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating...' : schedule.preset === 'now' ? 'Launch Team' : 'Create Team'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function InputField({ input, value, onChange }) {
  if (input.type === 'file') {
    return (
      <div>
        <label className="block text-sm font-medium mb-1.5">
          {input.label}
          {input.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <div className="relative">
          <input
            type="file"
            accept={input.accept || '*'}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) onChange(file.name);
              // The actual file upload happens at team creation time
              // Store the file reference for later
              if (file) {
                e.target._selectedFile = file;
              }
            }}
            className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20"
          />
          {value && (
            <span className="text-xs text-muted-foreground mt-1 block">
              Selected: {value}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (input.type === 'select') {
    return (
      <div>
        <label className="block text-sm font-medium mb-1.5">
          {input.label}
          {input.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <select
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {!value && <option value="">Select...</option>}
          {input.options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  }

  if (input.type === 'textarea') {
    return (
      <div>
        <label className="block text-sm font-medium mb-1.5">
          {input.label}
          {input.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <textarea
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={input.placeholder}
          rows={4}
          className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">
        {input.label}
        {input.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        type="text"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={input.placeholder}
        className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

function StepDot({ active, label }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-full ${active ? 'bg-primary' : 'bg-border'}`} />
      <span className={`text-xs ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
        {label}
      </span>
    </div>
  );
}
