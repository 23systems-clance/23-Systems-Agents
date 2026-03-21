import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  accent?: 'teal' | 'indigo' | 'amber' | 'rose';
}

const ACCENT_MAP = {
  teal: {
    bg: 'bg-teal-50',
    icon: 'text-teal-600',
    ring: 'ring-teal-100',
  },
  indigo: {
    bg: 'bg-indigo-50',
    icon: 'text-indigo-600',
    ring: 'ring-indigo-100',
  },
  amber: {
    bg: 'bg-amber-50',
    icon: 'text-amber-600',
    ring: 'ring-amber-100',
  },
  rose: {
    bg: 'bg-rose-50',
    icon: 'text-rose-600',
    ring: 'ring-rose-100',
  },
} as const;

export function StatCard({ title, value, subtitle, icon: Icon, accent = 'teal' }: StatCardProps) {
  const colors = ACCENT_MAP[accent];

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className={cn('rounded-xl p-2.5 ring-1', colors.bg, colors.ring)}>
            <Icon className={cn('h-5 w-5', colors.icon)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
