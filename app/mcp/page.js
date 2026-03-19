import { auth } from 'thepopebot/auth';
import { MCPServersPage } from 'thepopebot/chat';

export default async function MCPRoute() {
  const session = await auth();
  return <MCPServersPage session={session} />;
}
