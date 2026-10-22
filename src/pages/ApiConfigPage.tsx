import React, { useState } from 'react';
import {
  Server,
  Shield,
  FileCode2,
  Terminal,
  Network,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
} from 'lucide-react';
import { getRegionalEndpoints, areRealRegionalApisConfigured } from '../services/regionalApi';
import { REGIONS, type RegionId } from '../types/ping';

export const ApiConfigPage: React.FC = () => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const endpoints = getRegionalEndpoints();
  const isConfigured = areRealRegionalApisConfigured();

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const sampleEnvConfig = `# Regional Ping API Endpoints (.env)
VITE_REGIONAL_API_BASE_URL="https://api.internal.network/v1"

# Or configure individual regional daemon endpoints:
# VITE_IN_DC01_API_URL="https://in-dc01.internal.network:8443"
# VITE_IN_DC02_API_URL="https://in-dc02.internal.network:8443"
# VITE_LK_DC01_API_URL="https://lk-dc01.internal.network:8443"
# VITE_SG_DC01_API_URL="https://sg-dc01.internal.network:8443"`;

  const sampleDaemonCode = `// Authorized Regional Ping Daemon Service (Golang / Node.js)
// Executes ICMP ping safely via child process array (NEVER raw shell sh -c)
import { execFile } from 'node:child_process';

export function executeSafeRegionalPing(targetIp: string, count: number): Promise<string> {
  // 1. Strict IPv4 format validation
  if (!/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(targetIp)) {
    throw new Error('Invalid target IPv4 address');
  }

  // 2. Bound ping request count (1 to 100)
  const safeCount = Math.min(Math.max(1, count), 100);

  return new Promise((resolve, reject) => {
    // 3. Sandboxed execFile call (Windows: -n | Linux: -c)
    const isWin = process.platform === 'win32';
    const args = isWin 
      ? ['-n', String(safeCount), targetIp]
      : ['-c', String(safeCount), targetIp];

    execFile('ping', args, { timeout: 35000 }, (error, stdout) => {
      if (error && !stdout) return reject(error);
      resolve(stdout);
    });
  });
}`;

  return (
    <div className="space-y-6">
      {/* Title Card */}
      <div className="bg-white border border-[#D7E3F2] rounded-2xl p-6 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#EBF3FF] flex items-center justify-center text-[#1764E8]">
            <Network className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#17365D]">
              Regional API Configuration & Gateway Specs
            </h2>
            <p className="text-xs text-[#607A9B]">
              Connection parameters and daemon status for authorized regional servers
            </p>
          </div>
        </div>
      </div>

      {/* Integration Status Notice */}
      <div className={`p-4 rounded-2xl border text-xs flex items-start gap-3 shadow-xs ${
        isConfigured 
          ? 'bg-[#E6F8F3] border-[#A7F3D0] text-[#079669]' 
          : 'bg-[#FEF5E7] border-[#FDE68A] text-[#E99500]'
      }`}>
        {isConfigured ? (
          <CheckCircle2 className="w-5 h-5 shrink-0 text-[#079669] mt-0.5" />
        ) : (
          <AlertCircle className="w-5 h-5 shrink-0 text-[#E99500] mt-0.5" />
        )}
        <div className="space-y-1">
          <p className="font-bold text-[#17365D]">
            {isConfigured ? 'Regional APIs Connected' : 'Regional Ping APIs Not Configured Yet'}
          </p>
          <p className="text-[#607A9B] leading-relaxed">
            {isConfigured
              ? 'Authorized regional server endpoints are active and ready to receive ICMP ping dispatch requests.'
              : 'Connect the authorized regional servers in Mumbai, Chennai, Colombo, and Singapore to run real tests. Browser JavaScript does not execute operating-system commands directly.'}
          </p>
        </div>
      </div>

      {/* Regional Endpoints Table */}
      <div className="bg-white border border-[#D7E3F2] rounded-2xl overflow-hidden shadow-xs">
        <div className="p-5 border-b border-[#D7E3F2]">
          <h3 className="text-sm font-bold text-[#17365D]">
            Authorized Regional Endpoints
          </h3>
          <p className="text-xs text-[#607A9B] mt-0.5">
            Target data center servers configured to execute <code className="text-[#1764E8] font-mono font-medium">ping 8.8.8.8 -n 30</code> safely
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#F8FAFC] text-[#607A9B] border-b border-[#D7E3F2] text-[11px] font-semibold">
              <tr>
                <th className="py-3 px-4">Region ID</th>
                <th className="py-3 px-4">Data Center Location</th>
                <th className="py-3 px-4">Infrastructure Provider</th>
                <th className="py-3 px-4">Endpoint URL</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EBF2FA]">
              {(['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'] as RegionId[]).map(rid => {
                const meta = REGIONS[rid];
                const ep = endpoints[rid];
                return (
                  <tr key={rid} className="hover:bg-[#F8FAFD] transition-colors">
                    <td className="py-3.5 px-4 font-bold text-[#1764E8]">
                      {rid}
                    </td>
                    <td className="py-3.5 px-4 font-sans text-[#17365D]">
                      <div className="font-semibold">{meta.fullName}</div>
                      <div className="text-[11px] text-[#607A9B]">{meta.location}</div>
                    </td>
                    <td className="py-3.5 px-4 font-sans text-[#607A9B]">
                      {meta.provider}
                    </td>
                    <td className="py-3.5 px-4 text-[#17365D]">
                      {ep?.baseUrl ? (
                        <span className="font-mono">{ep.baseUrl}</span>
                      ) : (
                        <span className="text-[#607A9B]/60 italic font-sans">Not set (provide in .env)</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {ep?.isEnabled && ep.baseUrl ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-[#E6F8F3] text-[#079669] border border-[#A7F3D0] font-sans">
                          Configured
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#EDF2F7] text-[#607A9B] border border-[#D7E3F2] font-sans">
                          Pending
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Security Architecture & Reference Daemon Code */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Environment Configuration Guide */}
        <div className="bg-white border border-[#D7E3F2] rounded-2xl p-6 space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[#17365D] font-bold text-sm">
              <FileCode2 className="w-4 h-4 text-[#1764E8]" />
              <span>Environment Configuration (.env)</span>
            </div>
            <button
              onClick={() => copyText(sampleEnvConfig, 'env')}
              className="text-xs text-[#607A9B] hover:text-[#17365D] flex items-center gap-1 font-mono cursor-pointer"
            >
              {copiedSection === 'env' ? <Check className="w-3.5 h-3.5 text-[#079669]" /> : <Copy className="w-3.5 h-3.5" />}
              <span>Copy</span>
            </button>
          </div>

          <pre className="p-3.5 bg-[#0F172A] rounded-xl text-[11px] font-mono text-[#38BDF8] overflow-x-auto whitespace-pre-wrap leading-relaxed">
            {sampleEnvConfig}
          </pre>
        </div>

        {/* Security Controls */}
        <div className="bg-white border border-[#D7E3F2] rounded-2xl p-6 space-y-3.5 shadow-xs">
          <div className="flex items-center gap-2 text-[#17365D] font-bold text-sm">
            <Shield className="w-4 h-4 text-[#1764E8]" />
            <span>Server Security Directives</span>
          </div>

          <ul className="space-y-2.5 text-xs text-[#607A9B]">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#079669] shrink-0 mt-0.5" />
              <span>
                <strong className="text-[#17365D]">No Shell Execution:</strong> Regional daemons must invoke <code className="text-[#1764E8] font-mono bg-[#EBF3FF] px-1 py-0.5 rounded">execFile('ping', args)</code> rather than shell interpretation to prevent command injection.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#079669] shrink-0 mt-0.5" />
              <span>
                <strong className="text-[#17365D]">Strict IPv4 Validation:</strong> Target IP must match IPv4 format regex before subprocess invocation.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#079669] shrink-0 mt-0.5" />
              <span>
                <strong className="text-[#17365D]">Bounded Count:</strong> Packet counts clamped between 1 and 100 packets.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};
