/**
 * Contact Details Page with personality visualization and conversation history.
 */

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Mail, Phone, Linkedin, Brain, RefreshCw,
  CheckCircle, XCircle, Clock, MessageSquare,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import {
  getContactDetail,
  enrichContact,
  type PersonalityData,
} from '@/services/contact-detail';

/** Horizontal bar for DISC/OCEAN scores (0-1 scale). */
function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-32 shrink-0">{label}</span>
      <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono w-10 text-right">{pct}%</span>
    </div>
  );
}

function PersonalitySection({ personality }: { personality: PersonalityData }) {
  return (
    <div className="space-y-6">
      {/* Archetype */}
      {personality.archetype && (
        <div>
          <h3 className="text-sm font-medium mb-2">Archetype</h3>
          <Badge className="text-sm">{personality.archetype.name}</Badge>
          {personality.archetype.score != null && (
            <span className="text-xs text-muted-foreground ml-2">
              Score: {Math.round(personality.archetype.score * 100)}%
            </span>
          )}
        </div>
      )}

      {/* DISC */}
      {personality.disc && (
        <div>
          <h3 className="text-sm font-medium mb-2">DISC Profile</h3>
          <div className="space-y-2">
            <ScoreBar label="Dominance" value={personality.disc.dominance} />
            <ScoreBar label="Influence" value={personality.disc.influence} />
            <ScoreBar label="Steadiness" value={personality.disc.steadiness} />
            <ScoreBar label="Calculativeness" value={personality.disc.calculativeness} />
          </div>
        </div>
      )}

      {/* OCEAN */}
      {personality.ocean && (
        <div>
          <h3 className="text-sm font-medium mb-2">OCEAN Profile</h3>
          <div className="space-y-2">
            <ScoreBar label="Openness" value={personality.ocean.openness} />
            <ScoreBar label="Conscientiousness" value={personality.ocean.conscientiousness} />
            <ScoreBar label="Extraversion" value={personality.ocean.extraversion} />
            <ScoreBar label="Agreeableness" value={personality.ocean.agreeableness} />
            <ScoreBar label="Emotional Stability" value={personality.ocean.emotional_stability} />
          </div>
        </div>
      )}

      {/* Communication */}
      {personality.communication && (
        <div>
          <h3 className="text-sm font-medium mb-2">Communication Style</h3>
          {personality.communication.adjectives?.length ? (
            <div className="flex flex-wrap gap-1 mb-2">
              {personality.communication.adjectives.map((adj) => (
                <Badge key={adj} variant="secondary" className="text-xs">{adj}</Badge>
              ))}
            </div>
          ) : null}
          {personality.communication.what_to_say?.length ? (
            <div className="mb-2">
              <p className="text-xs font-medium text-green-700 mb-1">What to say:</p>
              <ul className="text-xs text-muted-foreground space-y-0.5 ml-3">
                {personality.communication.what_to_say.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {personality.communication.what_to_avoid?.length ? (
            <div>
              <p className="text-xs font-medium text-red-700 mb-1">What to avoid:</p>
              <ul className="text-xs text-muted-foreground space-y-0.5 ml-3">
                {personality.communication.what_to_avoid.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {/* Key Traits */}
      {personality.key_traits && (
        <div>
          <h3 className="text-sm font-medium mb-2">Key Decision Traits</h3>
          <div className="text-xs space-y-1 text-muted-foreground">
            {personality.key_traits.risk_tolerance && (
              <p>Risk Tolerance: {personality.key_traits.risk_tolerance}</p>
            )}
            {personality.key_traits.decision_speed && (
              <p>Decision Speed: {personality.key_traits.decision_speed}</p>
            )}
            {personality.key_traits.decision_drivers?.length ? (
              <p>Drivers: {personality.key_traits.decision_drivers.join(', ')}</p>
            ) : null}
          </div>
        </div>
      )}

      {/* Email Approach */}
      {personality.email_approach && (
        <div>
          <h3 className="text-sm font-medium mb-2">Email Approach Guide</h3>
          <div className="text-xs space-y-1 text-muted-foreground">
            {personality.email_approach.tone && <p>Tone: {personality.email_approach.tone}</p>}
            {personality.email_approach.length && <p>Length: {personality.email_approach.length}</p>}
            {personality.email_approach.greeting && <p>Greeting: {personality.email_approach.greeting}</p>}
            {personality.email_approach.closing && <p>Closing: {personality.email_approach.closing}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const STEP_ICONS: Record<string, typeof Mail> = {
  EMAIL: Mail,
  PHONE: Phone,
  LINKEDIN: MessageSquare,
};

const EXEC_STATUS_ICONS: Record<string, typeof CheckCircle> = {
  COMPLETED: CheckCircle,
  FAILED: XCircle,
  PENDING: Clock,
  WAITING_WEBHOOK: Clock,
};

export default function ContactDetailPage() {
  const { contactId } = useParams<{ contactId: string }>();
  const queryClient = useQueryClient();
  const [enrichForce, setEnrichForce] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'contact', contactId],
    queryFn: () => getContactDetail(contactId!),
    enabled: !!contactId,
  });

  const enrichMut = useMutation({
    mutationFn: () => enrichContact(contactId!, enrichForce),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'contact', contactId] });
      setEnrichForce(false);
    },
  });

  if (isLoading || !data) return <PageSkeleton />;

  const { contact, campaign, personality, personalityEnrichedAt, conversationHistory } = data;

  return (
    <div className="space-y-6 p-6">
      {/* Back link */}
      <Link to="/bdr/unibox" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to UniBox
      </Link>

      {/* Contact header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{contact.firstName} {contact.lastName}</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
            {contact.jobTitle && <span>{contact.jobTitle}</span>}
            {contact.companyName && <span>at {contact.companyName}</span>}
          </div>
          <div className="flex items-center gap-4 mt-2">
            {contact.email && (
              <span className="flex items-center gap-1 text-xs"><Mail className="h-3 w-3" /> {contact.email}</span>
            )}
            {contact.resolvedPhone && (
              <span className="flex items-center gap-1 text-xs"><Phone className="h-3 w-3" /> {contact.resolvedPhone}</span>
            )}
            {contact.linkedinUrl && (
              <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                <Linkedin className="h-3 w-3" /> LinkedIn
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{contact.status}</Badge>
          {campaign && <Badge variant="secondary">{campaign.name}</Badge>}
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personality */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-4 w-4" /> Personality Profile
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => enrichMut.mutate()}
              disabled={enrichMut.isPending}
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${enrichMut.isPending ? 'animate-spin' : ''}`} />
              {personality ? 'Re-enrich' : 'Enrich'}
            </Button>
          </CardHeader>
          <CardContent>
            {personality ? (
              <>
                {personalityEnrichedAt && (
                  <p className="text-[10px] text-muted-foreground mb-3">
                    Enriched: {new Date(personalityEnrichedAt).toLocaleString()}
                  </p>
                )}
                <PersonalitySection personality={personality} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No personality data available. Click "Enrich" to analyze this contact.
              </p>
            )}
            {enrichMut.isSuccess && enrichMut.data?.skipped && (
              <p className="text-xs text-amber-600 mt-2">{enrichMut.data.reason}</p>
            )}
            {enrichMut.isError && (
              <p className="text-xs text-destructive mt-2">{(enrichMut.error as Error).message}</p>
            )}
          </CardContent>
        </Card>

        {/* Conversation History */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Conversation History</CardTitle>
          </CardHeader>
          <CardContent>
            {conversationHistory.replies.length === 0 && conversationHistory.executions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No conversation history yet.</p>
            ) : (
              <div className="space-y-3">
                {/* Replies */}
                {conversationHistory.replies.map((reply) => (
                  <div key={reply.id} className="border rounded-md p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-blue-500" />
                        <span className="text-xs font-medium">{reply.fromName ?? reply.fromEmail ?? 'Reply'}</span>
                        {reply.draftIntent && (
                          <Badge variant="outline" className="text-[10px]">{reply.draftIntent}</Badge>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(reply.receivedAt).toLocaleDateString()}
                      </span>
                    </div>
                    {reply.subject && (
                      <p className="text-xs text-muted-foreground">Re: {reply.subject}</p>
                    )}
                    <p className="text-xs text-muted-foreground/70 line-clamp-2">{reply.body}</p>
                  </div>
                ))}

                {/* Step Executions */}
                {conversationHistory.executions.map((exec) => {
                  const StepIcon = STEP_ICONS[exec.stepType] ?? Mail;
                  const StatusIcon = EXEC_STATUS_ICONS[exec.status] ?? Clock;
                  return (
                    <div key={exec.id} className="flex items-center gap-3 px-3 py-2 text-xs text-muted-foreground">
                      <StepIcon className="h-3 w-3" />
                      <span>Step {exec.stepIndex + 1} ({exec.stepType})</span>
                      <StatusIcon className="h-3 w-3" />
                      <span>{exec.status}</span>
                      {exec.result && <span>- {exec.result}</span>}
                      <span className="ml-auto text-[10px]">
                        {new Date(exec.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
