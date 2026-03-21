/**
 * Prompt test panel component (Feature 19 — T030).
 *
 * Allows admins to test draft prompts against sample inputs,
 * displaying classification results, token usage, and estimated cost.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { runPromptTest, fetchTestRuns, type PromptTestRun } from '@/services/prompts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';

interface PromptTestPanelProps {
  slug: string;
  versionId: string;
  versionNumber: number;
}

export function PromptTestPanel({ slug, versionId, versionNumber }: PromptTestPanelProps) {
  const queryClient = useQueryClient();
  const [inputText, setInputText] = useState('');

  // Fetch previous test runs for this version
  const { data: testRunsData } = useQuery({
    queryKey: queryKeys.prompts.testRuns(slug, versionId),
    queryFn: () => fetchTestRuns(slug, versionId),
  });

  const testRuns = testRunsData?.testRuns ?? [];

  // Run test mutation
  const testMutation = useMutation({
    mutationFn: () => runPromptTest(slug, versionId, { inputText }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.prompts.testRuns(slug, versionId),
      });
    },
  });

  const latestResult = testMutation.data?.testRun;

  return (
    <div className="space-y-4">
      {/* Test input */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Test Draft v{versionNumber}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Sample Input</Label>
            <Textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Enter sample input text to test against this prompt..."
              className="min-h-[120px] font-mono text-sm"
            />
          </div>
          <Button
            onClick={() => testMutation.mutate()}
            disabled={!inputText.trim() || testMutation.isPending}
          >
            {testMutation.isPending ? 'Running...' : 'Run Test'}
          </Button>

          {testMutation.isError && (
            <p className="text-sm text-destructive">
              Test failed: {(testMutation.error as Error)?.message ?? 'Unknown error'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Latest test result */}
      {latestResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Test Result</CardTitle>
          </CardHeader>
          <CardContent>
            <TestRunDetail run={latestResult} />
          </CardContent>
        </Card>
      )}

      {/* Test run history */}
      {testRuns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Test History ({testRuns.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {testRuns.map((run) => (
                <div key={run.id} className="rounded border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {new Date(run.createdAt).toLocaleString()}
                    </span>
                    <div className="flex gap-2">
                      <Badge variant="outline">
                        {run.tokensUsed} tokens
                      </Badge>
                      <Badge variant="outline">
                        ${Number(run.estimatedCostUsd).toFixed(4)}
                      </Badge>
                      <Badge variant="outline">
                        {run.durationMs}ms
                      </Badge>
                    </div>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Input: </span>
                    <span className="font-mono">
                      {run.inputText.length > 100
                        ? run.inputText.slice(0, 100) + '...'
                        : run.inputText}
                    </span>
                  </div>
                  <pre className="rounded bg-muted p-2 text-xs font-mono overflow-auto max-h-[150px]">
                    {JSON.stringify(run.outputResult, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Detailed display for a single test run result. */
function TestRunDetail({ run }: { run: PromptTestRun }) {
  const output = run.outputResult as Record<string, unknown>;

  return (
    <div className="space-y-3">
      {/* Output */}
      <div>
        <Label className="text-muted-foreground">Output</Label>
        <pre className="mt-1 rounded bg-muted p-3 text-sm font-mono overflow-auto max-h-[300px]">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <Label className="text-muted-foreground">Input Tokens</Label>
          <p className="text-lg font-medium">{run.inputTokens}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">Output Tokens</Label>
          <p className="text-lg font-medium">{run.outputTokens}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">Total Tokens</Label>
          <p className="text-lg font-medium">{run.tokensUsed}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">Estimated Cost</Label>
          <p className="text-lg font-medium">${Number(run.estimatedCostUsd).toFixed(4)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-muted-foreground">Duration</Label>
          <p className="text-lg font-medium">{run.durationMs}ms</p>
        </div>
        <div>
          <Label className="text-muted-foreground">Tested By</Label>
          <p className="text-lg font-medium">{run.testedBy}</p>
        </div>
      </div>
    </div>
  );
}
