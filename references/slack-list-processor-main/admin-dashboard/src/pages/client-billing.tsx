/**
 * Client Billing page (T060).
 *
 * Shows billing details, credit packs for purchase, and transaction history.
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CreditCard, ShoppingCart, ExternalLink } from 'lucide-react';
import {
  getClientBilling,
  listCreditPacks,
  purchaseCreditPack,
  openBillingPortal,
} from '@/services/client-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const TRANSACTION_COLORS: Record<string, string> = {
  MONTHLY_ALLOCATION: 'bg-green-500/10 text-green-600',
  ENRICHMENT_DEDUCTION: 'bg-red-500/10 text-red-600',
  CREDIT_PACK_PURCHASE: 'bg-blue-500/10 text-blue-600',
  MANUAL_ADJUSTMENT: 'bg-yellow-500/10 text-yellow-600',
  LICENSE_ACTIVATION: 'bg-purple-500/10 text-purple-600',
  OVERAGE_CHARGE: 'bg-orange-500/10 text-orange-600',
};

export default function ClientBillingPage() {
  const [showPacks, setShowPacks] = useState(false);

  const { data: billing, isLoading } = useQuery({
    queryKey: ['client-billing'],
    queryFn: getClientBilling,
  });

  const { data: packs } = useQuery({
    queryKey: ['client-credit-packs'],
    queryFn: listCreditPacks,
    enabled: showPacks,
  });

  const purchaseMutation = useMutation({
    mutationFn: purchaseCreditPack,
    onSuccess: (url) => {
      window.location.href = url;
    },
  });

  const portalMutation = useMutation({
    mutationFn: openBillingPortal,
    onSuccess: (url) => {
      window.location.href = url;
    },
  });

  if (isLoading || !billing) return <PageSkeleton />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Billing</h2>
        <Button variant="outline" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending}>
          <ExternalLink className="h-4 w-4 mr-2" />
          Manage Subscription
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Credit Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold font-mono ${billing.creditBalance <= 0 ? 'text-red-600' : ''}`}>
              {billing.creditBalance.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Monthly Allowance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono">{billing.monthlyAllowance.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">
              {billing.nextResetDate ? `Resets ${new Date(billing.nextResetDate).toLocaleDateString()}` : ''}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold capitalize">{billing.subscriptionTier}</p>
          </CardContent>
        </Card>
      </div>

      {/* Buy Credits */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">
            <ShoppingCart className="inline h-5 w-5 mr-2" />
            Credit Packs
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setShowPacks(!showPacks)}>
            {showPacks ? 'Hide' : 'Buy Credits'}
          </Button>
        </CardHeader>
        {showPacks && packs && (
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {packs.map((pack) => (
                <Card key={pack.id} className="border-2 hover:border-primary transition-colors">
                  <CardContent className="pt-6 text-center space-y-3">
                    <p className="text-lg font-semibold">{pack.name}</p>
                    <p className="text-3xl font-bold font-mono">{pack.creditAmount.toLocaleString()}</p>
                    <p className="text-sm text-muted-foreground">credits</p>
                    <p className="text-lg font-semibold">${pack.priceUsd.toFixed(2)}</p>
                    <Button
                      className="w-full"
                      onClick={() => purchaseMutation.mutate(pack.id)}
                      disabled={purchaseMutation.isPending}
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      Purchase
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Transaction History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billing.transactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="text-sm">
                    {new Date(tx.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={TRANSACTION_COLORS[tx.type] ?? ''}>
                      {tx.type.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{tx.description}</TableCell>
                  <TableCell className={`text-right font-mono ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              {billing.transactions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No transactions yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </motion.div>
  );
}
