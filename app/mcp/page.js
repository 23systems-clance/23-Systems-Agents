import { auth } from '23wf/auth';
import { MCPServersPage } from '23wf/chat';

export default async function MCPRoute() {
  const session = await auth();
  return <MCPServersPage session={session} />;
}
