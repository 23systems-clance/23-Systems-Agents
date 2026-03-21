import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Save, ArrowLeft, GripVertical, Eye, Library, Search } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import {
  fetchOnboardingPlan,
  createOnboardingPlan,
  updateOnboardingPlan,
} from '@/services/onboarding-plans';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import type {
  OnboardingModule,
  TrainingItemInput,
  AutomationInput,
  TrainingItemType,
  AutomationType,
  ModuleInput,
  OnboardingPlanCreateInput,
  PlanPreviewDay,
} from '@/types/api';
import { fetchOnboardingPlanPreview } from '@/services/onboarding-plans';
import {
  fetchContentLibrary,
  type ContentLibraryItem,
} from '@/services/content-library';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRAINING_ITEM_TYPES: { value: TrainingItemType; label: string }[] = [
  { value: 'VIDEO', label: 'Video' },
  { value: 'READING', label: 'Reading' },
  { value: 'QUIZ', label: 'Quiz' },
  { value: 'PRACTICE_TASK', label: 'Practice Task' },
  { value: 'CHECKLIST', label: 'Checklist' },
  { value: 'RESOURCE_LINK', label: 'Resource Link' },
  { value: 'REIMBURSEMENT_INFO', label: 'Reimbursement Info' },
];

const AUTOMATION_TYPES: { value: AutomationType; label: string }[] = [
  { value: 'CHECK_IN', label: 'Check-In' },
  { value: 'REMINDER', label: 'Reminder' },
  { value: 'WEEKLY_SUMMARY', label: 'Weekly Summary' },
  { value: 'CUSTOM_MESSAGE', label: 'Custom Message' },
];

// ---------------------------------------------------------------------------
// Local form state types
// ---------------------------------------------------------------------------

interface LocalTrainingItem {
  _key: string;
  type: TrainingItemType;
  title: string;
  content: string;
  estimated_minutes: number | '';
}

interface LocalAutomation {
  _key: string;
  type: AutomationType;
  trigger_time: string;
  content: string;
}

interface LocalModule {
  day_number: number;
  title: string;
  description: string;
  estimated_minutes: number | '';
  training_items: LocalTrainingItem[];
  automations: LocalAutomation[];
}

interface PlanSettings {
  name: string;
  description: string;
  duration_days: number;
  supervised_start_day: number | '';
  weekdays_only: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let keyCounter = 0;
/** Generates a unique local key for list items. */
function nextKey(): string {
  keyCounter += 1;
  return `_k${keyCounter}`;
}

/** Creates a blank training item. */
function emptyTrainingItem(): LocalTrainingItem {
  return { _key: nextKey(), type: 'VIDEO', title: '', content: '', estimated_minutes: '' };
}

/** Creates a blank automation. */
function emptyAutomation(): LocalAutomation {
  return { _key: nextKey(), type: 'CHECK_IN', trigger_time: '09:00', content: '' };
}

/** Creates a blank module for a given day. */
function emptyModule(dayNumber: number): LocalModule {
  return {
    day_number: dayNumber,
    title: `Day ${dayNumber}`,
    description: '',
    estimated_minutes: '',
    training_items: [],
    automations: [],
  };
}

/** Converts server module data to local form state. */
function serverModuleToLocal(mod: OnboardingModule): LocalModule {
  return {
    day_number: mod.day_number,
    title: mod.title,
    description: mod.description ?? '',
    estimated_minutes: mod.estimated_minutes ?? '',
    training_items: mod.training_items.map((ti) => ({
      _key: nextKey(),
      type: ti.type,
      title: ti.title,
      content: ti.content ?? '',
      estimated_minutes: ti.estimated_minutes ?? '',
    })),
    automations: mod.automations.map((a) => ({
      _key: nextKey(),
      type: a.type,
      trigger_time: a.trigger_time,
      content: a.content ?? '',
    })),
  };
}

/** Converts local module state back to API input. */
function localModuleToInput(mod: LocalModule): ModuleInput {
  return {
    day_number: mod.day_number,
    title: mod.title,
    description: mod.description || undefined,
    estimated_minutes: mod.estimated_minutes === '' ? undefined : mod.estimated_minutes,
    training_items: mod.training_items.map<TrainingItemInput>((ti) => ({
      type: ti.type,
      title: ti.title,
      content: ti.content || undefined,
      estimated_minutes: ti.estimated_minutes === '' ? undefined : ti.estimated_minutes,
    })),
    automations: mod.automations.map<AutomationInput>((a) => ({
      type: a.type,
      trigger_time: a.trigger_time,
      content: a.content || undefined,
    })),
  };
}

/** Calculates total estimated minutes for a module. */
function moduleEstimate(mod: LocalModule): number {
  const base = typeof mod.estimated_minutes === 'number' ? mod.estimated_minutes : 0;
  if (base > 0) return base;
  return mod.training_items.reduce((sum, ti) => {
    const mins = typeof ti.estimated_minutes === 'number' ? ti.estimated_minutes : 0;
    return sum + mins;
  }, 0);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OnboardingPlanDetailPage() {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isNew = !planId || planId === 'new';

  // ---- Plan settings state ----
  const [settings, setSettings] = useState<PlanSettings>({
    name: '',
    description: '',
    duration_days: 5,
    supervised_start_day: '',
    weekdays_only: true,
  });

  // ---- Modules state ----
  const [modules, setModules] = useState<LocalModule[]>(() =>
    Array.from({ length: 5 }, (_, i) => emptyModule(i + 1)),
  );

  // ---- Selected day ----
  const [selectedDay, setSelectedDay] = useState(1);

  // ---- Preview modal ----
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<PlanPreviewDay[] | null>(null);

  // ---- Library picker ----
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryItems, setLibraryItems] = useState<ContentLibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  const openLibraryPicker = async () => {
    setLibraryOpen(true);
    setLibrarySearch('');
    setLibraryLoading(true);
    try {
      const res = await fetchContentLibrary();
      setLibraryItems(res.items);
    } catch {
      setLibraryItems([]);
    }
    setLibraryLoading(false);
  };

  const handleLibrarySearch = async (search: string) => {
    setLibrarySearch(search);
    setLibraryLoading(true);
    try {
      const res = await fetchContentLibrary({ search: search || undefined });
      setLibraryItems(res.items);
    } catch {
      setLibraryItems([]);
    }
    setLibraryLoading(false);
  };

  const selectLibraryItem = (item: ContentLibraryItem) => {
    const newItem: LocalTrainingItem = {
      _key: nextKey(),
      type: item.type as TrainingItemType,
      title: item.title,
      content: item.content ?? '',
      estimated_minutes: item.estimated_minutes ?? '',
    };
    setTrainingItems([...currentModule.training_items, newItem]);
    setLibraryOpen(false);
  };

  // ---- Load existing plan ----
  const planQuery = useQuery({
    queryKey: queryKeys.onboardingPlans.detail(planId ?? ''),
    queryFn: () => fetchOnboardingPlan(planId!),
    enabled: !isNew,
  });

  /** Populate form from loaded plan data. */
  useEffect(() => {
    if (!planQuery.data?.plan) return;
    const plan = planQuery.data.plan;
    setSettings({
      name: plan.name,
      description: plan.description ?? '',
      duration_days: plan.duration_days,
      supervised_start_day: plan.supervised_start_day ?? '',
      weekdays_only: plan.weekdays_only,
    });

    // Build modules array: one entry per day, filling gaps with empties
    const byDay = new Map<number, LocalModule>();
    plan.modules.forEach((m) => {
      byDay.set(m.day_number, serverModuleToLocal(m));
    });
    const built: LocalModule[] = [];
    for (let d = 1; d <= plan.duration_days; d++) {
      built.push(byDay.get(d) ?? emptyModule(d));
    }
    setModules(built);
    setSelectedDay(1);
  }, [planQuery.data]);

  // ---- Duration change handler ----
  const handleDurationChange = useCallback(
    (newDuration: number) => {
      if (newDuration < 1) return;
      const clamped = Math.min(newDuration, 90);
      setSettings((s) => ({ ...s, duration_days: clamped }));
      setModules((prev) => {
        if (clamped > prev.length) {
          const added = Array.from(
            { length: clamped - prev.length },
            (_, i) => emptyModule(prev.length + i + 1),
          );
          return [...prev, ...added];
        }
        return prev.slice(0, clamped);
      });
      if (selectedDay > clamped) setSelectedDay(clamped);
    },
    [selectedDay],
  );

  // ---- Mutations ----
  const createMut = useMutation({
    mutationFn: (input: OnboardingPlanCreateInput) => createOnboardingPlan(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboardingPlans'] });
      navigate('/onboarding-plans');
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<OnboardingPlanCreateInput> }) =>
      updateOnboardingPlan(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboardingPlans'] });
      navigate('/onboarding-plans');
    },
  });

  /** Builds the API payload and submits. */
  const handleSave = () => {
    const payload: OnboardingPlanCreateInput = {
      slack_team_id: 'T_DEFAULT',
      name: settings.name,
      description: settings.description || undefined,
      duration_days: settings.duration_days,
      supervised_start_day:
        settings.supervised_start_day === '' ? undefined : settings.supervised_start_day,
      weekdays_only: settings.weekdays_only,
      modules: modules
        .filter((m) => m.title.trim().length > 0)
        .map(localModuleToInput),
    };

    if (isNew) {
      createMut.mutate(payload);
    } else {
      updateMut.mutate({ id: planId!, input: payload });
    }
  };

  /** Opens the preview dialog (uses API for saved plans, local summary for new). */
  const handlePreview = async () => {
    if (!isNew && planId) {
      try {
        const res = await fetchOnboardingPlanPreview(planId);
        setPreviewData(res.preview);
      } catch {
        // Fall back to local summary
        setPreviewData(null);
      }
    } else {
      setPreviewData(null);
    }
    setPreviewOpen(true);
  };

  // ---- Module updater ----
  const updateModule = (dayIndex: number, patch: Partial<LocalModule>) => {
    setModules((prev) =>
      prev.map((m, i) => (i === dayIndex ? { ...m, ...patch } : m)),
    );
  };

  // ---- Selected module helpers ----
  const dayIndex = selectedDay - 1;
  const currentModule = modules[dayIndex];

  const setTrainingItems = (items: LocalTrainingItem[]) => {
    updateModule(dayIndex, { training_items: items });
  };

  const setAutomations = (items: LocalAutomation[]) => {
    updateModule(dayIndex, { automations: items });
  };

  const isSaving = createMut.isPending || updateMut.isPending;

  // ---- Loading state ----
  if (!isNew && planQuery.isLoading) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <PageSkeleton />
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/onboarding-plans')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold">
              {isNew ? 'Create Onboarding Plan' : 'Edit Onboarding Plan'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isNew
                ? 'Design a new drip-based onboarding plan for BDRs.'
                : `Editing plan: ${settings.name}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handlePreview}>
            <Eye className="mr-1 h-4 w-4" />
            Preview
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !settings.name.trim()}>
            <Save className="mr-1 h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save Plan'}
          </Button>
        </div>
      </div>

      {/* Plan Settings */}
      <Card>
        <CardContent className="p-6">
          <h3 className="mb-4 text-lg font-semibold">Plan Settings</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Plan Name */}
            <div className="space-y-2">
              <Label htmlFor="plan-name">Plan Name *</Label>
              <Input
                id="plan-name"
                value={settings.name}
                onChange={(e) => setSettings((s) => ({ ...s, name: e.target.value }))}
                placeholder="e.g. Standard 30-Day Onboarding"
              />
            </div>

            {/* Duration */}
            <div className="space-y-2">
              <Label htmlFor="duration">Duration (days) *</Label>
              <Input
                id="duration"
                type="number"
                min={1}
                max={90}
                value={settings.duration_days}
                onChange={(e) => handleDurationChange(Number(e.target.value))}
              />
            </div>

            {/* Supervised Start Day */}
            <div className="space-y-2">
              <Label htmlFor="supervised-start">Supervised Start Day</Label>
              <Input
                id="supervised-start"
                type="number"
                min={1}
                max={settings.duration_days}
                value={settings.supervised_start_day}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    supervised_start_day: e.target.value === '' ? '' : Number(e.target.value),
                  }))
                }
                placeholder="Optional"
              />
              <p className="text-xs text-muted-foreground">
                Day when supervised mode begins (leave blank to skip).
              </p>
            </div>

            {/* Description */}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="plan-desc">Description</Label>
              <Textarea
                id="plan-desc"
                value={settings.description}
                onChange={(e) => setSettings((s) => ({ ...s, description: e.target.value }))}
                placeholder="Describe the purpose and scope of this onboarding plan..."
                rows={3}
              />
            </div>

            {/* Weekdays Only */}
            <div className="flex items-center gap-3 self-end pb-1">
              <Switch
                id="weekdays-only"
                checked={settings.weekdays_only}
                onCheckedChange={(v) => setSettings((s) => ({ ...s, weekdays_only: v }))}
              />
              <Label htmlFor="weekdays-only">Weekdays only</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Drip Builder */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        {/* Left Panel: Day Timeline */}
        <Card className="h-fit">
          <CardContent className="p-0">
            <div className="border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Timeline</h3>
              <p className="text-xs text-muted-foreground">
                {settings.duration_days} day{settings.duration_days !== 1 ? 's' : ''}
              </p>
            </div>
            <ScrollArea className="max-h-[600px]">
              <div className="space-y-1 p-2">
                {modules.map((mod, idx) => {
                  const day = idx + 1;
                  const isSelected = day === selectedDay;
                  const itemCount = mod.training_items.length;
                  const est = moduleEstimate(mod);
                  const hasContent = mod.title !== `Day ${day}` || itemCount > 0;

                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-40" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">Day {day}</span>
                          {hasContent && (
                            <Badge
                              variant={isSelected ? 'secondary' : 'outline'}
                              className="shrink-0 text-[10px]"
                            >
                              {itemCount} item{itemCount !== 1 ? 's' : ''}
                            </Badge>
                          )}
                        </div>
                        {hasContent && (
                          <p
                            className={`truncate text-xs ${
                              isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'
                            }`}
                          >
                            {mod.title}
                            {est > 0 ? ` - ${est}min` : ''}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Right Panel: Module Editor */}
        <AnimatePresence mode="wait">
          {currentModule && (
            <motion.div
              key={selectedDay}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.15 }}
            >
              <Card>
                <CardContent className="space-y-6 p-6">
                  {/* Module Header */}
                  <div>
                    <h3 className="text-lg font-semibold">Day {selectedDay} Module</h3>
                    <p className="text-sm text-muted-foreground">
                      Configure training items and automations for this day.
                    </p>
                  </div>

                  {/* Module Info */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="mod-title">Module Title</Label>
                      <Input
                        id="mod-title"
                        value={currentModule.title}
                        onChange={(e) => updateModule(dayIndex, { title: e.target.value })}
                        placeholder={`Day ${selectedDay}`}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mod-est">Estimated Minutes (override)</Label>
                      <Input
                        id="mod-est"
                        type="number"
                        min={0}
                        value={currentModule.estimated_minutes}
                        onChange={(e) =>
                          updateModule(dayIndex, {
                            estimated_minutes: e.target.value === '' ? '' : Number(e.target.value),
                          })
                        }
                        placeholder="Auto-calculated from items"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="mod-desc">Module Description</Label>
                      <Textarea
                        id="mod-desc"
                        value={currentModule.description}
                        onChange={(e) => updateModule(dayIndex, { description: e.target.value })}
                        placeholder="What will the BDR learn or accomplish today?"
                        rows={2}
                      />
                    </div>
                  </div>

                  <Separator />

                  {/* Training Items */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium">Training Items</h4>
                        <p className="text-xs text-muted-foreground">
                          Videos, readings, quizzes, practice tasks, checklists, resource links, or reimbursement info.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={openLibraryPicker}
                        >
                          <Library className="mr-1 h-3.5 w-3.5" />
                          Add from Library
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setTrainingItems([...currentModule.training_items, emptyTrainingItem()])
                          }
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          Add Item
                        </Button>
                      </div>
                    </div>

                    {currentModule.training_items.length === 0 && (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        No training items yet. Click &quot;Add Item&quot; to get started.
                      </p>
                    )}

                    {currentModule.training_items.map((item, itemIdx) => (
                      <Card key={item._key} className="border-dashed">
                        <CardContent className="p-4">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr_100px_auto]">
                            {/* Type */}
                            <div className="space-y-1">
                              <Label className="text-xs">Type</Label>
                              <Select
                                value={item.type}
                                onValueChange={(v) => {
                                  const updated = [...currentModule.training_items];
                                  updated[itemIdx] = { ...item, type: v as TrainingItemType };
                                  setTrainingItems(updated);
                                }}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TRAINING_ITEM_TYPES.map((t) => (
                                    <SelectItem key={t.value} value={t.value}>
                                      {t.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Title */}
                            <div className="space-y-1">
                              <Label className="text-xs">Title</Label>
                              <Input
                                value={item.title}
                                onChange={(e) => {
                                  const updated = [...currentModule.training_items];
                                  updated[itemIdx] = { ...item, title: e.target.value };
                                  setTrainingItems(updated);
                                }}
                                placeholder="Item title"
                              />
                            </div>

                            {/* Minutes */}
                            <div className="space-y-1">
                              <Label className="text-xs">Minutes</Label>
                              <Input
                                type="number"
                                min={0}
                                value={item.estimated_minutes}
                                onChange={(e) => {
                                  const updated = [...currentModule.training_items];
                                  updated[itemIdx] = {
                                    ...item,
                                    estimated_minutes:
                                      e.target.value === '' ? '' : Number(e.target.value),
                                  };
                                  setTrainingItems(updated);
                                }}
                                placeholder="Min"
                              />
                            </div>

                            {/* Remove */}
                            <div className="flex items-end">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setTrainingItems(
                                    currentModule.training_items.filter((_, i) => i !== itemIdx),
                                  );
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>

                          {/* Content / URL row */}
                          <div className="mt-3 space-y-1">
                            <Label className="text-xs">Content / URL</Label>
                            <Input
                              value={item.content}
                              onChange={(e) => {
                                const updated = [...currentModule.training_items];
                                updated[itemIdx] = { ...item, content: e.target.value };
                                setTrainingItems(updated);
                              }}
                              placeholder={
                                item.type === 'RESOURCE_LINK' || item.type === 'VIDEO'
                                  ? 'https://...'
                                  : item.type === 'CHECKLIST'
                                    ? 'Checklist items (one per line)'
                                    : item.type === 'REIMBURSEMENT_INFO'
                                      ? 'Reimbursement instructions or form URL'
                                      : 'Content or description'
                              }
                            />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <Separator />

                  {/* Automations */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium">Automations</h4>
                        <p className="text-xs text-muted-foreground">
                          Scheduled check-ins, reminders, or custom messages.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setAutomations([...currentModule.automations, emptyAutomation()])
                        }
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Add Automation
                      </Button>
                    </div>

                    {currentModule.automations.length === 0 && (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        No automations yet. Click &quot;Add Automation&quot; to schedule messages.
                      </p>
                    )}

                    {currentModule.automations.map((auto, autoIdx) => (
                      <Card key={auto._key} className="border-dashed">
                        <CardContent className="p-4">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_120px_1fr_auto]">
                            {/* Type */}
                            <div className="space-y-1">
                              <Label className="text-xs">Type</Label>
                              <Select
                                value={auto.type}
                                onValueChange={(v) => {
                                  const updated = [...currentModule.automations];
                                  updated[autoIdx] = { ...auto, type: v as AutomationType };
                                  setAutomations(updated);
                                }}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {AUTOMATION_TYPES.map((t) => (
                                    <SelectItem key={t.value} value={t.value}>
                                      {t.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Trigger Time */}
                            <div className="space-y-1">
                              <Label className="text-xs">Trigger Time</Label>
                              <Input
                                type="time"
                                value={auto.trigger_time}
                                onChange={(e) => {
                                  const updated = [...currentModule.automations];
                                  updated[autoIdx] = { ...auto, trigger_time: e.target.value };
                                  setAutomations(updated);
                                }}
                              />
                            </div>

                            {/* Content */}
                            <div className="space-y-1">
                              <Label className="text-xs">Content</Label>
                              <Textarea
                                value={auto.content}
                                onChange={(e) => {
                                  const updated = [...currentModule.automations];
                                  updated[autoIdx] = { ...auto, content: e.target.value };
                                  setAutomations(updated);
                                }}
                                placeholder="Message content or template..."
                                rows={2}
                              />
                            </div>

                            {/* Remove */}
                            <div className="flex items-end">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setAutomations(
                                    currentModule.automations.filter((_, i) => i !== autoIdx),
                                  );
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Save Error Display */}
      {(createMut.isError || updateMut.isError) && (
        <Card className="border-destructive">
          <CardContent className="p-4">
            <p className="text-sm text-destructive">
              Failed to save plan:{' '}
              {(createMut.error as Error)?.message ??
                (updateMut.error as Error)?.message ??
                'Unknown error'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Library Picker Dialog */}
      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add from Content Library</DialogTitle>
            <DialogDescription>
              Search and select a training item from the shared library.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={librarySearch}
              onChange={(e) => handleLibrarySearch(e.target.value)}
              placeholder="Search library items..."
              className="pl-9"
            />
          </div>
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2 pr-2">
              {libraryLoading && (
                <p className="py-4 text-center text-sm text-muted-foreground">Loading...</p>
              )}
              {!libraryLoading && libraryItems.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No library items found.
                </p>
              )}
              {!libraryLoading &&
                libraryItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectLibraryItem(item)}
                    className="flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted"
                  >
                    <Badge variant="secondary" className="mt-0.5 shrink-0 text-[10px]">
                      {item.type}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.title}</p>
                      {item.estimated_minutes && (
                        <p className="text-xs text-muted-foreground">
                          {item.estimated_minutes} min
                        </p>
                      )}
                      {item.category_tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.category_tags.map((tag) => (
                            <Badge key={tag} variant="outline" className="text-[10px]">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Plan Preview: {settings.name || 'Untitled'}</DialogTitle>
            <DialogDescription>
              {settings.duration_days}-day onboarding plan
              {settings.weekdays_only ? ' (weekdays only)' : ''}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[500px]">
            <div className="space-y-4 pr-4">
              {(previewData ?? modules).map((entry, idx) => {
                // Handle both PlanPreviewDay[] and LocalModule[]
                const isPreviewDay = 'dm_blocks' in entry;
                const dayNum = isPreviewDay
                  ? (entry as PlanPreviewDay).day_number
                  : (entry as LocalModule).day_number;
                const title = isPreviewDay
                  ? (entry as PlanPreviewDay).module_title
                  : (entry as LocalModule).title;
                const items = isPreviewDay
                  ? []
                  : (entry as LocalModule).training_items;
                const autos = isPreviewDay
                  ? (entry as PlanPreviewDay).automations
                  : (entry as LocalModule).automations.map((a) => ({
                      type: a.type,
                      trigger_time: a.trigger_time,
                      content: a.content || null,
                    }));

                return (
                  <div key={idx} className="rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        Day {dayNum}
                      </Badge>
                      <span className="text-sm font-medium">{title}</span>
                    </div>
                    {!isPreviewDay && items.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {items.map((ti, tiIdx) => (
                          <div key={tiIdx} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="secondary" className="text-[10px]">
                              {ti.type}
                            </Badge>
                            <span>{ti.title || 'Untitled'}</span>
                            {ti.estimated_minutes !== '' && (
                              <span className="ml-auto">{ti.estimated_minutes}min</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {autos.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {autos.map((a, aIdx) => (
                          <div key={aIdx} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="secondary" className="text-[10px]">
                              {a.type}
                            </Badge>
                            <span>at {a.trigger_time}</span>
                            {a.content && (
                              <span className="truncate">{a.content}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
