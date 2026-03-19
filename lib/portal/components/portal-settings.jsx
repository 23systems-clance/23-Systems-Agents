'use client';

import { useState } from 'react';
import Link from 'next/link';

export function PortalSettings({ session }) {
  const [activeSection, setActiveSection] = useState('profile');

  const sections = [
    { id: 'profile', label: 'Profile', icon: UserIcon },
    { id: 'notifications', label: 'Notifications', icon: BellIcon },
    { id: 'appearance', label: 'Appearance', icon: PaletteIcon },
    { id: 'api', label: 'Connect Apps', icon: LinkIcon },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your account and preferences.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-6">
        {/* Sidebar */}
        <nav className="sm:w-48 flex sm:flex-col gap-1">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors ${
                activeSection === id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 max-w-xl">
          {activeSection === 'profile' && <ProfileSection session={session} />}
          {activeSection === 'notifications' && <NotificationsSection />}
          {activeSection === 'appearance' && <AppearanceSection />}
          {activeSection === 'api' && <ApiSection />}
        </div>
      </div>

      {/* Developer Portal Link */}
      <div className="mt-12 pt-6 border-t border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Advanced Settings</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Configure cron jobs, triggers, API keys, and more in the Developer Portal.
            </p>
          </div>
          <Link
            href="/dev/settings/crons"
            className="text-sm text-primary hover:text-primary/80 transition-colors"
          >
            Open Developer Settings
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Profile Section ──────────────────────────────────

function ProfileSection({ session }) {
  const [name, setName] = useState(session?.user?.name || '');
  const [email] = useState(session?.user?.email || '');
  const [saved, setSaved] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    // Profile updates would go through the existing auth system
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-4">Profile</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Display Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Email cannot be changed.
            </p>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {saved ? 'Saved' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Notifications Section ────────────────────────────

function NotificationsSection() {
  const [completionAlerts, setCompletionAlerts] = useState(true);
  const [failureAlerts, setFailureAlerts] = useState(true);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Notifications</h2>
      <p className="text-sm text-muted-foreground">
        Choose when you want to be notified about your teams.
      </p>

      <div className="space-y-4">
        <ToggleSetting
          label="Task completed"
          description="Get notified when a team finishes a task"
          checked={completionAlerts}
          onChange={setCompletionAlerts}
        />
        <ToggleSetting
          label="Task failed"
          description="Get notified when a team encounters an error"
          checked={failureAlerts}
          onChange={setFailureAlerts}
        />
      </div>

      <div className="rounded-lg border border-border p-4 bg-muted/30">
        <p className="text-sm text-muted-foreground">
          Notifications are delivered through the web interface and Telegram (if configured).
          To set up Telegram, visit{' '}
          <Link href="/dev/settings/crons" className="text-primary hover:text-primary/80">
            Developer Settings
          </Link>.
        </p>
      </div>
    </div>
  );
}

// ── Appearance Section ───────────────────────────────

function AppearanceSection() {
  const [theme, setTheme] = useState('system');

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Appearance</h2>
      <p className="text-sm text-muted-foreground">
        Customize how 23 Systems looks for you.
      </p>

      <div>
        <label className="block text-sm font-medium mb-3">Theme</label>
        <div className="grid grid-cols-3 gap-3">
          {['light', 'dark', 'system'].map(option => (
            <button
              key={option}
              onClick={() => setTheme(option)}
              className={`rounded-lg border p-4 text-center text-sm transition-all ${
                theme === option
                  ? 'border-primary bg-primary/5 text-primary font-medium'
                  : 'border-border text-muted-foreground hover:border-primary/30'
              }`}
            >
              <div className="mb-2">
                {option === 'light' && <SunIcon className="h-5 w-5 mx-auto" />}
                {option === 'dark' && <MoonIcon className="h-5 w-5 mx-auto" />}
                {option === 'system' && <MonitorIcon className="h-5 w-5 mx-auto" />}
              </div>
              <span className="capitalize">{option}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border p-4 bg-muted/30">
        <p className="text-sm text-muted-foreground">
          To customize colors and branding, edit <code className="text-xs bg-muted px-1 py-0.5 rounded">theme.css</code> in the project root.
        </p>
      </div>
    </div>
  );
}

// ── API Access Section ───────────────────────────────

function ApiSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Connect Apps</h2>
      <p className="text-sm text-muted-foreground">
        Use API keys to connect external apps and services to your teams.
      </p>

      <div className="rounded-lg border border-border p-5">
        <h3 className="text-sm font-medium mb-2">API Keys</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Create and manage API keys for programmatic access. Keys let you trigger teams, check status, and retrieve output from external tools.
        </p>
        <Link
          href="/dev/settings/secrets"
          className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Manage API Keys
        </Link>
      </div>

      <div className="rounded-lg border border-border p-5">
        <h3 className="text-sm font-medium mb-2">Webhooks</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Set up webhooks so external services can trigger your teams automatically.
        </p>
        <Link
          href="/dev/settings/triggers"
          className="inline-block rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          Configure Webhooks
        </Link>
      </div>
    </div>
  );
}

// ── Shared Components ────────────────────────────────

function ToggleSetting({ label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-muted-foreground/30'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

// ── Inline SVG Icons ─────────────────────────────────

function UserIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function BellIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function PaletteIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" /><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" /><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" /><circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

function LinkIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function SunIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function MonitorIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
