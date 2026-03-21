import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useValidateWorkflow } from '@/services/workflows';
import { cn } from '@/lib/utils';

/** Props for the WorkflowValidation component. */
export interface WorkflowValidationProps {
  /** The workflow ID to validate. */
  workflowId: string;
  /** Optional callback fired when a user clicks an error/warning linked to a node. */
  onNodeClick?: (nodeId: string) => void;
}

/**
 * Validation results panel for the workflow builder.
 *
 * Provides a "Validate" button that triggers server-side validation via
 * POST /:workflowId/validate and displays errors (red) and warnings (yellow)
 * with optional clickable node references.
 */
export function WorkflowValidation({
  workflowId,
  onNodeClick,
}: WorkflowValidationProps) {
  const { mutate, data, isPending, isError, error } =
    useValidateWorkflow(workflowId);

  /** Trigger the validation mutation. */
  function handleValidate() {
    if (isPending) return;
    mutate();
  }

  const errors = data?.errors ?? [];
  const warnings = data?.warnings ?? [];
  const isValid = data?.valid ?? false;
  const hasResults = !!data;

  return (
    <div className="flex flex-col gap-3">
      {/* ---- Trigger button ---- */}
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={handleValidate}
        className="w-full"
      >
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <ShieldCheck className="mr-2 h-4 w-4" />
        )}
        {isPending ? 'Validating...' : 'Validate'}
      </Button>

      {/* ---- Network / mutation error ---- */}
      {isError && (
        <p className="text-sm text-red-600">
          Validation request failed:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      )}

      {/* ---- Results panel ---- */}
      {hasResults && (
        <div className="rounded-md border">
          {/* Status badge */}
          <div className="flex items-center gap-2 px-3 py-2">
            {isValid ? (
              <Badge
                variant="outline"
                className="border-green-500 bg-green-50 text-green-700"
              >
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                Valid
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-red-500 bg-red-50 text-red-700"
              >
                <XCircle className="mr-1 h-3.5 w-3.5" />
                Invalid
              </Badge>
            )}

            {isValid && (
              <span className="text-sm text-green-700">
                Workflow passed all validation checks.
              </span>
            )}
          </div>

          {/* ---- Errors section ---- */}
          {errors.length > 0 && (
            <>
              <Separator />
              <div className="px-3 py-2">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-600">
                  Errors ({errors.length})
                </p>
                <ScrollArea className="max-h-48">
                  <ul className="space-y-1">
                    {errors.map((err, idx) => (
                      <li
                        key={`err-${idx}`}
                        className="flex items-start gap-2 text-sm"
                      >
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                        <span
                          className={cn(
                            'text-red-700',
                            err.node_id &&
                              onNodeClick &&
                              'cursor-pointer underline decoration-red-400 hover:text-red-900',
                          )}
                          role={err.node_id && onNodeClick ? 'button' : undefined}
                          tabIndex={err.node_id && onNodeClick ? 0 : undefined}
                          onClick={
                            err.node_id && onNodeClick
                              ? () => onNodeClick(err.node_id!)
                              : undefined
                          }
                          onKeyDown={
                            err.node_id && onNodeClick
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onNodeClick(err.node_id!);
                                  }
                                }
                              : undefined
                          }
                        >
                          {err.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            </>
          )}

          {/* ---- Warnings section ---- */}
          {warnings.length > 0 && (
            <>
              <Separator />
              <div className="px-3 py-2">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-yellow-600">
                  Warnings ({warnings.length})
                </p>
                <ScrollArea className="max-h-48">
                  <ul className="space-y-1">
                    {warnings.map((warn, idx) => (
                      <li
                        key={`warn-${idx}`}
                        className="flex items-start gap-2 text-sm"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
                        <span
                          className={cn(
                            'text-yellow-700',
                            warn.node_id &&
                              onNodeClick &&
                              'cursor-pointer underline decoration-yellow-400 hover:text-yellow-900',
                          )}
                          role={warn.node_id && onNodeClick ? 'button' : undefined}
                          tabIndex={warn.node_id && onNodeClick ? 0 : undefined}
                          onClick={
                            warn.node_id && onNodeClick
                              ? () => onNodeClick(warn.node_id!)
                              : undefined
                          }
                          onKeyDown={
                            warn.node_id && onNodeClick
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onNodeClick(warn.node_id!);
                                  }
                                }
                              : undefined
                          }
                        >
                          {warn.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
