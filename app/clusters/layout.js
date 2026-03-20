import { auth } from '23wf/auth';
import { ClustersLayout } from '23wf/cluster';

export default async function Layout({ children }) {
  const session = await auth();
  return <ClustersLayout session={session}>{children}</ClustersLayout>;
}
