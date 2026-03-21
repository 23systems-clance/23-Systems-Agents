/**
 * Agent Sandbox test component (T018 - Feature 39).
 *
 * JSON input editor, "Run Test" button, output display with
 * token count, cost, and latency metrics.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Play, Loader2 } from 'lucide-react';
import { testAgent, type AgentTestResult } from '@/services/platform/agents';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

interface AgentSandboxProps {
  agentId: string;
  versionId?: string;
}

export function AgentSandbox({ agentId, versionId }: AgentSandboxProps) {
  const [input, setInput] = useState('{\n  "message": "Hello, test this agent"\n}');
  const [result, setResult] = useState<AgentTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(input);
      } catch {
        throw new Error('Invalid JSON input');
      }
      return testAgent(agentId, parsed, versionId);
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
        <CardTitle className="text-base">Sandbox Test</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Input (JSON)</label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="font-mono text-sm min-h-[120px]"
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
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-3">
              <MetricCard label="Input Tokens" value={result.tokensInput.toLocaleString()} />
              <MetricCard label="Output Tokens" value={result.tokensOutput.toLocaleString()} />
              <MetricCard label="Cost" value={`$${result.costUsd.toFixed(6)}`} />
              <MetricCard label="Latency" value={`${result.durationMs}ms`} />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Output</label>
              <pre className="rounded-md bg-muted p-3 text-sm font-mono overflow-auto max-h-[300px] whitespace-pre-wrap">
                {typeof result.output === 'string'
                  ? result.output
                  : JSON.stringify(result.output, null, 2)}
              </pre>
            </div>

            {result.toolCallsMade.length > 0 && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  Tool Calls ({result.toolCallsMade.length})
                </label>
                <div className="space-y-2">
                  {result.toolCallsMade.map((tc, i) => (
                    <div key={i} className="rounded-md bg-muted p-2 text-xs font-mono">
                      <span className="font-semibold">{tc.toolName}</span>
                      <pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(tc.input, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
