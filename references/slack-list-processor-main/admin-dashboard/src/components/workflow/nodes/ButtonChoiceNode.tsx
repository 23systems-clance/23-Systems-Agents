import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { MousePointerClick } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Represents a single button option in a button-choice node. */
type ButtonOption = {
  id: string;
  label: string;
  style?: 'primary' | 'danger' | '';
  color?: string;
};

/** Data shape for a button-choice node. */
type ButtonChoiceNodeData = {
  type: 'BUTTON_CHOICE';
  buttons?: ButtonOption[];
  label?: string;
  description?: string;
};

type ButtonChoiceNodeType = Node<ButtonChoiceNodeData, 'BUTTON_CHOICE'>;

const ACCENT = '#7c3aed';

/**
 * ButtonChoiceNode presents a set of button choices to the user.
 * Clean Pipeline style: centered icon, violet accent, rounded-2xl card.
 * Each button gets its own output handle so edges can branch per choice.
 */
function ButtonChoiceNode({ data, selected }: NodeProps<ButtonChoiceNodeType>) {
  const buttons = data.buttons ?? [];
  const label = data.label ?? 'Button Choice';
  const description = (data.description as string) ?? '';

  return (
    <div
      className={cn(
        'bg-white rounded-2xl min-w-[220px] max-w-[280px] border-2 transition-all',
        selected ? 'border-teal-500 shadow-xl shadow-teal-500/10' : 'border-gray-100 shadow-md'
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !rounded-full !border-2 !border-white"
        style={{ background: ACCENT }}
      />

      <div className="p-4">
        {/* Centered icon */}
        <div className="flex items-center justify-center mb-3">
          <div className="rounded-2xl p-3 bg-violet-50">
            <MousePointerClick className="h-6 w-6 text-violet-600" />
          </div>
        </div>

        {/* Label */}
        <p className="text-sm font-bold text-gray-900 text-center">{label}</p>

        {/* Type badge */}
        <div className="flex justify-center mt-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded-full bg-violet-50 text-violet-700">
            Button Choice
          </span>
        </div>

        {/* Description */}
        {description && (
          <p className="text-xs text-gray-400 mt-2 text-center leading-relaxed line-clamp-2">{description}</p>
        )}

        {/* Button list */}
        {buttons.length > 0 ? (
          <div className="flex flex-col gap-1.5 mt-3">
            {buttons.map((btn) => {
              const hasCustomColor = !!btn.color;
              return (
                <div
                  key={btn.id}
                  className={cn(
                    'text-xs font-medium px-3 py-1.5 rounded-lg text-center border',
                    hasCustomColor
                      ? ''
                      : btn.style === 'primary'
                        ? 'bg-teal-50 text-teal-700 border-teal-200'
                        : btn.style === 'danger'
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : 'bg-gray-50 text-gray-600 border-gray-200'
                  )}
                  style={hasCustomColor ? { backgroundColor: `${btn.color}15`, borderColor: btn.color, color: btn.color } : undefined}
                >
                  {btn.label}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-gray-400 italic text-center mt-2">No buttons</div>
        )}
      </div>

      {/* One output handle per button, spread across the bottom */}
      {buttons.map((btn, idx) => {
        const offset = buttons.length > 1
          ? (idx / (buttons.length - 1)) * 80 + 10
          : 50;
        return (
          <Handle
            key={btn.id}
            type="source"
            position={Position.Bottom}
            id={btn.id}
            className="!w-3 !h-3 !rounded-full !border-2 !border-white"
            style={{ left: `${offset}%`, background: ACCENT }}
          />
        );
      })}

      {/* Fallback handle when no buttons are configured */}
      {buttons.length === 0 && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !rounded-full !border-2 !border-white"
          style={{ background: ACCENT }}
        />
      )}
    </div>
  );
}

export default ButtonChoiceNode;
