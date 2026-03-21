import { Bot, X, Hash } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Props for the SlackPreview component. */
interface SlackPreviewProps {
  nodeType: string;
  nodeData: Record<string, unknown>;
}

/** Shape of a button entry in BUTTON_CHOICE node data. */
interface ButtonEntry {
  id: string;
  label: string;
}

/** Shape of a field entry in FORM_MODAL node data. */
interface FormField {
  label: string;
  type: string;
  required?: boolean;
}

/**
 * Converts basic Slack mrkdwn formatting to React elements.
 * Handles *bold*, _italic_, and `code` inline styles.
 */
function renderMrkdwn(text: string): React.ReactNode[] {
  // Split on mrkdwn tokens: *bold*, _italic_, `code`
  const parts = text.split(/(\*[^*]+\*|_[^_]+_|`[^`]+`)/g);

  return parts.map((part, i) => {
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <strong key={i} className="font-bold">
          {part.slice(1, -1)}
        </strong>
      );
    }
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
      return (
        <em key={i} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={i}
          className="rounded bg-red-50 px-1 py-0.5 font-mono text-xs text-red-700 border border-red-100"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/** Renders the bot identity header (avatar, name, timestamp). */
function BotHeader() {
  return (
    <div className="flex items-center gap-2 mb-1">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-purple-600">
        <Bot className="h-5 w-5 text-white" />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[15px] font-bold text-gray-900">
          Workflow Bot
        </span>
        <span className="text-xs text-gray-500">12:00 PM</span>
      </div>
    </div>
  );
}

/** Renders a Slack-style message preview. */
function MessagePreview({ text }: { text: string }) {
  return (
    <div className="pl-11">
      <div className="text-[15px] leading-relaxed text-gray-900">
        {renderMrkdwn(text)}
      </div>
    </div>
  );
}

/** Renders a Slack-style button choice preview with prompt and action buttons. */
function ButtonChoicePreview({
  text,
  buttons,
}: {
  text: string;
  buttons: ButtonEntry[];
}) {
  return (
    <div className="pl-11">
      <div className="text-[15px] leading-relaxed text-gray-900 mb-3">
        {renderMrkdwn(text)}
      </div>
      <div className="flex flex-wrap gap-2">
        {buttons.map((btn) => (
          <button
            key={btn.id}
            type="button"
            className={cn(
              'inline-flex items-center rounded px-3 py-1.5',
              'border border-gray-300 bg-white text-sm font-medium text-gray-800',
              'hover:bg-gray-50 cursor-default select-none shadow-sm'
            )}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Renders a simplified Slack modal preview with title bar and field list. */
function FormModalPreview({
  title,
  fields,
}: {
  title: string;
  fields: FormField[];
}) {
  return (
    <div className="rounded-lg border border-gray-300 bg-white shadow-lg overflow-hidden">
      {/* Modal title bar */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <span className="text-lg font-bold text-gray-900">{title}</span>
        <X className="h-5 w-5 text-gray-400" />
      </div>

      {/* Field list */}
      <div className="px-4 py-3 space-y-3">
        {fields.length > 0 ? (
          fields.map((field, idx) => (
            <div key={idx}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-sm font-semibold text-gray-900">
                  {field.label}
                </span>
                {field.required && (
                  <span className="text-xs text-red-500 font-medium">*</span>
                )}
              </div>
              <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-400">
                {field.type === 'select'
                  ? 'Select an option...'
                  : field.type === 'textarea'
                    ? 'Enter text...'
                    : 'Enter value...'}
              </div>
            </div>
          ))
        ) : (
          <div className="text-sm text-gray-400 italic py-2">
            No fields configured
          </div>
        )}
      </div>

      {/* Modal footer */}
      <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3">
        <button
          type="button"
          className="rounded px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded bg-green-700 px-3 py-1.5 text-sm font-medium text-white"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

/**
 * SlackPreview renders a Slack-like Block Kit preview for workflow nodes.
 * Supports MESSAGE, BUTTON_CHOICE, and FORM_MODAL node types with
 * Slack-themed styling including bot identity, mrkdwn formatting, and
 * interactive element previews.
 */
export function SlackPreview({ nodeType, nodeData }: SlackPreviewProps) {
  if (nodeType === 'FORM_MODAL') {
    const title = (nodeData.title as string) ?? 'Untitled Modal';
    const fields = (nodeData.fields as FormField[]) ?? [];

    return (
      <div className="rounded-lg border border-gray-200 bg-gray-100 p-4 shadow-sm">
        <div className="flex items-center gap-1.5 mb-3 text-xs text-gray-500">
          <Hash className="h-3.5 w-3.5" />
          <span>Modal Preview</span>
        </div>
        <FormModalPreview title={title} fields={fields} />
      </div>
    );
  }

  if (nodeType === 'MESSAGE' || nodeType === 'BUTTON_CHOICE') {
    const text = (nodeData.text as string) ?? '';

    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        {/* Channel indicator */}
        <div className="flex items-center gap-1.5 mb-3 text-xs text-gray-500">
          <Hash className="h-3.5 w-3.5" />
          <span>general</span>
        </div>

        <BotHeader />

        {nodeType === 'MESSAGE' ? (
          <MessagePreview text={text || 'Your message here...'} />
        ) : (
          <ButtonChoicePreview
            text={text || 'Choose an option:'}
            buttons={(nodeData.buttons as ButtonEntry[]) ?? []}
          />
        )}
      </div>
    );
  }

  // Fallback for unsupported node types
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center shadow-sm">
      <p className="text-sm text-gray-500">No preview available</p>
    </div>
  );
}

export default SlackPreview;
