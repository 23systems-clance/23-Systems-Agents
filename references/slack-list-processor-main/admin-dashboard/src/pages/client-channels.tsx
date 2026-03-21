/**
 * Client Channels page (T062, T070).
 *
 * Lists registered enrichment channels and analysis channel with document status.
 * Admin users can deactivate channels.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Hash, X, FileText, Check, Minus } from 'lucide-react';
import { listClientChannels, deactivateEnrichmentChannel } from '@/services/client-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

export default function ClientChannelsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['client-channels'],
    queryFn: listClientChannels,
  });

  const deactivateMutation = useMutation({
    mutationFn: deactivateEnrichmentChannel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-channels'] });
    },
  });

  if (isLoading || !data) return <PageSkeleton />;

  const { channels, analysisChannel } = data;
  const activeChannels = channels.filter((c) => c.status === 'ACTIVE');
  const inactiveChannels = channels.filter((c) => c.status === 'INACTIVE');

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Channels</h2>
        <span className="text-sm text-muted-foreground">
          {activeChannels.length} active enrichment, {inactiveChannels.length} inactive
        </span>
      </div>

      {/* Analysis / ICP Channel (T070) */}
      {analysisChannel && (
        <Card className="border-purple-500/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5 text-purple-600" />
              Analysis / ICP Channel
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4" />
              <span className="font-medium">{analysisChannel.slackChannelName}</span>
              {analysisChannel.lastDocumentUploadAt && (
                <span className="text-xs text-muted-foreground ml-auto">
                  Last upload: {new Date(analysisChannel.lastDocumentUploadAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {([
                { key: 'icp' as const, label: 'ICP' },
                { key: 'useCases' as const, label: 'Use Cases' },
                { key: 'caseStudies' as const, label: 'Case Studies' },
                { key: 'testimonials' as const, label: 'Testimonials' },
              ]).map((doc) => (
                <div key={doc.key} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                  {analysisChannel.documents[doc.key] ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-sm">{doc.label}</span>
                  <Badge variant="outline" className={analysisChannel.documents[doc.key] ? 'bg-green-500/10 text-green-600 ml-auto' : 'ml-auto'}>
                    {analysisChannel.documents[doc.key] ? 'Uploaded' : 'Missing'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Enrichment Channels */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Enrichment Channels</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Assigned User</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeChannels.map((channel) => (
                <TableRow key={channel.id}>
                  <TableCell>
                    <span className="font-medium">
                      <Hash className="inline h-3.5 w-3.5 mr-1" />
                      {channel.slackChannelName || channel.slackChannelId}
                    </span>
                  </TableCell>
                  <TableCell>{channel.assignedUserName || channel.assignedUserId}</TableCell>
                  <TableCell className="text-sm">
                    {new Date(channel.registeredAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-green-500/10 text-green-600">
                      ACTIVE
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deactivateMutation.mutate(channel.slackChannelId)}
                      disabled={deactivateMutation.isPending}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {activeChannels.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No active enrichment channels. Add the bot to a private channel to register one.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {inactiveChannels.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg text-muted-foreground">Inactive Channels</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Assigned User</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inactiveChannels.map((channel) => (
                  <TableRow key={channel.id} className="opacity-60">
                    <TableCell>
                      <Hash className="inline h-3.5 w-3.5 mr-1" />
                      {channel.slackChannelName || channel.slackChannelId}
                    </TableCell>
                    <TableCell>{channel.assignedUserName || channel.assignedUserId}</TableCell>
                    <TableCell className="text-sm">
                      {new Date(channel.registeredAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-gray-500/10 text-gray-600">
                        INACTIVE
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
