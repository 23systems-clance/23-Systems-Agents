import { auth } from '23wf/auth';
import { ChatsPage } from '23wf/chat';

export default async function ChatsRoute() {
  const session = await auth();
  return <ChatsPage session={session} />;
}
