import { getPublicSkillConfig } from '23wf/skills/public';
import { PublicConsultPage } from '23wf/chat';
import { notFound } from 'next/navigation';

export default async function PublicConsultRoute({ params }) {
  const { skillId } = await params;
  const skill = getPublicSkillConfig(skillId);

  if (!skill || !skill.conversationTree) {
    notFound();
  }

  return (
    <PublicConsultPage
      skillId={skillId}
      config={skill.config}
      conversationTree={skill.conversationTree}
    />
  );
}
