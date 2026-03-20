'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createCustomTeam, suggestTeamMembers, getAvailableTools } from '../actions.js';
import { SCHEDULE_PRESETS, DAYS_OF_WEEK, getNextRuns, humanToCron } from '../schedule.js';
import { AddToolModal } from './add-tool-modal.jsx';

const DEFAULT_TOOLS = [
  { id: 'brave-search', name: 'Web Search', desc: 'Search the web and extract content from pages', type: 'builtin' },
  { id: 'browser-tools', name: 'Browser', desc: 'Navigate websites, fill forms, take screenshots', type: 'builtin' },
  { id: 'youtube-transcript', name: 'YouTube', desc: 'Fetch and analyze YouTube video transcripts', type: 'builtin' },
  { id: 'notebooklm', name: 'NotebookLM', desc: 'Research synthesis, generate reports, podcasts, and summaries from sources', type: 'builtin' },
  { id: 'sop-generator', name: 'SOP Generator', desc: 'Create branded Standard Operating Procedure documents', type: 'builtin' },
  { id: 'slack', name: 'Slack', desc: 'Send messages and updates to Slack channels', type: 'builtin' },
];

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
    { name: '', role: '', description: '', tools: [] },
  ]);
  const [schedule, setSchedule] = useState({ preset: 'now' });
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [loading, setLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [expandedInfo, setExpandedInfo] = useState(null);
  const [showAddTool, setShowAddTool] = useState(false);
  const [toolCatalog, setToolCatalog] = useState(DEFAULT_TOOLS);
  const [error, setError] = useState(null);

  // Load available tools (built-in + installed MCP servers)
  useEffect(() => {
    getAvailableTools().then(res => {
      if (res.success && res.tools?.length) {
        setToolCatalog(res.tools);
      }
    }).catch(() => {});
  }, []);

  const addMember = () => {
    setMembers(prev => [...prev, { name: '', role: '', description: '', tools: [] }]);
  };

  const updateMember = (index, field, value) => {
    setMembers(prev => prev.map((m, i) => i === index ? { ...m, [field]: value } : m));
  };

  const toggleMemberTool = (index, toolId) => {
    setMembers(prev => prev.map((m, i) => {
      if (i !== index) return m;
      const tools = m.tools.includes(toolId)
        ? m.tools.filter(t => t !== toolId)
        : [...m.tools, toolId];
      return { ...m, tools };
    }));
  };

  const removeMember = (index) => {
    if (members.length <= 1) return;
    setMembers(prev => prev.filter((_, i) => i !== index));
    if (expandedInfo === index) setExpandedInfo(null);
  };

  const canProceed = teamName.trim() && task.trim() && members.every(m => m.name.trim());

  const handleSuggest = async () => {
    if (!task.trim()) return;
    setSuggesting(true);
    setError(null);
    try {
      const result = await suggestTeamMembers(task);
      if (result.success) {
        if (result.teamName) setTeamName(result.teamName);
        if (result.members?.length) {
          setMembers(result.members.map(m => ({
            name: m.name,
            role: m.role,
            description: m.description || '',
            tools: m.tools || [],
          })));
        }
      } else {
        setError(result.error || 'Could not generate suggestions. Try rephrasing your task.');
      }
    } catch (err) {
      setError(err.message || 'Could not generate suggestions. Try again.');
    } finally {
      setSuggesting(false);
    }
  };

  const handleLaunch = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await createCustomTeam(
        { name: teamName, task, members, requiresApproval },
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
          {/* Task Description — moved above team name so suggestions can fill name */}
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
            <button
              type="button"
              onClick={handleSuggest}
              disabled={suggesting || !task.trim()}
              className="mt-2 inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {suggesting ? (
                <>
                  <SpinnerIcon />
                  Thinking...
                </>
              ) : (
                <>
                  <WandIcon />
                  Suggest Team Members
                </>
              )}
            </button>
          </div>

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
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-medium">
                        Member {i + 1}{i > 0 ? ` (runs after Member ${i})` : ' (starts first)'}
                      </span>
                      {member.description && (
                        <button
                          type="button"
                          onClick={() => setExpandedInfo(expandedInfo === i ? null : i)}
                          className={`inline-flex items-center justify-center w-5 h-5 rounded-full border text-xs transition-colors ${
                            expandedInfo === i
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-muted-foreground/30 text-muted-foreground hover:border-primary hover:text-primary'
                          }`}
                          title="Why this member?"
                        >
                          i
                        </button>
                      )}
                    </div>
                    {members.length > 1 && (
                      <button
                        onClick={() => removeMember(i)}
                        className="text-xs text-red-500 hover:text-red-600 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {/* Info panel — why this member + assigned tools */}
                  {expandedInfo === i && member.description && (
                    <div className="mb-3 rounded-lg bg-primary/5 border border-primary/10 p-3">
                      <p className="text-xs text-foreground/80 mb-2">{member.description}</p>
                      {member.tools?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <span className="text-xs text-muted-foreground font-medium">Tools:</span>
                          {member.tools.map(toolId => {
                            const tool = toolCatalog.find(t => t.id === toolId);
                            return tool ? (
                              <span key={toolId} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                                {tool.name}
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  )}

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

                  {/* Tool selector */}
                  <div className="mt-3">
                    <label className="block text-xs text-muted-foreground mb-1.5">Tools</label>
                    <div className="flex flex-wrap gap-1.5">
                      {toolCatalog.map(tool => {
                        const active = member.tools?.includes(tool.id);
                        return (
                          <button
                            key={tool.id}
                            type="button"
                            onClick={() => toggleMemberTool(i, tool.id)}
                            title={tool.desc}
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors ${
                              active
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                            }`}
                          >
                            {active && <CheckIcon />}
                            {tool.name}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setShowAddTool(true)}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-2.5 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                      >
                        <PlusIcon />
                        Add Tool
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

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
              <div className="flex justify-between">
                <span className="text-muted-foreground">Review mode</span>
                <span>{requiresApproval ? 'Review between steps' : 'Automatic'}</span>
              </div>
            </div>

            {/* Member details in summary */}
            <div className="mt-4 pt-3 border-t border-border space-y-2">
              {members.map((m, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-muted-foreground font-medium whitespace-nowrap">{m.name || 'Worker'}:</span>
                  <span className="text-muted-foreground">{m.role}</span>
                  {m.tools?.length > 0 && (
                    <div className="flex gap-1 ml-auto shrink-0">
                      {m.tools.map(toolId => {
                        const tool = toolCatalog.find(t => t.id === toolId);
                        return tool ? (
                          <span key={toolId} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {tool.name}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>
              ))}
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

      {/* Add Tool Modal */}
      {showAddTool && (
        <AddToolModal
          onClose={() => setShowAddTool(false)}
          onInstalled={(newTool) => {
            // Add the newly installed tool to the catalog if not already there
            setToolCatalog(prev => {
              if (prev.some(t => t.id === newTool.id)) return prev;
              return [...prev, newTool];
            });
          }}
        />
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

function WandIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 4-1 1.06A7.98 7.98 0 0 0 10.06 9L9 10l1.06 1.06a7.98 7.98 0 0 0 3.94 3.94L15 16l1.06-1.06a7.98 7.98 0 0 0 3.94-3.94L21 10l-1.06-1.06a7.98 7.98 0 0 0-3.94-3.94z" />
      <path d="m2 22 10-10" />
      <path d="m8 16 1.5-1.5" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
