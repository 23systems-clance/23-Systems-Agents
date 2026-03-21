import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Plus,
  Trash2,
  Zap,
  MessageSquare,
  MousePointerClick,
  FileText,
  Database,
  GitBranch,
  Play,
  Clock,
  FileCode,
  Globe,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props accepted by the NodeConfigPanel component. */
export interface NodeConfigPanelProps {
  /** The currently selected node, or null if nothing is selected. */
  node: { id: string; type: string; data: Record<string, unknown> } | null;
  /** Called when the user saves the updated node configuration. */
  onSave: (nodeId: string, data: Record<string, unknown>) => void;
  /** Called when the panel should close. */
  onClose: () => void;
  /** Called when the user deletes the selected node. */
  onDelete?: (nodeId: string) => void;
}

/** A single button option used in BUTTON_CHOICE configuration. */
interface ButtonOption {
  id: string;
  label: string;
  value?: string;
  style?: 'primary' | 'danger' | '';
  color?: string;
}

/** A single field in a FORM_MODAL configuration. */
interface FormField {
  id: string;
  type: string;
  label: string;
  required: boolean;
  placeholder: string;
}

/** A key-value parameter row used in ACTION configuration. */
interface ParamRow {
  key: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Node type metadata (icons and display names)
// ---------------------------------------------------------------------------

/** Maps node types to their display icon and color classes. */
const NODE_META: Record<
  string,
  {
    icon: React.ElementType;
    label: string;
    iconBg: string;
    iconColor: string;
  }
> = {
  TRIGGER: {
    icon: Zap,
    label: 'Trigger',
    iconBg: 'bg-green-100',
    iconColor: 'text-green-600',
  },
  MESSAGE: {
    icon: MessageSquare,
    label: 'Message',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  BUTTON_CHOICE: {
    icon: MousePointerClick,
    label: 'Button Choice',
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-600',
  },
  FORM_MODAL: {
    icon: FileText,
    label: 'Form Modal',
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
  },
  ENRICHMENT: {
    icon: Database,
    label: 'Enrichment',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  CONDITION: {
    icon: GitBranch,
    label: 'Condition',
    iconBg: 'bg-yellow-100',
    iconColor: 'text-yellow-600',
  },
  ACTION: {
    icon: Play,
    label: 'Action',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
  },
  DELAY: {
    icon: Clock,
    label: 'Delay',
    iconBg: 'bg-slate-100',
    iconColor: 'text-slate-600',
  },
  HUBSPOT: {
    icon: Database,
    label: 'HubSpot',
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-600',
  },
  PARSER: {
    icon: FileCode,
    label: 'Parser',
    iconBg: 'bg-cyan-100',
    iconColor: 'text-cyan-600',
  },
  API_CALL: {
    icon: Globe,
    label: 'API Call',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Converts a label string to a kebab-case id. */
function toId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Creates a unique id for a new item by appending a timestamp suffix. */
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Styled textarea (no Textarea UI component available)
// ---------------------------------------------------------------------------

/** Textarea styled to match the project's Input component. */
function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea
      {...props}
      className={cn(
        'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        props.className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Per-node-type form components
// ---------------------------------------------------------------------------

/** Configuration form for TRIGGER nodes. */
function TriggerForm({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const triggerType = (data.triggerType as string) ?? '';
  const pattern = (data.pattern as string) ?? '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="triggerType">Trigger Type</Label>
        <Select
          value={triggerType}
          onValueChange={(v) => onChange({ ...data, triggerType: v })}
        >
          <SelectTrigger id="triggerType">
            <SelectValue placeholder="Select trigger type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="FILE_UPLOAD">File Upload</SelectItem>
            <SelectItem value="KEYWORD">Keyword</SelectItem>
            <SelectItem value="SLASH_COMMAND">Slash Command</SelectItem>
            <SelectItem value="WEBHOOK">Webhook</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(triggerType === 'KEYWORD' || triggerType === 'SLASH_COMMAND') && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pattern">
            {triggerType === 'KEYWORD' ? 'Keyword Pattern' : 'Command'}
          </Label>
          <Input
            id="pattern"
            value={pattern}
            onChange={(e) => onChange({ ...data, pattern: e.target.value })}
            placeholder={
              triggerType === 'KEYWORD'
                ? 'e.g. ENRICH'
                : 'e.g. /enrich'
            }
          />
        </div>
      )}

      {triggerType === 'WEBHOOK' && (
        <div className="rounded-md bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">
            A unique webhook URL will be generated when this workflow is published.
            Send POST requests to the URL to trigger the workflow.
          </p>
        </div>
      )}
    </div>
  );
}

/** Configuration form for MESSAGE nodes. */
function MessageForm({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const messageText = (data.messageText as string) ?? '';
  const ephemeral = (data.ephemeral as boolean) ?? false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="messageText">Message Text</Label>
        <Textarea
          id="messageText"
          rows={4}
          value={messageText}
          onChange={(e) => onChange({ ...data, messageText: e.target.value })}
          placeholder="Supports Slack mrkdwn formatting"
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="ephemeral">Ephemeral (visible only to user)</Label>
        <Switch
          id="ephemeral"
          checked={ephemeral}
          onCheckedChange={(checked) =>
            onChange({ ...data, ephemeral: checked })
          }
        />
      </div>
    </div>
  );
}

/** Style options for Slack buttons. */
const BUTTON_STYLE_OPTIONS = [
  { value: '', label: 'Default', color: 'bg-gray-100 text-gray-700 border-gray-200' },
  { value: 'primary', label: 'Primary (Green)', color: 'bg-green-100 text-green-700 border-green-300' },
  { value: 'danger', label: 'Danger (Red)', color: 'bg-red-100 text-red-700 border-red-300' },
] as const;

/** Configuration form for BUTTON_CHOICE nodes. */
function ButtonChoiceForm({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const buttons = (data.buttons as ButtonOption[] | undefined) ?? [];
  const prompt = (data.prompt as string) ?? '';
  const outputVariable = (data.outputVariable as string) ?? '';

  /** Updates a specific button field. */
  const updateButton = useCallback(
    (index: number, field: keyof ButtonOption, value: string) => {
      const next = [...buttons];
      const updated = { ...next[index], [field]: value };
      // Auto-derive id from label when label changes.
      if (field === 'label') {
        updated.id = toId(value) || next[index].id;
        // Also auto-derive value from label if value is empty.
        if (!next[index].value) {
          updated.value = toId(value);
        }
      }
      next[index] = updated;
      onChange({ ...data, buttons: next });
    },
    [buttons, data, onChange],
  );

  /** Adds a new empty button. */
  const addButton = useCallback(() => {
    onChange({
      ...data,
      buttons: [...buttons, { id: uniqueId('btn'), label: '', value: '', style: '' }],
    });
  }, [buttons, data, onChange]);

  /** Removes a button at the given index. */
  const removeButton = useCallback(
    (index: number) => {
      onChange({ ...data, buttons: buttons.filter((_, i) => i !== index) });
    },
    [buttons, data, onChange],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Prompt text */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="prompt">Prompt</Label>
        <Textarea
          id="prompt"
          value={prompt}
          onChange={(e) => onChange({ ...data, prompt: e.target.value })}
          placeholder="Message shown above the buttons"
          rows={2}
        />
      </div>

      {/* Buttons */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label>Buttons</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addButton}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>

        {buttons.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            No buttons configured. Add at least 2.
          </p>
        )}

        <div className="flex flex-col gap-3">
          {buttons.map((btn, idx) => {
            const hasCustomColor = !!btn.color;
            const previewBg = hasCustomColor ? btn.color : undefined;
            const styleInfo = BUTTON_STYLE_OPTIONS.find((s) => s.value === (btn.style || '')) ?? BUTTON_STYLE_OPTIONS[0];
            const cardClass = hasCustomColor ? 'rounded-md border p-2 flex flex-col gap-1.5' : cn('rounded-md border p-2 flex flex-col gap-1.5', styleInfo.color);
            return (
              <div
                key={btn.id}
                className={cardClass}
                style={hasCustomColor ? { backgroundColor: `${previewBg}20`, borderColor: previewBg } : undefined}
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={btn.label}
                    onChange={(e) => updateButton(idx, 'label', e.target.value)}
                    placeholder={`Button ${idx + 1} label`}
                    className="flex-1 h-8 text-sm bg-white"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => removeButton(idx)}
                    disabled={buttons.length <= 2}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={btn.value ?? ''}
                    onChange={(e) => updateButton(idx, 'value', e.target.value)}
                    placeholder="Value"
                    className="flex-1 h-7 text-xs bg-white"
                  />
                  <select
                    value={btn.style || ''}
                    onChange={(e) => {
                      updateButton(idx, 'style', e.target.value);
                      // Clear custom color when switching to a preset
                      if (e.target.value) {
                        const next = [...buttons];
                        next[idx] = { ...next[idx], style: e.target.value as ButtonOption['style'], color: undefined };
                        onChange({ ...data, buttons: next });
                      }
                    }}
                    className="h-7 rounded border border-input bg-white px-2 text-xs"
                  >
                    {BUTTON_STYLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Custom color picker */}
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Color</Label>
                  <input
                    type="color"
                    value={btn.color || '#8b5cf6'}
                    onChange={(e) => {
                      const next = [...buttons];
                      next[idx] = { ...next[idx], color: e.target.value, style: '' };
                      onChange({ ...data, buttons: next });
                    }}
                    className="h-7 w-8 rounded border border-input cursor-pointer p-0"
                  />
                  <Input
                    value={btn.color || ''}
                    onChange={(e) => {
                      const next = [...buttons];
                      next[idx] = { ...next[idx], color: e.target.value || undefined, style: e.target.value ? '' : next[idx].style };
                      onChange({ ...data, buttons: next });
                    }}
                    placeholder="#hex or clear"
                    className="flex-1 h-7 text-xs bg-white"
                  />
                  {btn.color && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => {
                        const next = [...buttons];
                        next[idx] = { ...next[idx], color: undefined };
                        onChange({ ...data, buttons: next });
                      }}
                      title="Clear custom color"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {buttons.length > 0 && buttons.length < 2 && (
          <p className="text-xs text-destructive">
            Minimum 2 buttons required.
          </p>
        )}
      </div>

      {/* Output variable */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="outputVariable">Output Variable</Label>
        <Input
          id="outputVariable"
          value={outputVariable}
          onChange={(e) =>
            onChange({ ...data, outputVariable: e.target.value })
          }
          placeholder="e.g. selectedOption"
        />
      </div>
    </div>
  );
}

/** Configuration form for FORM_MODAL nodes. */
function FormModalForm({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const formTitle = (data.formTitle as string) ?? '';
  const fields = (data.fields as FormField[] | undefined) ?? [];

  /** Updates a field property at the given index. */
  const updateField = useCallback(
    (index: number, patch: Partial<FormField>) => {
      const next = [...fields];
      next[index] = { ...next[index], ...patch };
      onChange({ ...data, fields: next });
    },
    [fields, data, onChange],
  );

  /** Adds a new empty field. */
  const addField = useCallback(() => {
    const newField: FormField = {
      id: uniqueId('field'),
      type: 'text',
      label: '',
      required: false,
      placeholder: '',
    };
    onChange({ ...data, fields: [...fields, newField] });
  }, [fields, data, onChange]);

  /** Removes a field at the given index. */
  const removeField = useCallback(
    (index: number) => {
      onChange({ ...data, fields: fields.filter((_, i) => i !== index) });
    },
    [fields, data, onChange],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="formTitle">Title</Label>
        <Input
          id="formTitle"
          value={formTitle}
          onChange={(e) => onChange({ ...data, formTitle: e.target.value })}
          placeholder="Form title"
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label>Fields</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addField}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>

        {fields.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            No fields configured.
          </p>
        )}

        <div className="flex flex-col gap-3">
          {fields.map((field, idx) => (
            <div
              key={field.id}
              className="rounded-md border border-border p-3 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Field {idx + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => removeField(idx)}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Type</Label>
                <Select
                  value={field.type}
                  onValueChange={(v) => updateField(idx, { type: v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="select">Select</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Label</Label>
                <Input
                  value={field.label}
                  onChange={(e) =>
                    updateField(idx, { label: e.target.value })
                  }
                  placeholder="Field label"
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Placeholder</Label>
                <Input
                  value={field.placeholder}
                  onChange={(e) =>
                    updateField(idx, { placeholder: e.target.value })
                  }
                  placeholder="Placeholder text"
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-xs">Required</Label>
                <Switch
                  checked={field.required}
                  onCheckedChange={(checked) =>
                    updateField(idx, { required: checked })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Configuration form for ENRICHMENT nodes. */
function EnrichmentForm({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const enrichmentType = (data.enrichmentType as string) ?? '';
  const fileSourceVariable = (data.fileSourceVariable as string) ?? '';
  const purpose = (data.purpose as string) ?? '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="enrichmentType">Enrichment Type</Label>
        <Select
          value={enrichmentType}
          onValueChange={(v) => onChange({ ...data, enrichmentType: v })}
        >
          <SelectTrigger id="enrichmentType">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="COMPANY">Company</SelectItem>
            <SelectItem value="CONTACT">Contact</SelectItem>
            <SelectItem value="COMBINED">Combined</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fileSourceVariable">File Source Variable</Label>
        <Input
          id="fileSourceVariable"
          value={fileSourceVariable}
          onChange={(e) =>
            onChange({ ...data, fileSourceVariable: e.target.value })
          }
          placeholder="e.g. uploadedFile"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="purpose">Purpose</Label>
        <Select
          value={purpose}
          onValueChange={(v) => onChange({ ...data, purpose: v })}
        >
          <SelectTrigger id="purpose">
            <SelectValue placeholder="Select purpose" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="SALES">Sales</SelectItem>
            <SelectItem value="MARKETING">Marketing</SelectItem>
            <SelectItem value="RESEARCH">Research</SelectItem>
            <SelectItem value="OTHER">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** Configuration form for CONDITION nodes. */
function ConditionForm({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const evaluationField = (data.evaluationField as string) ?? '';
  const operator = (data.operator as string) ?? '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="evaluationField">Evaluation Field</Label>
        <Input
          id="evaluationField"
          value={evaluationField}
          onChange={(e) =>
            onChange({ ...data, evaluationField: e.target.value })
          }
          placeholder="e.g. selectedOption"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="operator">Operator</Label>
        <Select
          value={operator}
          onValueChange={(v) => onChange({ ...data, operator: v })}
        >
          <SelectTrigger id="operator">
            <SelectValue placeholder="Select operator" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="equals">Equals</SelectItem>
            <SelectItem value="not_equals">Not Equals</SelectItem>
            <SelectItem value="contains">Contains</SelectItem>
            <SelectItem value="exists">Exists</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** Configuration form for ACTION nodes. */
function ActionForm({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const actionType = (data.actionType as string) ?? '';
  const params = (data.parameters as ParamRow[] | undefined) ?? [];

  /** Updates a parameter row at the given index. */
  const updateParam = useCallback(
    (index: number, patch: Partial<ParamRow>) => {
      const next = [...params];
      next[index] = { ...next[index], ...patch };
      onChange({ ...data, parameters: next });
    },
    [params, data, onChange],
  );

  /** Adds a new empty parameter row. */
  const addParam = useCallback(() => {
    onChange({ ...data, parameters: [...params, { key: '', value: '' }] });
  }, [params, data, onChange]);

  /** Removes a parameter row at the given index. */
  const removeParam = useCallback(
    (index: number) => {
      onChange({
        ...data,
        parameters: params.filter((_, i) => i !== index),
      });
    },
    [params, data, onChange],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="actionType">Action Type</Label>
        <Select
          value={actionType}
          onValueChange={(v) => onChange({ ...data, actionType: v })}
        >
          <SelectTrigger id="actionType">
            <SelectValue placeholder="Select action type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="SEND_MESSAGE">Send Message</SelectItem>
            <SelectItem value="CREATE_JOB">Create Job</SelectItem>
            <SelectItem value="UPLOAD_FILE">Upload File</SelectItem>
            <SelectItem value="NOTIFY">Notify</SelectItem>
            <SelectItem value="ASSIGN_TO_CAMPAIGN">Assign to Campaign</SelectItem>
            <SelectItem value="GET_EMAIL">Get Email</SelectItem>
            <SelectItem value="GET_PHONE">Get Phone</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label>Parameters</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addParam}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>

        {params.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            No parameters configured.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {params.map((row, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                value={row.key}
                onChange={(e) => updateParam(idx, { key: e.target.value })}
                placeholder="Key"
                className="flex-1"
              />
              <Input
                value={row.value}
                onChange={(e) => updateParam(idx, { value: e.target.value })}
                placeholder="Value"
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeParam(idx)}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Configuration form for DELAY nodes. */
function DelayForm({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const delaySeconds = (data.delaySeconds as number | undefined) ?? undefined;
  const durationVariable = (data.durationVariable as string) ?? '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="delaySeconds">Duration (seconds)</Label>
        <Input
          id="delaySeconds"
          type="number"
          min={0}
          value={delaySeconds ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            onChange({
              ...data,
              delaySeconds: val === '' ? undefined : Number(val),
            });
          }}
          placeholder="e.g. 60"
        />
      </div>

      <div className="flex items-center gap-2">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">OR</span>
        <Separator className="flex-1" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="durationVariable">Duration Variable</Label>
        <Input
          id="durationVariable"
          value={durationVariable}
          onChange={(e) =>
            onChange({ ...data, durationVariable: e.target.value })
          }
          placeholder="e.g. waitTime"
        />
      </div>
    </div>
  );
}

/** Configuration form for HUBSPOT nodes. */
function HubSpotForm({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const mode = (data.mode as string) ?? 'import';
  const listId = (data.listId as string) ?? '';
  const fuzzyThreshold = (data.fuzzyThreshold as number) ?? 85;
  const createNewRecords = (data.createNewRecords as boolean) ?? true;
  const updateExisting = (data.updateExisting as boolean) ?? true;
  const outputVariable = (data.outputVariable as string) ?? '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mode">Mode</Label>
        <Select
          value={mode}
          onValueChange={(v) => onChange({ ...data, mode: v })}
        >
          <SelectTrigger id="mode">
            <SelectValue placeholder="Select mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="import">Import from List</SelectItem>
            <SelectItem value="sync">Sync Contacts</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === 'import' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="listId">HubSpot List ID</Label>
          <Input
            id="listId"
            value={listId}
            onChange={(e) => onChange({ ...data, listId: e.target.value })}
            placeholder="e.g. 12345"
          />
        </div>
      )}

      {mode === 'sync' && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fuzzyThreshold">
              Fuzzy Match Threshold (0-100)
            </Label>
            <Input
              id="fuzzyThreshold"
              type="number"
              min={0}
              max={100}
              value={fuzzyThreshold}
              onChange={(e) =>
                onChange({ ...data, fuzzyThreshold: Number(e.target.value) })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="createNewRecords">Create New Records</Label>
            <Switch
              id="createNewRecords"
              checked={createNewRecords}
              onCheckedChange={(checked) =>
                onChange({ ...data, createNewRecords: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="updateExisting">Update Existing Records</Label>
            <Switch
              id="updateExisting"
              checked={updateExisting}
              onCheckedChange={(checked) =>
                onChange({ ...data, updateExisting: checked })
              }
            />
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="outputVariable">Output Variable</Label>
        <Input
          id="outputVariable"
          value={outputVariable}
          onChange={(e) =>
            onChange({ ...data, outputVariable: e.target.value })
          }
          placeholder="e.g. hubspotContacts"
        />
      </div>
    </div>
  );
}

/** Configuration form for PARSER nodes. */
function ParserForm({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const parseMode = (data.parseMode as string) ?? 'json';
  const jsonRootPath = (data.jsonRootPath as string) ?? '';
  const csvDelimiter = (data.csvDelimiter as string) ?? ',';
  const csvHasHeaders = (data.csvHasHeaders as boolean) ?? true;
  const inputVariable = (data.inputVariable as string) ?? '';
  const outputVariable = (data.outputVariable as string) ?? '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="parseMode">Parse Mode</Label>
        <Select
          value={parseMode}
          onValueChange={(v) => onChange({ ...data, parseMode: v })}
        >
          <SelectTrigger id="parseMode">
            <SelectValue placeholder="Select format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="json">JSON</SelectItem>
            <SelectItem value="csv">CSV</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {parseMode === 'json' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="jsonRootPath">JSON Root Path</Label>
          <Input
            id="jsonRootPath"
            value={jsonRootPath}
            onChange={(e) =>
              onChange({ ...data, jsonRootPath: e.target.value })
            }
            placeholder="e.g. data.contacts"
          />
        </div>
      )}

      {parseMode === 'csv' && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="csvDelimiter">Delimiter</Label>
            <Input
              id="csvDelimiter"
              value={csvDelimiter}
              onChange={(e) =>
                onChange({ ...data, csvDelimiter: e.target.value })
              }
              placeholder=","
              maxLength={1}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="csvHasHeaders">Has Header Row</Label>
            <Switch
              id="csvHasHeaders"
              checked={csvHasHeaders}
              onCheckedChange={(checked) =>
                onChange({ ...data, csvHasHeaders: checked })
              }
            />
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inputVariable">Input Variable</Label>
        <Input
          id="inputVariable"
          value={inputVariable}
          onChange={(e) =>
            onChange({ ...data, inputVariable: e.target.value })
          }
          placeholder="e.g. rawData"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="outputVariable">Output Variable</Label>
        <Input
          id="outputVariable"
          value={outputVariable}
          onChange={(e) =>
            onChange({ ...data, outputVariable: e.target.value })
          }
          placeholder="e.g. parsedRows"
        />
      </div>
    </div>
  );
}

/** Configuration form for API_CALL nodes. */
function ApiCallForm({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const method = (data.method as string) ?? 'GET';
  const url = (data.url as string) ?? '';
  const bodyTemplate = (data.bodyTemplate as string) ?? '';
  const authType = (data.authType as string) ?? 'none';
  const maxRetries = (data.maxRetries as number) ?? 3;
  const timeoutMs = (data.timeoutMs as number) ?? 30000;
  const outputVariable = (data.outputVariable as string) ?? '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="method">HTTP Method</Label>
        <Select
          value={method}
          onValueChange={(v) => onChange({ ...data, method: v })}
        >
          <SelectTrigger id="method">
            <SelectValue placeholder="Select method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="GET">GET</SelectItem>
            <SelectItem value="POST">POST</SelectItem>
            <SelectItem value="PUT">PUT</SelectItem>
            <SelectItem value="DELETE">DELETE</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="url">URL</Label>
        <Input
          id="url"
          value={url}
          onChange={(e) => onChange({ ...data, url: e.target.value })}
          placeholder="https://api.example.com/endpoint"
        />
        <p className="text-[11px] text-muted-foreground">
          Use {'{{variable}}'} for interpolation
        </p>
      </div>

      {['POST', 'PUT'].includes(method) && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bodyTemplate">Request Body (JSON)</Label>
          <Textarea
            id="bodyTemplate"
            rows={4}
            value={bodyTemplate}
            onChange={(e) =>
              onChange({ ...data, bodyTemplate: e.target.value })
            }
            placeholder='{"key": "{{value}}"}'
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="authType">Authentication</Label>
        <Select
          value={authType}
          onValueChange={(v) => onChange({ ...data, authType: v })}
        >
          <SelectTrigger id="authType">
            <SelectValue placeholder="Select auth type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="api_key">API Key</SelectItem>
            <SelectItem value="bearer">Bearer Token</SelectItem>
            <SelectItem value="hmac">HMAC</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="maxRetries">Max Retries</Label>
        <Input
          id="maxRetries"
          type="number"
          min={0}
          max={5}
          value={maxRetries}
          onChange={(e) =>
            onChange({ ...data, maxRetries: Number(e.target.value) })
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="timeoutMs">Timeout (ms)</Label>
        <Input
          id="timeoutMs"
          type="number"
          min={1000}
          max={120000}
          value={timeoutMs}
          onChange={(e) =>
            onChange({ ...data, timeoutMs: Number(e.target.value) })
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="outputVariable">Output Variable</Label>
        <Input
          id="outputVariable"
          value={outputVariable}
          onChange={(e) =>
            onChange({ ...data, outputVariable: e.target.value })
          }
          placeholder="e.g. apiResponse"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel component
// ---------------------------------------------------------------------------

/**
 * Right sidebar panel for editing node-specific configuration.
 *
 * Opens when a node is selected on the workflow canvas and renders a
 * type-specific configuration form. The save button pushes the updated
 * data back to the graph state via `onSave`.
 */
export function NodeConfigPanel({ node, onSave, onClose, onDelete }: NodeConfigPanelProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Re-initialise local form state whenever the selected node changes.
  useEffect(() => {
    if (node) {
      setFormData({ ...node.data });
    } else {
      setFormData({});
    }
    setConfirmDelete(false);
  }, [node]);

  /** Handles the save action. */
  const handleSave = useCallback(() => {
    if (!node) return;
    onSave(node.id, formData);
  }, [node, formData, onSave]);

  // Don't render when no node is selected.
  if (!node) return null;

  const meta = NODE_META[node.type];
  const IconComp = meta?.icon;

  /** Renders the correct sub-form based on node type. */
  function renderForm() {
    switch (node!.type) {
      case 'TRIGGER':
        return <TriggerForm data={formData} onChange={setFormData} />;
      case 'MESSAGE':
        return <MessageForm data={formData} onChange={setFormData} />;
      case 'BUTTON_CHOICE':
        return <ButtonChoiceForm data={formData} onChange={setFormData} />;
      case 'FORM_MODAL':
        return <FormModalForm data={formData} onChange={setFormData} />;
      case 'ENRICHMENT':
        return <EnrichmentForm data={formData} onChange={setFormData} />;
      case 'CONDITION':
        return <ConditionForm data={formData} onChange={setFormData} />;
      case 'ACTION':
        return <ActionForm data={formData} onChange={setFormData} />;
      case 'DELAY':
        return <DelayForm data={formData} onChange={setFormData} />;
      case 'HUBSPOT':
        return <HubSpotForm data={formData} onChange={setFormData} />;
      case 'PARSER':
        return <ParserForm data={formData} onChange={setFormData} />;
      case 'API_CALL':
        return <ApiCallForm data={formData} onChange={setFormData} />;
      default:
        return (
          <p className="text-sm text-muted-foreground">
            No configuration available for this node type.
          </p>
        );
    }
  }

  return (
    <div className="w-80 border-l border-border bg-background flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          {IconComp && (
            <div className={cn('rounded-md p-1.5', meta.iconBg)}>
              <IconComp className={cn('h-4 w-4', meta.iconColor)} />
            </div>
          )}
          <span className="text-sm font-semibold">
            {meta?.label ?? node.type}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Scrollable form body */}
      <ScrollArea className="flex-1">
        <div className="p-4">{renderForm()}</div>
      </ScrollArea>

      {/* Footer with save and delete buttons */}
      <div className="border-t border-border px-4 py-3 flex flex-col gap-2">
        <Button className="w-full" onClick={handleSave}>
          Save Configuration
        </Button>

        {onDelete && node.type !== 'TRIGGER' && (
          <>
            {confirmDelete ? (
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    onDelete(node.id);
                    setConfirmDelete(false);
                  }}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Confirm Delete
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Delete Node
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
