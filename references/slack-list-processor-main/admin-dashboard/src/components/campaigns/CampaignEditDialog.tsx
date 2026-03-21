import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CampaignDetail } from '@/services/campaigns';
import { fetchExternalCampaigns, type ExternalCampaignItem } from '@/services/campaigns';
import { fetchBdrs } from '@/services/bdrs';
import { fetchManagedClients } from '@/services/managed-clients';

type StepType = 'EMAIL' | 'PHONE' | 'LINKEDIN';

interface CampaignEditDialogProps {
  campaign: CampaignDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CampaignEditData) => void;
  isPending: boolean;
  error: Error | null;
}

export interface CampaignEditData {
  name: string;
  description?: string;
  hubspotListId?: string;
  instantlyCampaignId?: string;
  heyreachCampaignId?: string;
  meetingLink?: string;
  callScript?: string;
  emailSequenceCopy?: string;
  linkedinSequenceCopy?: string;
  clientId?: string;
  sequenceSteps?: Array<{ stepOrder: number; stepType: StepType }>;
  bdrs?: Array<{ slackUserId: string; slackTeamId: string; displayName: string }>;
}

export default function CampaignEditDialog({
  campaign,
  open,
  onOpenChange,
  onSubmit,
  isPending,
  error,
}: CampaignEditDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hubspotListId, setHubspotListId] = useState('');
  const [instantlyCampaignId, setInstantlyCampaignId] = useState('');
  const [heyreachCampaignId, setHeyreachCampaignId] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [callScript, setCallScript] = useState('');
  const [emailSequenceCopy, setEmailSequenceCopy] = useState('');
  const [linkedinSequenceCopy, setLinkedinSequenceCopy] = useState('');
  const [clientId, setClientId] = useState('');
  const [steps, setSteps] = useState<Array<{ stepType: StepType }>>([]);
  const [selectedBdrIds, setSelectedBdrIds] = useState<Set<string>>(new Set());

  // Fetch available BDRs
  const { data: bdrsData } = useQuery({
    queryKey: ['admin', 'bdrs', 'active'],
    queryFn: () => fetchBdrs({ isActive: 'true' }),
    enabled: open,
  });

  // Fetch available clients
  const { data: clientsData } = useQuery({
    queryKey: ['admin', 'clients', 'active'],
    queryFn: () => fetchManagedClients({ isActive: 'true' }),
    enabled: open,
  });

  // Pre-fill form when opening
  useEffect(() => {
    if (open && campaign) {
      setName(campaign.name);
      setDescription(campaign.description ?? '');
      setHubspotListId((campaign as unknown as Record<string, unknown>).hubspotListId as string ?? '');
      setInstantlyCampaignId((campaign as unknown as Record<string, unknown>).instantlyCampaignId as string ?? '');
      setHeyreachCampaignId((campaign as unknown as Record<string, unknown>).heyreachCampaignId as string ?? '');
      setMeetingLink((campaign as unknown as Record<string, unknown>).meetingLink as string ?? '');
      setCallScript((campaign as unknown as Record<string, unknown>).callScript as string ?? '');
      setEmailSequenceCopy((campaign as unknown as Record<string, unknown>).emailSequenceCopy as string ?? '');
      setLinkedinSequenceCopy((campaign as unknown as Record<string, unknown>).linkedinSequenceCopy as string ?? '');
      setClientId(campaign.client?.id ?? '');
      setSteps(campaign.sequenceSteps.map((s) => ({ stepType: s.stepType as StepType })));
      setSelectedBdrIds(new Set(campaign.bdrs.map((b) => b.slackUserId)));
    }
  }, [open, campaign]);

  const [instantlyCampaigns, setInstantlyCampaigns] = useState<ExternalCampaignItem[]>([]);
  const [heyreachCampaigns, setHeyreachCampaigns] = useState<ExternalCampaignItem[]>([]);

  const fetchInstantlyMut = useMutation({
    mutationFn: () => fetchExternalCampaigns(clientId, 'instantly'),
    onSuccess: (data) => setInstantlyCampaigns(data),
  });

  const fetchHeyreachMut = useMutation({
    mutationFn: () => fetchExternalCampaigns(clientId, 'heyreach'),
    onSuccess: (data) => setHeyreachCampaigns(data),
  });

  const showEmail = campaign.campaignType === 'EMAIL' || campaign.campaignType === 'MULTI_CHANNEL';
  const showPhone = campaign.campaignType === 'PHONE' || campaign.campaignType === 'MULTI_CHANNEL';
  const showLinkedin = campaign.campaignType === 'LINKEDIN' || campaign.campaignType === 'MULTI_CHANNEL';

  const bdrs = bdrsData?.bdrs ?? [];
  const clients = clientsData?.clients ?? [];

  function toggleBdr(slackUserId: string) {
    setSelectedBdrIds((prev) => {
      const next = new Set(prev);
      if (next.has(slackUserId)) {
        next.delete(slackUserId);
      } else {
        next.add(slackUserId);
      }
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const selectedBdrs = bdrs
      .filter((b) => selectedBdrIds.has(b.slackUserId))
      .map((b) => ({
        slackUserId: b.slackUserId,
        slackTeamId: b.slackTeamId,
        displayName: b.name,
      }));

    const data: CampaignEditData = {
      name: name.trim(),
      description: description.trim() || undefined,
      hubspotListId: hubspotListId.trim() || undefined,
      instantlyCampaignId: instantlyCampaignId.trim() || undefined,
      heyreachCampaignId: heyreachCampaignId.trim() || undefined,
      meetingLink: meetingLink.trim() || undefined,
      callScript: callScript.trim() || undefined,
      emailSequenceCopy: emailSequenceCopy.trim() || undefined,
      linkedinSequenceCopy: linkedinSequenceCopy.trim() || undefined,
      clientId: clientId || undefined,
      sequenceSteps: steps.map((s, i) => ({ stepOrder: i, stepType: s.stepType })),
      bdrs: selectedBdrs,
    };

    onSubmit(data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Campaign</DialogTitle>
          <DialogDescription>Update campaign configuration and assignments.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Basic Info</h3>
            <div>
              <Label htmlFor="edit-name">Campaign Name *</Label>
              <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="edit-description">Description</Label>
              <Textarea id="edit-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
          </div>

          {/* Client Assignment */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Client Assignment</h3>
            <div>
              <Label>Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a client..." />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Required before activation</p>
            </div>
          </div>

          {/* BDR Assignment */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">
              BDR Assignment ({selectedBdrIds.size} selected)
            </h3>
            <div className="border rounded-md max-h-48 overflow-y-auto p-3 space-y-2">
              {bdrs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active BDRs found.</p>
              ) : (
                bdrs.map((bdr) => (
                  <label key={bdr.slackUserId} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={selectedBdrIds.has(bdr.slackUserId)}
                      onCheckedChange={() => toggleBdr(bdr.slackUserId)}
                    />
                    <span className="text-sm">{bdr.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Contact Source */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Contact Source</h3>
            <div>
              <Label htmlFor="edit-hubspotListId">HubSpot List ID</Label>
              <Input id="edit-hubspotListId" value={hubspotListId} onChange={(e) => setHubspotListId(e.target.value)} placeholder="e.g. 123" />
            </div>
          </div>

          {/* Channel Config */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Channel Configuration</h3>
            {showEmail && (
              <>
                <div>
                  <Label htmlFor="edit-instantlyCampaignId">Instantly Campaign ID</Label>
                  <div className="flex gap-2">
                    <Input id="edit-instantlyCampaignId" value={instantlyCampaignId} onChange={(e) => setInstantlyCampaignId(e.target.value)} className="flex-1" />
                    {clientId && (
                      <Button type="button" variant="outline" size="sm" onClick={() => fetchInstantlyMut.mutate()} disabled={fetchInstantlyMut.isPending}>
                        {fetchInstantlyMut.isPending ? 'Loading...' : 'Fetch'}
                      </Button>
                    )}
                  </div>
                  {instantlyCampaigns.length > 0 && (
                    <Select value={instantlyCampaignId} onValueChange={setInstantlyCampaignId}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select from fetched campaigns..." />
                      </SelectTrigger>
                      <SelectContent>
                        {instantlyCampaigns.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}{c.status ? ` (${c.status})` : ''}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {fetchInstantlyMut.error && (
                    <p className="text-xs text-destructive mt-1">{(fetchInstantlyMut.error as Error).message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="edit-emailSequenceCopy">Email Sequence Copy</Label>
                  <Textarea id="edit-emailSequenceCopy" value={emailSequenceCopy} onChange={(e) => setEmailSequenceCopy(e.target.value)} rows={3} />
                </div>
              </>
            )}
            {showPhone && (
              <>
                <div>
                  <Label htmlFor="edit-callScript">Call Script</Label>
                  <Textarea id="edit-callScript" value={callScript} onChange={(e) => setCallScript(e.target.value)} rows={3} />
                </div>
                <div>
                  <Label htmlFor="edit-meetingLink">Meeting Link</Label>
                  <Input id="edit-meetingLink" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} />
                </div>
              </>
            )}
            {showLinkedin && (
              <>
                <div>
                  <Label htmlFor="edit-heyreachCampaignId">HeyReach Campaign ID</Label>
                  <div className="flex gap-2">
                    <Input id="edit-heyreachCampaignId" value={heyreachCampaignId} onChange={(e) => setHeyreachCampaignId(e.target.value)} className="flex-1" />
                    {clientId && (
                      <Button type="button" variant="outline" size="sm" onClick={() => fetchHeyreachMut.mutate()} disabled={fetchHeyreachMut.isPending}>
                        {fetchHeyreachMut.isPending ? 'Loading...' : 'Fetch'}
                      </Button>
                    )}
                  </div>
                  {heyreachCampaigns.length > 0 && (
                    <Select value={heyreachCampaignId} onValueChange={setHeyreachCampaignId}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select from fetched campaigns..." />
                      </SelectTrigger>
                      <SelectContent>
                        {heyreachCampaigns.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}{c.status ? ` (${c.status})` : ''}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {fetchHeyreachMut.error && (
                    <p className="text-xs text-destructive mt-1">{(fetchHeyreachMut.error as Error).message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="edit-linkedinSequenceCopy">LinkedIn Sequence Copy</Label>
                  <Textarea id="edit-linkedinSequenceCopy" value={linkedinSequenceCopy} onChange={(e) => setLinkedinSequenceCopy(e.target.value)} rows={3} />
                </div>
              </>
            )}
          </div>

          {/* Sequence Steps */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Sequence Steps</h3>
              <div className="flex gap-2">
                {showEmail && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setSteps((p) => [...p, { stepType: 'EMAIL' }])}>
                    <Plus className="h-3 w-3 mr-1" /> Email
                  </Button>
                )}
                {showPhone && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setSteps((p) => [...p, { stepType: 'PHONE' }])}>
                    <Plus className="h-3 w-3 mr-1" /> Phone
                  </Button>
                )}
                {showLinkedin && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setSteps((p) => [...p, { stepType: 'LINKEDIN' }])}>
                    <Plus className="h-3 w-3 mr-1" /> LinkedIn
                  </Button>
                )}
              </div>
            </div>
            {steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No steps added yet.</p>
            ) : (
              <div className="space-y-2">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border p-3">
                    <span className="text-sm">
                      Step {i + 1}: <span className="font-medium">{step.stepType}</span>
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSteps((p) => p.filter((_, idx) => idx !== i))}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Error + Submit */}
          {error && (
            <p className="text-sm text-destructive">{error.message || 'Failed to update campaign'}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
