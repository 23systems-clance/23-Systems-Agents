/**
 * Pack Detail page (T049 - Feature 39).
 *
 * Pack configuration form, skill assignment, pricing, analytics,
 * publish/deprecate actions.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Rocket, Ban } from 'lucide-react';
import {
  getPack,
  createPack,
  updatePack,
  publishPack,
  deprecatePack,
  assignPackSkills,
} from '@/services/platform/packs';
import { listSkills, type SkillSummary } from '@/services/platform/skills';
import { CreditUsageChart } from '@/components/platform/CreditUsageChart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const CATEGORIES = ['SALES', 'OPERATIONS', 'RESEARCH', 'EXECUTIVE', 'CUSTOM'];
const TIERS = ['FREE', 'STARTER', 'GROWTH', 'AGENCY'];

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  PUBLISHED: 'bg-green-500/10 text-green-600 border-green-500/20',
  DEPRECATED: 'bg-red-500/10 text-red-600 border-red-500/20',
};

export default function PackDetailPage() {
  const { packId } = useParams<{ packId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = !packId;

  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    category: 'SALES',
    tier: 'STARTER',
    monthlyPriceUsd: 0,
    creditsIncluded: 100,
    overageRateUsd: 0,
  });

  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);

  const { data: pack, isLoading } = useQuery({
    queryKey: ['pack', packId],
    queryFn: () => getPack(packId!),
    enabled: !!packId,
  });

  const { data: skillsData } = useQuery({
    queryKey: ['skills', 'PUBLISHED'],
    queryFn: () => listSkills({ status: 'PUBLISHED' }),
  });

  useEffect(() => {
    if (pack) {
      setForm({
        name: pack.name,
        slug: pack.slug,
        description: pack.description ?? '',
        category: pack.category,
        tier: pack.tier,
        monthlyPriceUsd: Number(pack.monthlyPriceUsd),
        creditsIncluded: pack.creditsIncluded,
        overageRateUsd: Number(pack.overageRateUsd),
      });
      if (pack.skills) {
        setSelectedSkillIds(pack.skills.map((s) => s.id));
      }
    }
  }, [pack]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isNew) {
        return createPack({ ...form, skillIds: selectedSkillIds });
      }
      return updatePack(packId!, form);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['packs'] });
      queryClient.invalidateQueries({ queryKey: ['pack', packId] });
      if (isNew && data) {
        navigate(`/platform/packs/${data.id}`, { replace: true });
      }
    },
  });

  const skillMutation = useMutation({
    mutationFn: () => assignPackSkills(packId!, selectedSkillIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pack', packId] });
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => publishPack(packId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pack', packId] });
      queryClient.invalidateQueries({ queryKey: ['packs'] });
    },
  });

  const deprecateMutation = useMutation({
    mutationFn: () => deprecatePack(packId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pack', packId] });
      queryClient.invalidateQueries({ queryKey: ['packs'] });
    },
  });

  if (!isNew && isLoading) return <PageSkeleton />;

  const availableSkills = skillsData?.skills ?? [];
  const canPublish = pack && pack.status !== 'PUBLISHED' && pack.status !== 'DEPRECATED';
  const canDeprecate = pack && pack.status !== 'DEPRECATED';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back to packs" onClick={() => navigate('/platform/packs')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{isNew ? 'New Pack' : pack?.name}</h1>
          {pack && (
            <Badge variant="outline" className={STATUS_COLORS[pack.status] ?? ''}>
              {pack.status}
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          {!isNew && canPublish && (
            <Button variant="outline" onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending}>
              <Rocket className="mr-2 h-4 w-4" />
              Publish
            </Button>
          )}
          {!isNew && canDeprecate && (
            <Button variant="outline" onClick={() => deprecateMutation.mutate()} disabled={deprecateMutation.isPending}>
              <Ban className="mr-2 h-4 w-4" />
              Deprecate
            </Button>
          )}
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {isNew ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>

      {(saveMutation.isError || publishMutation.isError) && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-600">
          {(saveMutation.error ?? publishMutation.error)?.message ?? 'Operation failed'}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pack Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Outbound Pack" />
                </div>
                <div>
                  <Label htmlFor="slug">Slug</Label>
                  <Input id="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="outbound-pack" disabled={!isNew} />
                </div>
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Category</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tier</Label>
                  <Select value={form.tier} onValueChange={(v) => setForm({ ...form, tier: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIERS.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="monthlyPrice">Monthly Price ($)</Label>
                  <Input id="monthlyPrice" type="number" step="0.01" value={form.monthlyPriceUsd} onChange={(e) => setForm({ ...form, monthlyPriceUsd: Number(e.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="credits">Credits Included</Label>
                  <Input id="credits" type="number" value={form.creditsIncluded} onChange={(e) => setForm({ ...form, creditsIncluded: Number(e.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="overage">Overage Rate ($)</Label>
                  <Input id="overage" type="number" step="0.01" value={form.overageRateUsd} onChange={(e) => setForm({ ...form, overageRateUsd: Number(e.target.value) })} />
                </div>
              </div>
            </CardContent>
          </Card>

          {!isNew && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Skills ({selectedSkillIds.length})</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => skillMutation.mutate()}
                  disabled={skillMutation.isPending}
                >
                  Save Assignment
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {availableSkills.map((skill: SkillSummary) => (
                  <label key={skill.id} className="flex items-center gap-3 rounded-md border p-3 hover:bg-muted/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedSkillIds.includes(skill.id)}
                      onChange={(e) => {
                        setSelectedSkillIds(
                          e.target.checked
                            ? [...selectedSkillIds, skill.id]
                            : selectedSkillIds.filter((id) => id !== skill.id),
                        );
                      }}
                      className="h-4 w-4"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{skill.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Agent: {skill.agentName} v{skill.agentVersion} | Credit cost: {Number(skill.creditCost).toFixed(2)}
                      </p>
                    </div>
                  </label>
                ))}
                {availableSkills.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No published skills available.</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {!isNew && pack?.analytics && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Analytics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subscribers</span>
                  <span className="font-medium">{pack.analytics.subscriberCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Active Users</span>
                  <span className="font-medium">{pack.analytics.activeUsers}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Credits Used</span>
                  <span className="font-medium">{pack.analytics.totalCreditsUsed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Revenue (MRR)</span>
                  <span className="font-medium">${pack.analytics.totalRevenue.toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {!isNew && pack && (
            <CreditUsageChart
              creditsUsed={pack.analytics?.totalCreditsUsed ?? 0}
              creditsIncluded={pack.creditsIncluded}
              label={pack.name}
            />
          )}
        </div>
      </div>
    </div>
  );
}
