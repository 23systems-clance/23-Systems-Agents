import { auth } from '23wf/auth';
import { ClusterPage } from '23wf/cluster';

export default async function ClusterRoleRoute({ params }) {
  const session = await auth();
  const { clusterId, roleId } = await params;
  return <ClusterPage session={session} clusterId={clusterId} roleId={roleId} />;
}
