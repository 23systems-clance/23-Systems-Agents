/**
 * Credit Usage Chart component (T051 - Feature 39).
 *
 * Visual bar showing credits used vs included per pack subscription.
 * Reused in PackDetail (admin) and PackCatalog (client).
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface CreditUsageChartProps {
  creditsUsed: number;
  creditsIncluded: number;
  label?: string;
}

export function CreditUsageChart({ creditsUsed, creditsIncluded, label }: CreditUsageChartProps) {
  const pct = creditsIncluded > 0 ? Math.min((creditsUsed / creditsIncluded) * 100, 100) : 0;
  const overagePct = creditsIncluded > 0 && creditsUsed > creditsIncluded
    ? Math.min(((creditsUsed - creditsIncluded) / creditsIncluded) * 100, 50)
    : 0;
  const isOverage = creditsUsed > creditsIncluded;
  const remaining = Math.max(creditsIncluded - creditsUsed, 0);

  const barColor = isOverage
    ? 'bg-red-500'
    : pct > 80
      ? 'bg-yellow-500'
      : 'bg-green-500';

  const statusLabel = isOverage ? 'Over limit' : pct > 80 ? 'Nearing limit' : 'Normal';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {label ? `Credit Usage — ${label}` : 'Credit Usage'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{creditsUsed.toLocaleString()} used</span>
            <span>{creditsIncluded.toLocaleString()} included</span>
          </div>
          <div
            className="h-3 w-full rounded-full bg-muted overflow-hidden"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Credit usage: ${pct.toFixed(0)}% — ${statusLabel}`}
          >
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${Math.min(pct + overagePct, 100)}%` }}
            />
          </div>
          <span className="sr-only">{statusLabel}</span>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Used</p>
            <p className="font-semibold">{creditsUsed.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Remaining</p>
            <p className="font-semibold">{remaining.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Usage</p>
            <p className={`font-semibold ${isOverage ? 'text-red-600' : ''}`}>
              {pct.toFixed(0)}%{isOverage && ' + overage'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
