import { auth } from 'thepopebot/auth';
import { ChatsPage } from 'thepopebot/chat';

export default async function DevChatsRoute() {
  const session = await auth();
  return <ChatsPage session={session} />;
}
