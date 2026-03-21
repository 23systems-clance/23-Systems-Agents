/**
 * Pack Manager list page (T048 - Feature 39).
 *
 * Table of vertical packs with category/status filters and create button.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Package, Plus } from 'lucide-react';
import { listPacks, type PackSummary } from '@/services/platform/packs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  PUBLISHED: 'bg-green-500/10 text-green-600 border-green-500/20',
  DEPRECATED: 'bg-red-500/10 text-red-600 border-red-500/20',
};

const TIER_COLORS: Record<string, string> = {
  FREE: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  STARTER: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  GROWTH: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  AGENCY: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
};

export default function PackManagerPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['packs', statusFilter, categoryFilter],
    queryFn: () =>
      listPacks({
        status: statusFilter === 'all' ? undefined : statusFilter,
        category: categoryFilter === 'all' ? undefined : categoryFilter,
      }),
  });

  if (isLoading) return <PageSkeleton />;

  const packs = data?.packs ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold">Vertical Packs</h1>
            <p className="text-sm text-muted-foreground">
              {packs.length} pack{packs.length !== 1 ? 's' : ''} configured
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="PUBLISHED">Published</SelectItem>
              <SelectItem value="DEPRECATED">Deprecated</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="SALES">Sales</SelectItem>
              <SelectItem value="OPERATIONS">Operations</SelectItem>
              <SelectItem value="RESEARCH">Research</SelectItem>
              <SelectItem value="EXECUTIVE">Executive</SelectItem>
              <SelectItem value="CUSTOM">Custom</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => navigate('/platform/packs/new')}>
            <Plus className="mr-2 h-4 w-4" />
            New Pack
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Skills</TableHead>
              <TableHead className="text-right">Subscribers</TableHead>
              <TableHead className="text-right">Price</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {packs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No packs found. Create your first vertical pack to get started.
                </TableCell>
              </TableRow>
            ) : (
              packs.map((pack: PackSummary) => (
                <TableRow
                  key={pack.id}
                  className="cursor-pointer hover:bg-muted/50"
                  tabIndex={0}
                  role="link"
                  aria-label={`Pack: ${pack.name}`}
                  onClick={() => navigate(`/platform/packs/${pack.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/platform/packs/${pack.id}`); }}
                >
                  <TableCell>
                    <div>
                      <p className="font-medium">{pack.name}</p>
                      <p className="text-xs text-muted-foreground">{pack.slug}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{pack.category}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={TIER_COLORS[pack.tier] ?? ''}>
                      {pack.tier}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_COLORS[pack.status] ?? ''}>
                      {pack.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm">{pack.skillCount}</TableCell>
                  <TableCell className="text-right text-sm">{pack.subscriberCount}</TableCell>
                  <TableCell className="text-right text-sm">
                    {pack.monthlyPriceUsd > 0 ? `$${pack.monthlyPriceUsd}/mo` : 'Free'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
