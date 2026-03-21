/**
 * Prompt version diff view component (Feature 19 — T026).
 *
 * Displays a unified diff between two prompt versions with
 * additions highlighted green and deletions highlighted red.
 */

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import {
  fetchPromptBySlug,
  fetchDiff,
  type PromptVersionSummary,
} from '@/services/prompts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800',
  PUBLISHED: 'bg-green-100 text-green-800',
  ARCHIVED: 'bg-gray-100 text-gray-800',
};

export default function PromptDiffPage() {
  const { slug } = useParams<{ slug: string }>();
  const [fromId, setFromId] = useState<string>('');
  const [toId, setToId] = useState<string>('');

  const { data: promptData, isLoading: promptLoading } = useQuery({
    queryKey: queryKeys.prompts.detail(slug!),
    queryFn: () => fetchPromptBySlug(slug!),
    enabled: !!slug,
  });

  const versions = promptData?.prompt?.versions ?? [];

  const { data: diffData, isLoading: diffLoading } = useQuery({
    queryKey: queryKeys.prompts.diff(slug!, fromId, toId),
    queryFn: () => fetchDiff(slug!, fromId, toId),
    enabled: !!slug && !!fromId && !!toId && fromId !== toId,
  });

  if (promptLoading) return <div className="p-8">Loading...</div>;
  if (!promptData?.prompt) return <div className="p-8">Prompt not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/prompts" className="text-sm text-muted-foreground hover:underline">
          Prompt Library
        </Link>
        <span className="text-muted-foreground">/</span>
        <Link
          to={`/prompts/${slug}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          {promptData.prompt.displayName}
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">Compare Versions</h1>
      </div>

      {/* Version selectors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Select Versions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <div className="space-y-1.5">
              <Label>From (older)</Label>
              <Select value={fromId} onValueChange={setFromId}>
                <SelectTrigger className="w-[240px]">
                  <SelectValue placeholder="Select base version" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v: PromptVersionSummary) => (
                    <SelectItem key={v.id} value={v.id} disabled={v.id === toId}>
                      v{v.version} — {v.status}
                      {v.changeNote ? ` (${v.changeNote})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>To (newer)</Label>
              <Select value={toId} onValueChange={setToId}>
                <SelectTrigger className="w-[240px]">
                  <SelectValue placeholder="Select compare version" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v: PromptVersionSummary) => (
                    <SelectItem key={v.id} value={v.id} disabled={v.id === fromId}>
                      v{v.version} — {v.status}
                      {v.changeNote ? ` (${v.changeNote})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {fromId && toId && fromId === toId && (
              <p className="text-sm text-destructive">
                Select two different versions to compare.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Diff output */}
      {diffLoading && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Loading diff...
          </CardContent>
        </Card>
      )}

      {diffData && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Diff</CardTitle>
            <div className="flex gap-2">
              <Badge className={STATUS_COLORS[diffData.from.status]}>
                v{diffData.from.version} ({diffData.from.status})
              </Badge>
              <span className="text-muted-foreground">→</span>
              <Badge className={STATUS_COLORS[diffData.to.status]}>
                v{diffData.to.version} ({diffData.to.status})
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <DiffDisplay diff={diffData.diff} />
          </CardContent>
        </Card>
      )}

      {!diffData && !diffLoading && fromId && toId && fromId !== toId && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No diff available.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Renders a unified diff with colored line highlights. */
function DiffDisplay({ diff }: { diff: string }) {
  const lines = diff.split('\n');

  return (
    <pre className="overflow-auto rounded bg-muted p-4 text-sm font-mono max-h-[600px]">
      {lines.map((line, i) => {
        let className = '';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          className = 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-300';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          className = 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-300';
        } else if (line.startsWith('@@')) {
          className = 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
        }

        return (
          <div key={i} className={className}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}
