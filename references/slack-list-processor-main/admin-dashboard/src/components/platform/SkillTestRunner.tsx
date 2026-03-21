/**
 * Skill Test Runner component (T040 - Feature 39).
 *
 * JSON input editor, "Run Test" button, execution trace display showing
 * each step (trigger -> agent invocation -> tool calls -> output delivery)
 * with timing and costs.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Play, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { testSkill, type SkillExecutionResult } from '@/services/platform/skills';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

interface SkillTestRunnerProps {
  skillId: string;
}

export function SkillTestRunner({ skillId }: SkillTestRunnerProps) {
  const [input, setInput] = useState('{\n  "message": "Test this skill"\n}');
  const [result, setResult] = useState<SkillExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(input);
      } catch {
        throw new Error('Invalid JSON input');
      }
      return testSkill(skillId, parsed);
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Test failed');
      setResult(null);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Skill Test Runner</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Input (JSON)</label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="font-mono text-sm min-h-[100px]"
            placeholder='{ "message": "your test input" }'
          />
        </div>

        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="w-full"
        >
          {mutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Run Test
        </Button>

        {error && (
          <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {/* Summary metrics */}
            <div className="grid grid-cols-3 gap-3">
              <MetricCard
                label="Status"
                value={result.status}
                icon={result.status === 'COMPLETED'
                  ? <CheckCircle className="h-4 w-4 text-green-600" />
                  : <XCircle className="h-4 w-4 text-red-600" />
                }
              />
              <MetricCard label="Credits" value={result.creditsCost.toFixed(2)} />
              <MetricCard label="Duration" value={`${result.durationMs}ms`} />
            </div>

            {/* Execution Trace */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Execution Trace</label>
              <div className="space-y-2">
                {/* Agent Invocations */}
                {result.trace.agentInvocations.map((inv, i) => (
                  <div key={i} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">Agent Invocation</span>
                      <span className="text-xs text-muted-foreground">{inv.durationMs}ms</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                      <span>Input: {inv.tokensInput.toLocaleString()} tokens</span>
                      <span>Output: {inv.tokensOutput.toLocaleString()} tokens</span>
                      <span>Cost: ${inv.costUsd.toFixed(6)}</span>
                    </div>
                  </div>
                ))}

                {/* Tool Calls */}
                {result.trace.toolCalls.map((tc, i) => (
                  <div
                    key={i}
                    className={`rounded-md border p-3 text-sm ${tc.error ? 'border-red-500/30 bg-red-500/5' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium font-mono">{tc.toolName}</span>
                      <span className="text-xs text-muted-foreground">{tc.durationMs}ms</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Status: {tc.statusCode || 'N/A'}
                      {tc.error && <span className="text-red-600 ml-2">{tc.error}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Output */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Output</label>
              <pre className="rounded-md bg-muted p-3 text-sm font-mono overflow-auto max-h-[300px] whitespace-pre-wrap">
                {typeof result.output === 'string'
                  ? result.output
                  : JSON.stringify(result.output, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="flex items-center justify-center gap-1">
        {icon}
        <p className="text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}
