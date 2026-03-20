import { auth } from '23wf/auth';
import { NotificationsPage } from '23wf/chat';

export default async function NotificationsRoute() {
  const session = await auth();
  return <NotificationsPage session={session} />;
}
