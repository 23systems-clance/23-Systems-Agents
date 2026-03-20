import { auth } from '23wf/auth';
import { ChatPage } from '23wf/chat';

export default async function DevHome() {
  const session = await auth();
  return <ChatPage session={session} needsSetup={false} />;
}
