import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Mail, Phone, MessageSquare, Users, CheckCircle,
  Play, Pause, RotateCcw, ArrowLeft, Pencil, Trash2, Archive,
  ChevronLeft, ChevronRight, Brain, Download, Sparkles,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import {
  fetchCampaignDetail,
  fetchCampaignContacts,
  activateCampaign,
  pauseCampaign,
  resumeCampaign,
  updateCampaign,
  deleteCampaign,
  pushPersonalityToCrm,
  getPersonalityCsvUrl,
  fetchSmartReplyMetrics,
} from '@/services/campaigns';
import CampaignEditDialog, { type CampaignEditData } from '@/components/campaigns/CampaignEditDialog';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
  ARCHIVED: 'bg-gray-200 text-gray-600',
};

const STEP_TYPE_ICONS: Record<string, typeof Mail> = {
  EMAIL: Mail,
  PHONE: Phone,
  LINKEDIN: MessageSquare,
};

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [contactPage, setContactPage] = useState(1);
  const contactLimit = 20;
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['admin', 'campaign', id],
    queryFn: () => fetchCampaignDetail(id!),
    enabled: !!id,
  });

  const { data: contacts } = useQuery({
    queryKey: ['admin', 'campaign', id, 'contacts', contactPage],
    queryFn: () => fetchCampaignContacts(id!, { page: contactPage, limit: contactLimit }),
    enabled: !!id,
  });

  const { data: smartReplyMetrics } = useQuery({
    queryKey: ['admin', 'campaign', id, 'smart-reply-metrics'],
    queryFn: () => fetchSmartReplyMetrics(id!),
    enabled: !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'campaign', id] });
  };

  const activateMut = useMutation({
    mutationFn: () => activateCampaign(id!),
    onSuccess: invalidate,
  });

  const pauseMut = useMutation({
    mutationFn: () => pauseCampaign(id!),
    onSuccess: invalidate,
  });

  const resumeMut = useMutation({
    mutationFn: () => resumeCampaign(id!),
    onSuccess: invalidate,
  });

  const updateMut = useMutation({
    mutationFn: (data: CampaignEditData) => updateCampaign(id!, data),
    onSuccess: () => {
      invalidate();
      setEditOpen(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteCampaign(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      navigate('/campaigns');
    },
  });

  const personalityPushMut = useMutation({
    mutationFn: () => pushPersonalityToCrm(id!),
  });

  if (isLoading || !campaign) return <PageSkeleton />;

  const actionPending = activateMut.isPending || pauseMut.isPending || resumeMut.isPending;
  const actionError = activateMut.error || pauseMut.error || resumeMut.error;

  // Parse validation errors from activate response
  const validationErrors: string[] = [];
  if (activateMut.error) {
    try {
      const errData = (activateMut.error as { response?: { data?: { validationErrors?: string[] } } })
        .response?.data?.validationErrors;
      if (errData) validationErrors.push(...errData);
    } catch {
      // ignore parse errors
    }
  }

  const canEdit = campaign.status === 'DRAFT' || campaign.status === 'PAUSED';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/campaigns">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{campaign.name}</h1>
              {campaign.client && (
                <Badge variant={campaign.client.isActive ? 'secondary' : 'destructive'}>
                  {campaign.client.name}{!campaign.client.isActive && ' (inactive)'}
                </Badge>
              )}
            </div>
            {campaign.description && (
              <p className="text-muted-foreground">{campaign.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{campaign.campaignType}</Badge>
          <Badge className={STATUS_COLORS[campaign.status] ?? ''}>{campaign.status}</Badge>

          {/* Edit button */}
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3 w-3 mr-1" /> Edit
            </Button>
          )}

          {/* Lifecycle actions */}
          {campaign.status === 'DRAFT' && (
            <Button size="sm" onClick={() => activateMut.mutate()} disabled={actionPending}>
              <Play className="h-3 w-3 mr-1" /> Activate
            </Button>
          )}
          {campaign.status === 'ACTIVE' && (
            <Button size="sm" variant="outline" onClick={() => pauseMut.mutate()} disabled={actionPending}>
              <Pause className="h-3 w-3 mr-1" /> Pause
            </Button>
          )}
          {campaign.status === 'PAUSED' && (
            <Button size="sm" onClick={() => resumeMut.mutate()} disabled={actionPending}>
              <RotateCcw className="h-3 w-3 mr-1" /> Resume
            </Button>
          )}

          {/* Delete/Archive */}
          {campaign.status !== 'ARCHIVED' && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              disabled={actionPending || deleteMut.isPending}
            >
              {campaign.status === 'DRAFT' ? (
                <><Trash2 className="h-3 w-3 mr-1" /> Delete</>
              ) : (
                <><Archive className="h-3 w-3 mr-1" /> Archive</>
              )}
            </Button>
          )}

          {/* Personality data actions */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => personalityPushMut.mutate()}
            disabled={personalityPushMut.isPending}
          >
            <Brain className="h-3 w-3 mr-1" />
            {personalityPushMut.isPending ? 'Pushing...' : 'Push to HubSpot'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            asChild
          >
            <a href={getPersonalityCsvUrl(id!)} download>
              <Download className="h-3 w-3 mr-1" /> Export CSV
            </a>
          </Button>
        </div>
      </div>

      {/* Personality push result */}
      {personalityPushMut.isSuccess && personalityPushMut.data && (
        <div className="rounded-md border border-green-500/50 bg-green-50 p-3 text-sm">
          Personality sync: {personalityPushMut.data.synced} synced, {personalityPushMut.data.skipped} skipped, {personalityPushMut.data.failed} failed (of {personalityPushMut.data.total} total)
        </div>
      )}
      {personalityPushMut.isError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
          HubSpot push failed: {(personalityPushMut.error as Error)?.message ?? 'Unknown error'}
        </div>
      )}

      {/* Activation validation errors */}
      {validationErrors.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive mb-2">Campaign cannot be activated:</p>
          <ul className="list-disc list-inside space-y-1">
            {validationErrors.map((err, i) => (
              <li key={i} className="text-sm text-destructive">{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Generic action error (non-activation) */}
      {actionError && validationErrors.length === 0 && (
        <p className="text-sm text-destructive">
          {(actionError as Error).message || 'Action failed'}
        </p>
      )}

      {/* Contact Quality Stats */}
      {campaign.contactQuality && campaign.contactQuality.totalContacts > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-xl font-bold">{campaign.contactQuality.emailVerified}</p>
                  <p className="text-xs text-muted-foreground">Email (verified)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-orange-500" />
                <div>
                  <p className="text-xl font-bold">{campaign.contactQuality.phoneCallable}</p>
                  <p className="text-xs text-muted-foreground">Mobile Phone (callable)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-indigo-500" />
                <div>
                  <p className="text-xl font-bold">{campaign.contactQuality.linkedinAvailable}</p>
                  <p className="text-xs text-muted-foreground">LinkedIn (available)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-xl font-bold">{campaign.contactQuality.multiChannel}</p>
                  <p className="text-xs text-muted-foreground">Multi-Channel Total</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Smart Reply Metrics */}
      {smartReplyMetrics && smartReplyMetrics.total > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Smart Reply Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-4 text-center">
              <div>
                <p className="text-lg font-bold">{smartReplyMetrics.total}</p>
                <p className="text-[10px] text-muted-foreground">Total Drafts</p>
              </div>
              <div>
                <p className="text-lg font-bold text-green-600">{smartReplyMetrics.sent}</p>
                <p className="text-[10px] text-muted-foreground">Accepted</p>
              </div>
              <div>
                <p className="text-lg font-bold text-red-500">{smartReplyMetrics.rejected}</p>
                <p className="text-[10px] text-muted-foreground">Dismissed</p>
              </div>
              <div>
                <p className="text-lg font-bold text-blue-500">{smartReplyMetrics.ready}</p>
                <p className="text-[10px] text-muted-foreground">Pending Review</p>
              </div>
              <div>
                <p className="text-lg font-bold text-orange-500">{smartReplyMetrics.failed}</p>
                <p className="text-[10px] text-muted-foreground">Failed</p>
              </div>
              <div>
                <p className="text-lg font-bold">{smartReplyMetrics.acceptanceRate}%</p>
                <p className="text-[10px] text-muted-foreground">Acceptance Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-xl font-bold">{campaign.stats.totalContacts}</p>
                <p className="text-xs text-muted-foreground">Total contacts</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xl font-bold">{campaign.stats.activeContacts}</p>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-xl font-bold">{campaign.stats.completedContacts}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xl font-bold">{campaign.stats.respondedContacts}</p>
            <p className="text-xs text-muted-foreground">Responded</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xl font-bold">
              {(campaign.stats.responseRate * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">Response rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Step Funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sequence Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {campaign.funnel.map((step) => {
              const Icon = STEP_TYPE_ICONS[step.stepType] ?? Mail;
              const total = step.total || 1;
              const completedPct = (step.completed / total) * 100;

              return (
                <div key={step.stepIndex} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span>
                        Step {step.stepIndex + 1}: {step.stepType}
                      </span>
                    </div>
                    <span className="text-muted-foreground">
                      {step.completed}/{step.total} completed
                      {step.skipped > 0 && `, ${step.skipped} skipped`}
                      {step.failed > 0 && `, ${step.failed} failed`}
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all"
                      style={{ width: `${completedPct}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {campaign.funnel.length === 0 && (
              <p className="text-muted-foreground text-sm">No sequence steps defined.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* BDRs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Assigned BDRs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {campaign.bdrs.map((bdr) => (
              <Badge key={bdr.id} variant={bdr.isActive ? 'outline' : 'destructive'}>
                {bdr.displayName}{!bdr.isActive && ' (inactive)'}
              </Badge>
            ))}
            {campaign.bdrs.length === 0 && (
              <p className="text-muted-foreground text-sm">No BDRs assigned.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Contact Table with Pagination */}
      {contacts && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Contacts ({contacts.total})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {contacts.data.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium">Name</th>
                        <th className="pb-2 font-medium">Company</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium">Step</th>
                        <th className="pb-2 font-medium">Capabilities</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.data.map((contact) => (
                        <tr key={contact.id} className="border-b last:border-0">
                          <td className="py-2">
                            {contact.firstName} {contact.lastName}
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {contact.companyName}
                          </td>
                          <td className="py-2">
                            <Badge variant="outline" className="text-xs">
                              {contact.status}
                            </Badge>
                          </td>
                          <td className="py-2">{contact.currentStepIndex + 1}</td>
                          <td className="py-2">
                            <div className="flex gap-1">
                              {contact.canEmail && <Mail className="h-3 w-3 text-blue-500" />}
                              {contact.canCall && <Phone className="h-3 w-3 text-orange-500" />}
                              {contact.canLinkedin && <MessageSquare className="h-3 w-3 text-indigo-500" />}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {contacts.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      Page {contactPage} of {contacts.totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={contactPage <= 1}
                        onClick={() => setContactPage((p) => p - 1)}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={contactPage >= contacts.totalPages}
                        onClick={() => setContactPage((p) => p + 1)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No contacts imported yet.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Edit Dialog */}
      {campaign && (
        <CampaignEditDialog
          campaign={campaign}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSubmit={(data) => updateMut.mutate(data)}
          isPending={updateMut.isPending}
          error={updateMut.error as Error | null}
        />
      )}

      {/* Delete/Archive Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {campaign.status === 'DRAFT' ? 'Delete Campaign' : 'Archive Campaign'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {campaign.status === 'DRAFT'
                ? 'This will permanently delete the campaign. This action cannot be undone.'
                : 'This will archive the campaign. Archived campaigns can no longer be modified or resumed.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMut.error && (
            <p className="text-sm text-destructive">
              {(deleteMut.error as Error).message || 'Action failed'}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMut.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMut.isPending ? 'Processing...' : campaign.status === 'DRAFT' ? 'Delete' : 'Archive'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
