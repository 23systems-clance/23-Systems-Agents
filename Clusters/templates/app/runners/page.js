import { auth } from '23wf/auth';
import { RunnersPage } from '23wf/chat';

export default async function RunnersRoute() {
  const session = await auth();
  return <RunnersPage session={session} />;
}
