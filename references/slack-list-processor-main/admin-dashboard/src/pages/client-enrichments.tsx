/**
 * Client Enrichment History page (T061).
 *
 * Lists enrichment jobs for the workspace with pagination.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { FileSpreadsheet, Download } from 'lucide-react';
import { getEnrichmentHistory } from '@/services/client-api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'bg-green-500/10 text-green-600',
  PROCESSING: 'bg-blue-500/10 text-blue-600',
  FAILED: 'bg-red-500/10 text-red-600',
  PENDING: 'bg-gray-500/10 text-gray-600',
  CANCELLED: 'bg-yellow-500/10 text-yellow-600',
};

export default function ClientEnrichmentsPage() {
  const [page, setPage] = useState(1);
  const limit = 25;

  const { data, isLoading } = useQuery({
    queryKey: ['client-enrichments', page],
    queryFn: () => getEnrichmentHistory({ page, limit }),
  });

  if (isLoading || !data) return <PageSkeleton />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Enrichment History</h2>
        <span className="text-sm text-muted-foreground">{data.total} total jobs</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="text-sm">
                    {new Date(job.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{job.jobType}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_COLORS[job.status] ?? ''}>
                      {job.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{job.slackUserName || job.slackUserId}</TableCell>
                  <TableCell className="text-sm">{job.slackChannelName || '-'}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{job.rowCount ?? '-'}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{job.creditsUsed ?? '-'}</TableCell>
                  <TableCell>
                    {job.downloadUrl && (
                      <Button variant="ghost" size="sm" asChild>
                        <a href={job.downloadUrl} target="_blank" rel="noopener noreferrer">
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data.jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    No enrichment jobs yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data.total > limit && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="flex items-center text-sm text-muted-foreground">
            Page {page} of {Math.ceil(data.total / limit)}
          </span>
          <Button variant="outline" size="sm" disabled={page * limit >= data.total} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </motion.div>
  );
}
