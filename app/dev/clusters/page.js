import { redirect } from 'next/navigation';

export default function DevClustersRoot() {
  redirect('/dev/clusters/list');
}
