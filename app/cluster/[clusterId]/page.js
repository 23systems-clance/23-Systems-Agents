import { auth } from '23wf/auth';
import { ClusterPage } from '23wf/cluster';

export default async function ClusterRoute({ params }) {
  const session = await auth();
  const { clusterId } = await params;
  return <ClusterPage session={session} clusterId={clusterId} />;
}
