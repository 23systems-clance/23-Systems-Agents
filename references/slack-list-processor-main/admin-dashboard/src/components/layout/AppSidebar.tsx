import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, AlertTriangle,
  Building2, Briefcase, UserCircle, Gauge, FileBarChart, Settings, LogOut, Users, ClipboardList,
  Megaphone, Activity, SlidersHorizontal, GraduationCap, Workflow, Zap, FileText,
  CreditCard, DollarSign, Database, Plug2, BookOpen, Braces, Headphones, Disc, BarChart3, Monitor, Shield,
  Key, ToggleRight,
  Bot, Server, Sparkles, Package, ScrollText, BrainCircuit, UsersRound, ShieldCheck, Bell,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAdminAuth } from '@/hooks/useAdminAuth';

interface NavSection {
  label: string;
  items: { to: string; icon: React.ComponentType<{ className?: string }>; label: string }[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Dashboard',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Overview' },
      { to: '/usage', icon: TrendingUp, label: 'Usage' },
      { to: '/errors', icon: AlertTriangle, label: 'Errors' },
    ],
  },
  {
    label: 'Organization',
    items: [
      { to: '/workspaces', icon: Building2, label: 'Workspaces' },
      { to: '/clients', icon: Briefcase, label: 'Clients' },
      { to: '/bdrs', icon: UserCircle, label: 'BDRs' },
      { to: '/jobs', icon: ClipboardList, label: 'Jobs' },
    ],
  },
  {
    label: 'Licensing',
    items: [
      { to: '/licensing', icon: Key, label: 'License Keys' },
      { to: '/workspace-mgmt', icon: ToggleRight, label: 'Workspace Mgmt' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/campaigns', icon: Megaphone, label: 'Campaigns' },
      { to: '/enrichment', icon: SlidersHorizontal, label: 'Enrichment' },
      { to: '/bdr-activity', icon: Activity, label: 'BDR Activity' },
      { to: '/active-calls', icon: Headphones, label: 'Active Calls' },
      { to: '/recordings', icon: Disc, label: 'Recordings' },
      { to: '/dialer-analytics', icon: BarChart3, label: 'Dialer Analytics' },
      { to: '/salesfloor', icon: Monitor, label: 'Salesfloor' },
      { to: '/eod-reports', icon: FileText, label: 'EOD Reports' },
      { to: '/thresholds', icon: Gauge, label: 'Thresholds' },
      { to: '/reports', icon: FileBarChart, label: 'Reports' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { to: '/billing', icon: CreditCard, label: 'Profiles' },
      { to: '/credit-rates', icon: DollarSign, label: 'Credit Rates' },
      { to: '/provider-costs', icon: DollarSign, label: 'Provider Costs' },
    ],
  },
  {
    label: 'Automation',
    items: [
      { to: '/onboarding-plans', icon: GraduationCap, label: 'Onboarding' },
      { to: '/workflows', icon: Workflow, label: 'Workflows' },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { to: '/crm/connections', icon: Plug2, label: 'CRM Connections' },
    ],
  },
  {
    label: 'Autonomous',
    items: [
      { to: '/autonomous', icon: BrainCircuit, label: 'Dashboard' },
      { to: '/autonomous/agents', icon: Bot, label: 'Agents' },
      { to: '/autonomous/teams', icon: UsersRound, label: 'Teams' },
      { to: '/autonomous/audit', icon: ShieldCheck, label: 'Audit Trail' },
      { to: '/autonomous/events', icon: Bell, label: 'System Events' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/platform/agents', icon: Bot, label: 'Agent Registry' },
      { to: '/platform/mcp-servers', icon: Server, label: 'MCP Servers' },
      { to: '/platform/skills', icon: Sparkles, label: 'Skills' },
      { to: '/platform/packs', icon: Package, label: 'Vertical Packs' },
      { to: '/platform/executions', icon: ScrollText, label: 'Execution Logs' },
    ],
  },
  {
    label: 'AI',
    items: [
      { to: '/prompts', icon: BookOpen, label: 'Prompt Library' },
      { to: '/prompts/variables', icon: Braces, label: 'Variables' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/apollo-cache', icon: Database, label: 'Apollo Cache' },
      { to: '/cache-metrics', icon: Database, label: 'Cache' },
      { to: '/network-requirements', icon: Shield, label: 'Network' },
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
];

const ADMIN_ITEMS = [
  { to: '/users', icon: Users, label: 'Users' },
];

interface AppSidebarProps {
  onLogout: () => void;
}

export function AppSidebar({ onLogout }: AppSidebarProps) {
  const { user } = useAdminAuth();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <aside className="flex h-screen w-64 flex-col bg-sidebar-background">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-ring/20">
          <Zap className="h-4 w-4 text-sidebar-ring" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-tight text-sidebar-primary">Slack BDR</h1>
          <p className="text-[10px] font-medium uppercase tracking-widest text-sidebar-foreground/50">Operations</p>
        </div>
      </div>

      <ScrollArea className="flex-1 px-3 py-2">
        <nav className="space-y-5">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                {section.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {section.items.map(({ to, icon: Icon, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0 opacity-70 group-hover:opacity-100" />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}

          {isAdmin && (
            <div>
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                Admin
              </p>
              <div className="flex flex-col gap-0.5">
                {ADMIN_ITEMS.map(({ to, icon: Icon, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0 opacity-70 group-hover:opacity-100" />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          )}
        </nav>
      </ScrollArea>

      {/* User footer */}
      <div className="border-t border-sidebar-border p-3">
        {user && (
          <div className="mb-2 flex items-center gap-2 px-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sidebar-accent text-[11px] font-bold text-sidebar-accent-foreground">
              {user.name?.charAt(0)?.toUpperCase() ?? 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-sidebar-primary">
                {user.name}
              </p>
              <p className="truncate text-[10px] text-sidebar-foreground/50">
                {user.role}
              </p>
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          className="w-full justify-start gap-2.5 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4" />
          Log out
        </Button>
      </div>
    </aside>
  );
}
