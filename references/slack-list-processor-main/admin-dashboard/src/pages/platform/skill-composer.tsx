/**
 * Skill Composer / Skills list page (T038 - Feature 39).
 *
 * Table of skills with status/trigger filters and create button.
 * Doubles as the "Skills" nav page and composer entry point.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Plus } from 'lucide-react';
import { listSkills, type SkillSummary } from '@/services/platform/skills';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  DRAFT: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  TESTING: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  PUBLISHED: 'bg-green-500/10 text-green-600 border-green-500/20',
  DEPRECATED: 'bg-red-500/10 text-red-600 border-red-500/20',
};

const TRIGGER_LABELS: Record<string, string> = {
  SLACK_COMMAND: 'Slack',
  API_CALL: 'API',
  SCHEDULED: 'Scheduled',
  EVENT: 'Event',
  MANUAL: 'Manual',
};

export default function SkillComposerPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [triggerFilter, setTriggerFilter] = useState<string>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['skills', statusFilter, triggerFilter],
    queryFn: () =>
      listSkills({
        status: statusFilter === 'all' ? undefined : statusFilter,
        triggerType: triggerFilter === 'all' ? undefined : triggerFilter,
      }),
  });

  if (isLoading) return <PageSkeleton />;

  const skills = data?.skills ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold">Skills</h1>
            <p className="text-sm text-muted-foreground">
              {skills.length} skill{skills.length !== 1 ? 's' : ''} configured
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="TESTING">Testing</SelectItem>
              <SelectItem value="PUBLISHED">Published</SelectItem>
              <SelectItem value="DEPRECATED">Deprecated</SelectItem>
            </SelectContent>
          </Select>
          <Select value={triggerFilter} onValueChange={setTriggerFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All triggers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All triggers</SelectItem>
              <SelectItem value="SLACK_COMMAND">Slack</SelectItem>
              <SelectItem value="API_CALL">API</SelectItem>
              <SelectItem value="SCHEDULED">Scheduled</SelectItem>
              <SelectItem value="EVENT">Event</SelectItem>
              <SelectItem value="MANUAL">Manual</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => navigate('/platform/skills/new')}>
            <Plus className="mr-2 h-4 w-4" />
            New Skill
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead className="text-right">Credit Cost</TableHead>
              <TableHead className="text-right">Executions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skills.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No skills found. Create your first skill to get started.
                </TableCell>
              </TableRow>
            ) : (
              skills.map((skill: SkillSummary) => (
                <TableRow
                  key={skill.id}
                  className="cursor-pointer hover:bg-muted/50"
                  tabIndex={0}
                  role="link"
                  aria-label={`Skill: ${skill.name}`}
                  onClick={() => navigate(`/platform/skills/${skill.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/platform/skills/${skill.id}`); }}
                >
                  <TableCell>
                    <div>
                      <p className="font-medium">{skill.name}</p>
                      <p className="text-xs text-muted-foreground">{skill.slug}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_COLORS[skill.status] ?? ''}>
                      {skill.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                      {TRIGGER_LABELS[skill.triggerType] ?? skill.triggerType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {skill.agentName} <span className="text-muted-foreground">v{skill.agentVersion}</span>
                  </TableCell>
                  <TableCell className="text-right text-sm">{Number(skill.creditCost).toFixed(2)}</TableCell>
                  <TableCell className="text-right text-sm">{skill.totalExecutions}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
