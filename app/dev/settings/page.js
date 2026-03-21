import { redirect } from 'next/navigation';

export default function DevSettingsRoot() {
  redirect('/dev/settings/crons');
}
