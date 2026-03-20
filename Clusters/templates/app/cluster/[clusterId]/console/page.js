import { auth } from '23wf/auth';
import { ClusterConsolePage } from '23wf/cluster';

export default async function ClusterConsoleRoute({ params }) {
  const session = await auth();
  const { clusterId } = await params;
  return <ClusterConsolePage session={session} clusterId={clusterId} />;
}
