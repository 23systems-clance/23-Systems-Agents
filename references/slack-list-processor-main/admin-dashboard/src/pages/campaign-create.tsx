import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useWorkspaceId } from '@/hooks/useWorkspaceId';
import { createCampaign, type CreateCampaignInput } from '@/services/campaigns';
import { fetchBdrs } from '@/services/bdrs';
import { fetchManagedClients } from '@/services/managed-clients';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

type CampaignType = 'EMAIL' | 'PHONE' | 'LINKEDIN' | 'MULTI_CHANNEL';
type StepType = 'EMAIL' | 'PHONE' | 'LINKEDIN';

export default function CampaignCreatePage() {
  const navigate = useNavigate();
  const { teamId, isLoading: teamLoading } = useWorkspaceId();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [campaignType, setCampaignType] = useState<CampaignType>('EMAIL');
  const [hubspotListId, setHubspotListId] = useState('');
  const [instantlyCampaignId, setInstantlyCampaignId] = useState('');
  const [heyreachCampaignId, setHeyreachCampaignId] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [callScript, setCallScript] = useState('');
  const [emailSequenceCopy, setEmailSequenceCopy] = useState('');
  const [linkedinSequenceCopy, setLinkedinSequenceCopy] = useState('');
  const [steps, setSteps] = useState<Array<{ stepType: StepType }>>([]);
  const [clientId, setClientId] = useState('');
  const [selectedBdrIds, setSelectedBdrIds] = useState<Set<string>>(new Set());

  const { data: bdrsData } = useQuery({
    queryKey: ['admin', 'bdrs', 'active'],
    queryFn: () => fetchBdrs({ isActive: 'true' }),
  });

  const { data: clientsData } = useQuery({
    queryKey: ['admin', 'clients', 'active'],
    queryFn: () => fetchManagedClients({ isActive: 'true' }),
  });

  const bdrs = bdrsData?.bdrs ?? [];
  const clients = clientsData?.clients ?? [];

  const mutation = useMutation({
    mutationFn: (input: CreateCampaignInput) => createCampaign(input),
    onSuccess: (campaign) => {
      navigate(`/campaigns/${campaign.id}`);
    },
  });

  if (teamLoading) return <PageSkeleton />;

  function addStep(type: StepType) {
    setSteps((prev) => [...prev, { stepType: type }]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleBdr(slackUserId: string) {
    setSelectedBdrIds((prev) => {
      const next = new Set(prev);
      if (next.has(slackUserId)) next.delete(slackUserId);
      else next.add(slackUserId);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!teamId || !name.trim()) return;

    const input: CreateCampaignInput = {
      slackTeamId: teamId,
      name: name.trim(),
      campaignType,
      ...(description.trim() && { description: description.trim() }),
      ...(hubspotListId.trim() && { hubspotListId: hubspotListId.trim() }),
      ...(instantlyCampaignId.trim() && { instantlyCampaignId: instantlyCampaignId.trim() }),
      ...(heyreachCampaignId.trim() && { heyreachCampaignId: heyreachCampaignId.trim() }),
      ...(meetingLink.trim() && { meetingLink: meetingLink.trim() }),
      ...(callScript.trim() && { callScript: callScript.trim() }),
      ...(emailSequenceCopy.trim() && { emailSequenceCopy: emailSequenceCopy.trim() }),
      ...(linkedinSequenceCopy.trim() && { linkedinSequenceCopy: linkedinSequenceCopy.trim() }),
      ...(steps.length > 0 && {
        sequenceSteps: steps.map((s, i) => ({ stepOrder: i, stepType: s.stepType })),
      }),
      ...(clientId && { clientId }),
      ...(selectedBdrIds.size > 0 && {
        bdrs: bdrs
          .filter((b) => selectedBdrIds.has(b.slackUserId))
          .map((b) => ({
            slackUserId: b.slackUserId,
            slackTeamId: b.slackTeamId,
            displayName: b.name,
          })),
      }),
    };

    mutation.mutate(input);
  }

  const showEmail = campaignType === 'EMAIL' || campaignType === 'MULTI_CHANNEL';
  const showPhone = campaignType === 'PHONE' || campaignType === 'MULTI_CHANNEL';
  const showLinkedin = campaignType === 'LINKEDIN' || campaignType === 'MULTI_CHANNEL';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/campaigns')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold">Create Campaign</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        {/* Basic Info */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Basic Info</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Campaign Name *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div>
              <Label>Campaign Type *</Label>
              <Select value={campaignType} onValueChange={(v) => setCampaignType(v as CampaignType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMAIL">Email</SelectItem>
                  <SelectItem value="PHONE">Phone</SelectItem>
                  <SelectItem value="LINKEDIN">LinkedIn</SelectItem>
                  <SelectItem value="MULTI_CHANNEL">Multi-Channel</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Client Assignment */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Client Assignment</CardTitle></CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>

        {/* BDR Assignment */}
        <Card>
          <CardHeader><CardTitle className="text-lg">BDR Assignment ({selectedBdrIds.size} selected)</CardTitle></CardHeader>
          <CardContent>
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
            <p className="text-xs text-muted-foreground mt-1">At least one BDR required before activation</p>
          </CardContent>
        </Card>

        {/* Contact List */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Contact Source</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="hubspotListId">HubSpot List ID</Label>
              <Input id="hubspotListId" value={hubspotListId} onChange={(e) => setHubspotListId(e.target.value)} placeholder="e.g. 123" />
            </div>
          </CardContent>
        </Card>

        {/* Channel Config */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Channel Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {showEmail && (
              <>
                <div>
                  <Label htmlFor="instantlyCampaignId">Instantly Campaign ID</Label>
                  <Input id="instantlyCampaignId" value={instantlyCampaignId} onChange={(e) => setInstantlyCampaignId(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="emailSequenceCopy">Email Sequence Copy</Label>
                  <Textarea id="emailSequenceCopy" value={emailSequenceCopy} onChange={(e) => setEmailSequenceCopy(e.target.value)} rows={3} />
                </div>
              </>
            )}
            {showPhone && (
              <>
                <div>
                  <Label htmlFor="callScript">Call Script</Label>
                  <Textarea id="callScript" value={callScript} onChange={(e) => setCallScript(e.target.value)} rows={3} />
                </div>
                <div>
                  <Label htmlFor="meetingLink">Meeting Link</Label>
                  <Input id="meetingLink" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} />
                </div>
              </>
            )}
            {showLinkedin && (
              <>
                <div>
                  <Label htmlFor="heyreachCampaignId">HeyReach Campaign ID</Label>
                  <Input id="heyreachCampaignId" value={heyreachCampaignId} onChange={(e) => setHeyreachCampaignId(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="linkedinSequenceCopy">LinkedIn Sequence Copy</Label>
                  <Textarea id="linkedinSequenceCopy" value={linkedinSequenceCopy} onChange={(e) => setLinkedinSequenceCopy(e.target.value)} rows={3} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Sequence Steps */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Sequence Steps</CardTitle>
              <div className="flex gap-2">
                {showEmail && (
                  <Button type="button" variant="outline" size="sm" onClick={() => addStep('EMAIL')}>
                    <Plus className="h-3 w-3 mr-1" /> Email
                  </Button>
                )}
                {showPhone && (
                  <Button type="button" variant="outline" size="sm" onClick={() => addStep('PHONE')}>
                    <Plus className="h-3 w-3 mr-1" /> Phone
                  </Button>
                )}
                {showLinkedin && (
                  <Button type="button" variant="outline" size="sm" onClick={() => addStep('LINKEDIN')}>
                    <Plus className="h-3 w-3 mr-1" /> LinkedIn
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No steps added yet. Add steps using the buttons above.</p>
            ) : (
              <div className="space-y-2">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border p-3">
                    <span className="text-sm">
                      Step {i + 1}: <span className="font-medium">{step.stepType}</span>
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeStep(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Submit */}
        {mutation.error && (
          <p className="text-sm text-destructive">
            {(mutation.error as Error).message || 'Failed to create campaign'}
          </p>
        )}
        <div className="flex gap-3">
          <Button type="submit" disabled={mutation.isPending || !name.trim()}>
            {mutation.isPending ? 'Creating...' : 'Create Campaign'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/campaigns')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
