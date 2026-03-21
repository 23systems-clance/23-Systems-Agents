/**
 * CRM Field Mappings page.
 *
 * Apollo-style two-column layout for managing field mappings between
 * canonical fields and CRM properties. Includes auto-map, add fields,
 * overwrite toggles, and bulk save.
 */

import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Save, Wand2, Plus, Trash2, Search,
  ArrowRight, GripVertical,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  getConnection,
  listFieldMappings,
  getCrmProperties,
  bulkUpdateFieldMappings,
  autoDetectMappings,
  type CrmFieldMapping,
} from '@/services/crm';
import { queryKeys } from '@/lib/query-keys';

/** Canonical field category groupings for the add-field modal. */
const CANONICAL_FIELD_GROUPS: Record<string, string[]> = {
  'Name': ['firstName', 'lastName'],
  'Contact Info': ['email', 'jobTitle', 'company'],
  'Phone Numbers': ['phone', 'mobilePhone'],
  'Location': ['city', 'state', 'country'],
  'Links': ['linkedinUrl'],
  'Enrichment Data': ['enrichmentSource', 'enrichmentDate', 'techSpendTier', 'enrichmentJobId'],
};

/** Overwrite rule groups (maps to Apollo's "Data Writing Rules"). */
const OVERWRITE_GROUPS: Record<string, string[]> = {
  'Name': ['firstName', 'lastName'],
  'Job Title': ['jobTitle'],
  'Phone Numbers': ['phone', 'mobilePhone'],
  'Emails': ['email'],
  'Location': ['city', 'state', 'country'],
  'Links': ['linkedinUrl'],
  'Company': ['company'],
  'Enrichment': ['enrichmentSource', 'enrichmentDate', 'techSpendTier', 'enrichmentJobId'],
};

export default function CrmFieldMappingsPage() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [searchFilter, setSearchFilter] = useState('');
  const [localMappings, setLocalMappings] = useState<CrmFieldMapping[] | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [addFieldOpen, setAddFieldOpen] = useState(false);

  // Fetch connection details
  const { data: connection } = useQuery({
    queryKey: queryKeys.crm.connection(connectionId!),
    queryFn: () => getConnection(connectionId!),
    enabled: !!connectionId,
  });

  // Fetch field mappings
  const { data: mappingData, isLoading: mappingsLoading } = useQuery({
    queryKey: queryKeys.crm.fieldMappings(connectionId!),
    queryFn: () => listFieldMappings(connectionId!),
    enabled: !!connectionId,
  });

  // Fetch CRM properties for dropdowns
  const { data: crmProperties = [] } = useQuery({
    queryKey: queryKeys.crm.properties(connectionId!),
    queryFn: () => getCrmProperties(connectionId!),
    enabled: !!connectionId,
  });

  // Initialize local mappings from server data
  const mappings = localMappings ?? mappingData?.mappings ?? [];
  const unmappedFields = mappingData?.unmappedCanonicalFields ?? [];

  // Bulk save mutation
  const saveMutation = useMutation({
    mutationFn: () =>
      bulkUpdateFieldMappings(
        connectionId!,
        mappings.map((m, i) => ({
          canonicalField: m.canonicalField,
          crmProperty: m.crmProperty,
          crmPropertyLabel: m.crmPropertyLabel ?? undefined,
          dataType: m.dataType,
          overwriteExisting: m.overwriteExisting,
          syncDirection: m.syncDirection,
          displayOrder: i,
        })),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.crm.fieldMappings(connectionId!) });
      setLocalMappings(null);
      setIsDirty(false);
    },
  });

  // Auto-map mutation
  const autoMapMutation = useMutation({
    mutationFn: () => autoDetectMappings(connectionId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.crm.fieldMappings(connectionId!) });
      setLocalMappings(null);
      setIsDirty(false);
    },
  });

  // Filter mappings by search
  const filteredMappings = useMemo(() => {
    if (!searchFilter) return mappings;
    const q = searchFilter.toLowerCase();
    return mappings.filter(
      (m) =>
        m.canonicalField.toLowerCase().includes(q) ||
        m.crmProperty.toLowerCase().includes(q),
    );
  }, [mappings, searchFilter]);

  // Update a single mapping's CRM property
  const updateMappingProperty = (index: number, crmProperty: string) => {
    const updated = [...mappings];
    const prop = crmProperties.find((p) => p.name === crmProperty);
    updated[index] = {
      ...updated[index],
      crmProperty,
      crmPropertyLabel: prop?.label ?? null,
    };
    setLocalMappings(updated);
    setIsDirty(true);
  };

  // Remove a mapping
  const removeMapping = (index: number) => {
    const updated = mappings.filter((_, i) => i !== index);
    setLocalMappings(updated);
    setIsDirty(true);
  };

  // Add new field mappings
  const addMappings = (fields: string[]) => {
    const updated = [...mappings];
    for (const field of fields) {
      if (!updated.some((m) => m.canonicalField === field)) {
        updated.push({
          id: `new-${Date.now()}-${field}`,
          crmConnectionId: connectionId!,
          canonicalField: field,
          crmProperty: '',
          crmPropertyLabel: null,
          dataType: 'string',
          transformRule: null,
          isRequired: false,
          syncDirection: 'TO_CRM',
          overwriteExisting: true,
          displayOrder: updated.length,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as CrmFieldMapping);
      }
    }
    setLocalMappings(updated);
    setIsDirty(true);
    setAddFieldOpen(false);
  };

  // Toggle overwrite for a group of fields
  const toggleOverwriteGroup = (fields: string[], value: boolean) => {
    const updated = mappings.map((m) =>
      fields.includes(m.canonicalField) ? { ...m, overwriteExisting: value } : m,
    );
    setLocalMappings(updated);
    setIsDirty(true);
  };

  if (mappingsLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 p-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/crm/connections')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Field Mappings</h1>
            <p className="text-sm text-muted-foreground">
              {connection?.client?.name} — {connection?.displayName || connection?.crmType}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => autoMapMutation.mutate()}
            disabled={autoMapMutation.isPending}
          >
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            Auto-Map
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={!isDirty || saveMutation.isPending}
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Save
          </Button>
        </div>
      </div>

      {/* Tabs: Fields + Data Writing Rules */}
      <Tabs defaultValue="fields">
        <TabsList>
          <TabsTrigger value="fields">Fields</TabsTrigger>
          <TabsTrigger value="rules">Data Writing Rules</TabsTrigger>
        </TabsList>

        {/* Fields Tab */}
        <TabsContent value="fields" className="space-y-4">
          {/* Toolbar */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search fields..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="pl-9"
              />
            </div>
            <Dialog open={addFieldOpen} onOpenChange={setAddFieldOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Field
                </Button>
              </DialogTrigger>
              <AddFieldModal
                unmappedFields={unmappedFields}
                mappedFields={mappings.map((m) => m.canonicalField)}
                onAdd={addMappings}
              />
            </Dialog>
            <Badge variant="secondary">{mappings.length} mapped</Badge>
          </div>

          {/* Mapping table */}
          <Card>
            <div className="divide-y">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-4 px-4 py-3 bg-muted/50 text-sm font-medium text-muted-foreground">
                <span>Canonical Field</span>
                <span />
                <span>CRM Property</span>
                <span />
              </div>

              {filteredMappings.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  {searchFilter ? 'No matching fields' : 'No field mappings configured'}
                </div>
              ) : (
                filteredMappings.map((mapping) => (
                  <div
                    key={mapping.id}
                    className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-4 px-4 py-2.5 hover:bg-muted/30 transition-colors"
                  >
                    {/* Canonical field */}
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
                      <span className="font-mono text-sm">{mapping.canonicalField}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5">
                        {mapping.dataType}
                      </Badge>
                    </div>

                    {/* Arrow */}
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />

                    {/* CRM property dropdown */}
                    <Select
                      value={mapping.crmProperty || undefined}
                      onValueChange={(val) => {
                        const realIndex = mappings.findIndex((m) => m.id === mapping.id);
                        updateMappingProperty(realIndex, val);
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select property..." />
                      </SelectTrigger>
                      <SelectContent>
                        {crmProperties.map((prop) => (
                          <SelectItem key={prop.name} value={prop.name}>
                            {prop.label} ({prop.name})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Delete */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        const realIndex = mappings.findIndex((m) => m.id === mapping.id);
                        removeMapping(realIndex);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </Card>
        </TabsContent>

        {/* Data Writing Rules Tab */}
        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Data Writing Rules</CardTitle>
              <p className="text-sm text-muted-foreground">
                Control whether existing CRM data is overwritten during import.
                When disabled, fields will only be written if the CRM property is empty.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(OVERWRITE_GROUPS).map(([groupName, fields]) => {
                  const groupMappings = mappings.filter((m) => fields.includes(m.canonicalField));
                  if (groupMappings.length === 0) return null;

                  const allOverwrite = groupMappings.every((m) => m.overwriteExisting);

                  return (
                    <div
                      key={groupName}
                      className="flex items-center justify-between rounded-lg border px-4 py-3"
                    >
                      <div>
                        <Label className="text-sm font-medium">{groupName}</Label>
                        <p className="text-xs text-muted-foreground">
                          {groupMappings.map((m) => m.canonicalField).join(', ')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {allOverwrite ? 'Overwrite' : 'Skip if exists'}
                        </span>
                        <Switch
                          checked={allOverwrite}
                          onCheckedChange={(checked) => toggleOverwriteGroup(fields, checked)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={!isDirty || saveMutation.isPending}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              Save Rules
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}

/** Modal for adding unmapped canonical fields. */
function AddFieldModal({
  unmappedFields,
  mappedFields,
  onAdd,
}: {
  unmappedFields: string[];
  mappedFields: string[];
  onAdd: (fields: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  // Get all unmapped fields grouped by category
  const allUnmapped = new Set([
    ...unmappedFields,
    ...Object.values(CANONICAL_FIELD_GROUPS)
      .flat()
      .filter((f) => !mappedFields.includes(f)),
  ]);

  const toggle = (field: string) => {
    const next = new Set(selected);
    if (next.has(field)) {
      next.delete(field);
    } else {
      next.add(field);
    }
    setSelected(next);
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Add Fields to Map</DialogTitle>
        <DialogDescription>
          Select canonical fields to add to your mapping configuration.
        </DialogDescription>
      </DialogHeader>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search fields..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="max-h-64 overflow-y-auto space-y-4">
        {Object.entries(CANONICAL_FIELD_GROUPS).map(([group, fields]) => {
          const available = fields.filter(
            (f) => allUnmapped.has(f) && (!search || f.toLowerCase().includes(search.toLowerCase())),
          );
          if (available.length === 0) return null;

          return (
            <div key={group}>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                {group}
              </h4>
              <div className="space-y-1">
                {available.map((field) => (
                  <label
                    key={field}
                    className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(field)}
                      onChange={() => toggle(field)}
                      className="rounded"
                    />
                    <span className="font-mono">{field}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <DialogFooter>
        <Button
          onClick={() => onAdd(Array.from(selected))}
          disabled={selected.size === 0}
        >
          Add {selected.size} Field{selected.size !== 1 ? 's' : ''}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
