import { auth } from '23wf/auth';
import { PullRequestsPage } from '23wf/chat';

export default async function PullRequestsRoute() {
  const session = await auth();
  return <PullRequestsPage session={session} />;
}
