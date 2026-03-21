import { auth } from 'thepopebot/auth';
import { NotificationsPage } from 'thepopebot/chat';

export default async function DevNotificationsRoute() {
  const session = await auth();
  return <NotificationsPage session={session} />;
}
