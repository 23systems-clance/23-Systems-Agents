/**
 * Network Requirements Page (T115 - Power Dialer Phase 12)
 *
 * Displays firewall and network configuration documentation
 * for Brazil-based BDRs using the power dialer.
 */

import { NetworkRequirements } from '@/components/dialer/NetworkRequirements';

export default function NetworkRequirementsPage() {
  return (
    <div className="p-6">
      <NetworkRequirements />
    </div>
  );
}
