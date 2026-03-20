import { getPageAuthState } from '23wf/auth';
import { AsciiLogo, SetupForm, LoginForm } from '23wf/auth/components';

export default async function LoginPage() {
  const { needsSetup } = await getPageAuthState();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <AsciiLogo />
      {needsSetup ? <SetupForm /> : <LoginForm />}
    </main>
  );
}
