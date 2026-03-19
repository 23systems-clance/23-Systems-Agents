'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createCustomTeam } from '../actions.js';
import { SCHEDULE_PRESETS, DAYS_OF_WEEK, getNextRuns, humanToCron } from '../schedule.js';

/**
 * Custom Team Wizard — create a team from scratch without a template.
 *
 * Step 1: Define the team (name, task, members)
 * Step 2: Schedule & Launch
 */
export function CustomTeamWizard({ initialTask = '' }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [teamName, setTeamName] = useState('');
  const [task, setTask] = useState(initialTask);
  const [members, setMembers] = useState([
    { name: '', role: '' },
  ]);
  const [schedule, setSchedule] = useState({ preset: 'now' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const addMember = () => {
    setMembers(prev => [...prev, { name: '', role: '' }]);
  };

  const updateMember = (index, field, value) => {
    setMembers(prev => prev.map((m, i) => i === index ? { ...m, [field]: value } : m));
  };

  const removeMember = (index) => {
    if (members.length <= 1) return;
    setMembers(prev => prev.filter((_, i) => i !== index));
  };

  const canProceed = teamName.trim() && task.trim() && members.every(m => m.name.trim());

  const handleLaunch = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await createCustomTeam(
        { name: teamName, task, members },
        schedule
      );
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

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress */}
      <div className="flex items-center gap-2 mb-8">
        <StepDot active={step >= 1} label="1. Define" />
        <div className="flex-1 h-px bg-border" />
        <StepDot active={step >= 2} label="2. Launch" />
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Build a Custom Team</h1>
        <p className="text-muted-foreground mt-1">
          Define your team from scratch — name it, describe the task, and add members.
        </p>
      </div>

      {step === 1 && (
        <div>
          {/* Team Name */}
          <div className="mb-5">
            <label className="block text-sm font-medium mb-1.5">
              Team Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              placeholder="e.g., Weekly Report Team"
              className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Task Description */}
          <div className="mb-5">
            <label className="block text-sm font-medium mb-1.5">
              What should this team do? <span className="text-red-500">*</span>
            </label>
            <textarea
              value={task}
              onChange={e => setTask(e.target.value)}
              placeholder="Describe the task in plain English, e.g., Research competitor pricing and write a weekly summary report"
              rows={3}
              className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* Team Members */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium">
                Team Members <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={addMember}
                className="text-xs text-primary hover:text-primary/80 transition-colors"
              >
                + Add Member
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Members run in sequence — each one starts after the previous finishes.
            </p>
            <div className="space-y-3">
              {members.map((member, i) => (
                <div key={i} className="rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-muted-foreground font-medium">
                      Member {i + 1}{i > 0 ? ` (runs after Member ${i})` : ' (starts first)'}
                    </span>
                    {members.length > 1 && (
                      <button
                        onClick={() => removeMember(i)}
                        className="text-xs text-red-500 hover:text-red-600 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Name</label>
                      <input
                        type="text"
                        value={member.name}
                        onChange={e => updateMember(i, 'name', e.target.value)}
                        placeholder="e.g., Researcher"
                        className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Role (what they do)</label>
                      <input
                        type="text"
                        value={member.role}
                        onChange={e => updateMember(i, 'role', e.target.value)}
                        placeholder="e.g., Finds and gathers information"
                        className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  </div>
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

          {/* Summary */}
          <div className="border border-border rounded-xl p-4 mb-8">
            <h3 className="text-sm font-medium mb-3">Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Team</span>
                <span>{teamName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Task</span>
                <span className="text-right max-w-[60%] truncate">{task}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Members</span>
                <span>{members.map(m => m.name || 'Worker').join(' → ')}</span>
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
