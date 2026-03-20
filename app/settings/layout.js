import { auth } from '23wf/auth';
import { SettingsLayout } from '23wf/chat';

export default async function Layout({ children }) {
  const session = await auth();
  return <SettingsLayout session={session}>{children}</SettingsLayout>;
}
