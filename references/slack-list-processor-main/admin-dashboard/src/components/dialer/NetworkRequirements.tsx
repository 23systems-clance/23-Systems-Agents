/**
 * NetworkRequirements Component (T115 - Power Dialer Phase 12)
 *
 * Displays firewall and network configuration requirements for
 * Brazil-based BDRs using the power dialer. Linkable from the
 * PreCallCheck failure state.
 */

import { Shield, Wifi, Globe, Server, AlertTriangle, Copy, Check } from 'lucide-react';
import { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface PortRequirement {
  protocol: string;
  ports: string;
  destination: string;
  purpose: string;
}

const PORT_REQUIREMENTS: PortRequirement[] = [
  {
    protocol: 'TCP',
    ports: '443',
    destination: 'Twilio Signaling',
    purpose: 'WebSocket signaling for call setup and teardown',
  },
  {
    protocol: 'UDP',
    ports: '10000-60000',
    destination: 'Twilio Media',
    purpose: 'RTP/SRTP audio media streams (WebRTC)',
  },
  {
    protocol: 'TCP',
    ports: '443',
    destination: 'Twilio TURN',
    purpose: 'Fallback relay when UDP is blocked',
  },
];

const IP_RANGES = [
  { range: '168.86.128.0/18', description: 'Twilio Media Servers (Global)' },
  { range: '54.172.60.0/23', description: 'Twilio Signaling (US East)' },
  { range: '54.244.51.0/24', description: 'Twilio Signaling (US West)' },
  { range: '177.71.206.192/26', description: 'Twilio Media (South America)' },
];

const EDGE_LOCATIONS = [
  { edge: 'ashburn', region: 'US East (Virginia)', primary: true },
  { edge: 'sao-paulo', region: 'South America (Brazil)', primary: true },
  { edge: 'umatilla', region: 'US West (Oregon)', primary: false },
];

// ---------------------------------------------------------------------------
// Copy button helper
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NetworkRequirements() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
          <Shield className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Network Requirements</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Firewall and network configuration for the Power Dialer (WebRTC voice)
          </p>
        </div>
      </div>

      {/* Important notice */}
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="text-sm text-amber-800">
          <p className="font-medium">For Brazil-based BDRs</p>
          <p className="mt-0.5 text-amber-700">
            Ensure your corporate firewall allows the outbound connections listed below.
            WebRTC requires both TCP (signaling) and UDP (media) access to Twilio servers.
          </p>
        </div>
      </div>

      {/* Port Requirements */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Server className="h-4 w-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">Required Outbound Ports</h3>
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-2 font-medium text-gray-600">Protocol</th>
                <th className="px-4 py-2 font-medium text-gray-600">Ports</th>
                <th className="px-4 py-2 font-medium text-gray-600">Destination</th>
                <th className="px-4 py-2 font-medium text-gray-600">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {PORT_REQUIREMENTS.map((req, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {req.protocol}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-900">
                    {req.ports} <CopyButton text={req.ports} />
                  </td>
                  <td className="px-4 py-2 text-gray-700">{req.destination}</td>
                  <td className="px-4 py-2 text-gray-500">{req.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* IP Ranges */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Globe className="h-4 w-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">Twilio IP Ranges (Allowlist)</h3>
        </div>
        <div className="grid gap-2">
          {IP_RANGES.map((ip, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2.5"
            >
              <div className="flex items-center gap-3">
                <code className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-800">
                  {ip.range}
                </code>
                <CopyButton text={ip.range} />
              </div>
              <span className="text-xs text-gray-500">{ip.description}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Full list:{' '}
          <a
            href="https://www.twilio.com/docs/sip-trunking/ip-addresses"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            Twilio IP Addresses Documentation
          </a>
        </p>
      </section>

      {/* Edge Locations */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Wifi className="h-4 w-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">Configured Edge Locations</h3>
        </div>
        <div className="grid gap-2">
          {EDGE_LOCATIONS.map((loc) => (
            <div
              key={loc.edge}
              className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2.5"
            >
              <div className="flex items-center gap-2">
                <code className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-800">
                  {loc.edge}
                </code>
                {loc.primary && (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
                    Primary
                  </span>
                )}
              </div>
              <span className="text-xs text-gray-500">{loc.region}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Codec & DSCP */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Audio Configuration</h3>
        <div className="rounded-lg border border-gray-200 p-4 space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <span>Codec preference</span>
            <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">Opus &gt; PCMU</code>
          </div>
          <div className="flex justify-between">
            <span>Max average bitrate</span>
            <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">16000 bps</code>
          </div>
          <div className="flex justify-between">
            <span>DSCP marking</span>
            <span className="text-xs font-medium text-green-600">Enabled (EF)</span>
          </div>
          <div className="flex justify-between">
            <span>Acceptable RTT</span>
            <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">&lt; 400ms</code>
          </div>
          <div className="flex justify-between">
            <span>Target MOS</span>
            <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">&ge; 3.5</code>
          </div>
        </div>
      </section>

      {/* Troubleshooting */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Troubleshooting</h3>
        <ul className="space-y-1.5 text-sm text-gray-600">
          <li className="flex gap-2">
            <span className="text-gray-400">1.</span>
            Run the Pre-Call Check before starting a dialing session to verify connectivity.
          </li>
          <li className="flex gap-2">
            <span className="text-gray-400">2.</span>
            If UDP ports are blocked, Twilio will fall back to TCP/443 (TURN), but audio quality may degrade.
          </li>
          <li className="flex gap-2">
            <span className="text-gray-400">3.</span>
            Check the Call Quality indicator during calls — yellow/red signals indicate network issues.
          </li>
          <li className="flex gap-2">
            <span className="text-gray-400">4.</span>
            Contact your IT team to allowlist the Twilio IP ranges listed above.
          </li>
        </ul>
      </section>
    </div>
  );
}
