import { auth } from '23wf/auth';
import { ClusterLogsPage } from '23wf/cluster';

export default async function ClusterLogsRoute({ params }) {
  const session = await auth();
  const { clusterId } = await params;
  return <ClusterLogsPage session={session} clusterId={clusterId} />;
}
