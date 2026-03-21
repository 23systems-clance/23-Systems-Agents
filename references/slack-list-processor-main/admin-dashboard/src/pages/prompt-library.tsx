/**
 * Prompt Library list page (Feature 19 — T024).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { queryKeys } from '@/lib/query-keys';
import { fetchPrompts, type PromptSummary } from '@/services/prompts';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CATEGORY_COLORS: Record<string, string> = {
  CLASSIFIER: 'bg-blue-100 text-blue-800',
  PARSER: 'bg-purple-100 text-purple-800',
  GENERATOR: 'bg-green-100 text-green-800',
};

function statusBadge(prompt: PromptSummary) {
  if (!prompt.publishedVersion) {
    return <Badge variant="outline">No published version</Badge>;
  }
  return <Badge className="bg-green-100 text-green-800">Published v{prompt.publishedVersion.version}</Badge>;
}

export default function PromptListPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');

  const params: Record<string, string> = {};
  if (search) params.search = search;
  if (category && category !== 'all') params.category = category;

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.prompts.list(params),
    queryFn: () => fetchPrompts(Object.keys(params).length > 0 ? params : undefined),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Prompt Library</h1>
      </div>

      <div className="flex gap-4">
        <Input
          placeholder="Search prompts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="CLASSIFIER">Classifier</SelectItem>
            <SelectItem value="PARSER">Parser</SelectItem>
            <SelectItem value="GENERATOR">Generator</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Usage</TableHead>
              <TableHead>Last Modified</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : !data?.prompts.length ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No prompts found
                </TableCell>
              </TableRow>
            ) : (
              data.prompts.map((prompt) => (
                <TableRow key={prompt.id}>
                  <TableCell>
                    <Link
                      to={`/prompts/${prompt.slug}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {prompt.displayName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {prompt.slug}
                  </TableCell>
                  <TableCell>
                    <Badge className={CATEGORY_COLORS[prompt.category] ?? ''}>
                      {prompt.category}
                    </Badge>
                  </TableCell>
                  <TableCell>{statusBadge(prompt)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {prompt.usageCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(prompt.updatedAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && (
        <p className="text-sm text-muted-foreground">
          {data.total} prompt{data.total !== 1 ? 's' : ''} total
        </p>
      )}
    </div>
  );
}
