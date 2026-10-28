import React, { useState, useEffect } from 'react';
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
  Save,
  RotateCcw,
  Zap,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import {
  getRegionalEndpoints,
  saveStoredEndpoints,
  clearStoredEndpoints,
  testRegionalEndpointConnection,
  type RegionalEndpointConfig,
} from '../services/regionalApi';
import { REGIONS, COUNTRY_CODES, type RegionId } from '../types/ping';

export const ApiConfigPage: React.FC = () => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [endpoints, setEndpoints] = useState<Record<RegionId, RegionalEndpointConfig>>(() =>
    getRegionalEndpoints()
  );

  // Editable URL inputs
  const [inputUrls, setInputUrls] = useState<Record<RegionId, string>>(() => {
    const ep = getRegionalEndpoints();
    return {
      'IN-DC01': ep['IN-DC01'].baseUrl,
      'IN-DC02': ep['IN-DC02'].baseUrl,
      'LK-DC01': ep['LK-DC01'].baseUrl,
      'SG-DC01': ep['SG-DC01'].baseUrl,
    };
  });

  // Global base url helper
  const [bulkBaseUrl, setBulkBaseUrl] = useState<string>('');

  // Per-endpoint connection test states
  const [testStates, setTestStates] = useState<
    Record<
      RegionId,
      {
        testing: boolean;
        result?: {
          ok: boolean;
          latencyMs: number;
          message: string;
        };
      }
    >
  >({
    'IN-DC01': { testing: false },
    'IN-DC02': { testing: false },
    'LK-DC01': { testing: false },
    'SG-DC01': { testing: false },
  });

  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  const regionIds: RegionId[] = ['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'];

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const handleUrlChange = (rid: RegionId, val: string) => {
    setInputUrls(prev => ({ ...prev, [rid]: val }));
    // Clear test result when URL changes
    setTestStates(prev => ({
      ...prev,
      [rid]: { testing: false },
    }));
    setSaveSuccess(false);
  };

  const handleApplyBulkBase = () => {
    if (!bulkBaseUrl.trim()) return;
    const base = bulkBaseUrl.trim().replace(/\/+$/, '');
    setInputUrls({
      'IN-DC01': `${base}/in-dc01`,
      'IN-DC02': `${base}/in-dc02`,
      'LK-DC01': `${base}/lk-dc01`,
      'SG-DC01': `${base}/sg-dc01`,
    });
    setSaveSuccess(false);
  };

  const handleSave = () => {
    saveStoredEndpoints(inputUrls);
    const updated = getRegionalEndpoints();
    setEndpoints(updated);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleReset = () => {
    clearStoredEndpoints();
    const fresh = getRegionalEndpoints();
    setEndpoints(fresh);
    setInputUrls({
      'IN-DC01': fresh['IN-DC01'].baseUrl,
      'IN-DC02': fresh['IN-DC02'].baseUrl,
      'LK-DC01': fresh['LK-DC01'].baseUrl,
      'SG-DC01': fresh['SG-DC01'].baseUrl,
    });
    setTestStates({
      'IN-DC01': { testing: false },
      'IN-DC02': { testing: false },
      'LK-DC01': { testing: false },
      'SG-DC01': { testing: false },
    });
    setSaveSuccess(false);
  };

  const handleTestConnection = async (rid: RegionId) => {
    const urlToTest = inputUrls[rid];
    setTestStates(prev => ({
      ...prev,
      [rid]: { testing: true },
    }));

    const res = await testRegionalEndpointConnection(rid, urlToTest);

    setTestStates(prev => ({
      ...prev,
      [rid]: {
        testing: false,
        result: {
          ok: res.ok,
          latencyMs: res.latencyMs,
          message: res.message,
        },
      },
    }));
  };

  const configuredCount = Object.values(endpoints).filter(e => e.isEnabled && e.baseUrl).length;
  const isFullyConfigured = configuredCount === 4;

  const sampleEnvConfig = `# Regional Ping API Endpoints (.env)
VITE_REGIONAL_API_BASE_URL="https://api.internal.network:8443"

# Or configure individual regional server endpoints directly:
VITE_IN_DC01_API_URL="https://in-dc01.internal.network:8443"
VITE_IN_DC02_API_URL="https://in-dc02.internal.network:8443"
VITE_LK_DC01_API_URL="https://lk-dc01.internal.network:8443"
VITE_SG_DC01_API_URL="https://sg-dc01.internal.network:8443"`;

  const sampleRunCommand = `# Start daemon on remote regional server (IN-DC01 Mumbai):
REGION_ID=IN-DC01 PORT=8080 node server/regional-ping-daemon.js

# Start daemon on remote regional server (SG-DC01 Singapore):
REGION_ID=SG-DC01 PORT=8080 node server/regional-ping-daemon.js`;

  return (
    <div className="space-y-6">
      {/* Title Card */}
      <div className="bg-white border border-[#D7E3F2] rounded-2xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#EBF3FF] flex items-center justify-center text-[#1764E8]">
            <Network className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#17365D]">
              Regional API Configuration & Gateway Specs
            </h2>
            <p className="text-xs text-[#607A9B]">
              Configure and test endpoint URLs for the 4 regional ICMP ping daemons
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={handleReset}
            className="px-3 py-2 rounded-xl border border-[#D7E3F2] bg-white hover:bg-[#F8FAFD] text-[#607A9B] hover:text-[#17365D] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to Defaults</span>
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-xl bg-[#1764E8] hover:bg-[#124A9C] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Configuration</span>
          </button>
        </div>
      </div>

      {/* Save Success Banner */}
      {saveSuccess && (
        <div className="p-3.5 rounded-xl bg-[#E6F8F3] border border-[#A7F3D0] text-[#079669] text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#079669]" />
          <span className="font-semibold">
            Regional endpoint URLs saved successfully. The dashboard will now target these server endpoints.
          </span>
        </div>
      )}

      {/* Integration Status Card */}
      <div
        className={`p-4 rounded-2xl border text-xs flex items-start gap-3 shadow-xs ${
          isFullyConfigured
            ? 'bg-[#E6F8F3] border-[#A7F3D0] text-[#079669]'
            : configuredCount > 0
            ? 'bg-[#EBF3FF] border-[#BBD3F5] text-[#1764E8]'
            : 'bg-[#FEF5E7] border-[#FDE68A] text-[#E99500]'
        }`}
      >
        {isFullyConfigured ? (
          <CheckCircle2 className="w-5 h-5 shrink-0 text-[#079669] mt-0.5" />
        ) : (
          <AlertCircle className="w-5 h-5 shrink-0 text-[#E99500] mt-0.5" />
        )}
        <div className="space-y-1">
          <p className="font-bold text-[#17365D]">
            {isFullyConfigured
              ? 'All 4 Regional Endpoints Configured'
              : configuredCount > 0
              ? `${configuredCount} of 4 Regional Endpoints Configured`
              : 'Regional Ping APIs Not Configured Yet'}
          </p>
          <p className="text-[#607A9B] leading-relaxed">
            {isFullyConfigured
              ? 'Authorized regional server endpoints are set for Mumbai, Chennai, Colombo, and Singapore. Tests will execute fixed ICMP pings concurrently.'
              : 'Enter the endpoint URLs for your deployed regional daemons below or configure your environment variables. Each endpoint must run the secure daemon script (see instructions below).'}
          </p>
        </div>
      </div>

      {/* Bulk Configuration Tool */}
      <div className="bg-white border border-[#D7E3F2] rounded-2xl p-5 shadow-xs space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-[#17365D]">
          <Zap className="w-4 h-4 text-[#1764E8]" />
          <span>Quick Setup via Central API Gateway</span>
        </div>
        <p className="text-xs text-[#607A9B]">
          If you run a reverse proxy or central gateway routing to your 4 regional nodes, enter the base URL below to auto-populate all endpoints:
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-2.5">
          <input
            type="text"
            value={bulkBaseUrl}
            onChange={e => setBulkBaseUrl(e.target.value)}
            placeholder="e.g. https://ping-gateway.internal.company.com/v1"
            className="flex-1 w-full bg-[#F8FAFD] border border-[#D7E3F2] rounded-xl px-3.5 py-2 text-xs font-mono text-[#17365D] focus:outline-none focus:border-[#1764E8]"
          />
          <button
            onClick={handleApplyBulkBase}
            className="w-full sm:w-auto px-4 py-2 rounded-xl bg-[#EFF5FC] hover:bg-[#D7E3F2] text-[#1764E8] font-semibold text-xs transition-colors shrink-0 cursor-pointer"
          >
            Apply to Regions
          </button>
        </div>
      </div>

      {/* Interactive Regional Endpoints Table */}
      <div className="bg-white border border-[#D7E3F2] rounded-2xl overflow-hidden shadow-xs">
        <div className="p-5 border-b border-[#D7E3F2]">
          <h3 className="text-sm font-bold text-[#17365D]">Authorized Regional Endpoints</h3>
          <p className="text-xs text-[#607A9B] mt-0.5">
            Configure the URL for each regional data center. Click "Test Connection" to verify the daemon is reachable.
          </p>
        </div>

        <div className="divide-y divide-[#EBF2FA]">
          {regionIds.map(rid => {
            const meta = REGIONS[rid];
            const test = testStates[rid];
            const currentUrl = inputUrls[rid] || '';
            const countryCode = COUNTRY_CODES[rid];

            return (
              <div key={rid} className="p-4 sm:p-5 hover:bg-[#F8FAFD] transition-colors space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  {/* Region Identifier & Country Badge */}
                  <div className="flex items-center gap-3 min-w-[260px]">
                    <div
                      className={`w-9 h-9 rounded-full border flex items-center justify-center shrink-0 font-extrabold text-xs select-none ${
                        countryCode === 'IN'
                          ? 'bg-[#EFF5FC] text-[#1764E8] border-[#D7E3F2]'
                          : countryCode === 'SL'
                          ? 'bg-[#F0FDFA] text-[#0D9488] border-[#CCFBF1]'
                          : 'bg-[#EEF2FF] text-[#4F46E5] border-[#E0E7FF]'
                      }`}
                    >
                      {countryCode}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#17365D] text-sm">{rid}</span>
                        <span className="text-xs text-[#607A9B] font-medium">— {meta.fullName}</span>
                      </div>
                      <div className="text-[11px] text-[#607A9B]">{meta.location} • {meta.provider}</div>
                    </div>
                  </div>

                  {/* URL Input */}
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      type="text"
                      value={currentUrl}
                      onChange={e => handleUrlChange(rid, e.target.value)}
                      placeholder={`e.g. https://${rid.toLowerCase()}.internal.network:8443`}
                      className="flex-1 bg-white border border-[#D7E3F2] rounded-xl px-3.5 py-2 text-xs font-mono text-[#17365D] focus:outline-none focus:border-[#1764E8]"
                    />
                    <button
                      onClick={() => handleTestConnection(rid)}
                      disabled={test.testing || !currentUrl.trim()}
                      className="px-3.5 py-2 rounded-xl bg-white border border-[#D7E3F2] hover:bg-[#EFF5FC] text-[#1764E8] font-semibold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
                    >
                      {test.testing ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Probing...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5" />
                          <span>Test Connection</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Probe / Connection Status Result */}
                {test.result && (
                  <div
                    className={`ml-0 md:ml-12 p-2.5 rounded-xl border text-xs flex items-center gap-2 ${
                      test.result.ok
                        ? 'bg-[#E6F8F3] border-[#A7F3D0] text-[#079669]'
                        : 'bg-[#FDECEC] border-[#FCA5A5] text-[#D93652]'
                    }`}
                  >
                    {test.result.ok ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-[#079669]" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 text-[#D93652]" />
                    )}
                    <span className="font-mono text-[11px]">{test.result.message}</span>
                  </div>
                )}
              </div>
            );
          })}
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

        {/* Server Security Directives */}
        <div className="bg-white border border-[#D7E3F2] rounded-2xl p-6 space-y-3.5 shadow-xs">
          <div className="flex items-center gap-2 text-[#17365D] font-bold text-sm">
            <Shield className="w-4 h-4 text-[#1764E8]" />
            <span>Server Security Directives</span>
          </div>

          <ul className="space-y-2.5 text-xs text-[#607A9B]">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#079669] shrink-0 mt-0.5" />
              <span>
                <strong className="text-[#17365D]">Zero Client Software:</strong> Management machines require NO software or agent installation; tests are orchestrated via browser HTTP.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#079669] shrink-0 mt-0.5" />
              <span>
                <strong className="text-[#17365D]">No Shell Interpretation:</strong> Daemons invoke <code className="text-[#1764E8] font-mono bg-[#EBF3FF] px-1 py-0.5 rounded">execFile('ping', args)</code> directly with argument arrays to prevent command injection.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#079669] shrink-0 mt-0.5" />
              <span>
                <strong className="text-[#17365D]">Fixed Target & Count:</strong> Locked to target <code className="text-[#1764E8] font-mono bg-[#EBF3FF] px-1 py-0.5 rounded">8.8.8.8</code> and fixed count of 30 packets.
              </span>
            </li>
          </ul>

          <div className="pt-2 border-t border-[#EFF5FC]">
            <div className="flex items-center justify-between text-xs text-[#17365D] font-bold mb-1">
              <span>Daemon Launch Command</span>
              <button
                onClick={() => copyText(sampleRunCommand, 'run')}
                className="text-[11px] text-[#607A9B] hover:text-[#17365D] flex items-center gap-1 font-mono cursor-pointer"
              >
                {copiedSection === 'run' ? <Check className="w-3.5 h-3.5 text-[#079669]" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Copy</span>
              </button>
            </div>
            <pre className="p-3 bg-[#0F172A] rounded-xl text-[11px] font-mono text-[#38BDF8] overflow-x-auto whitespace-pre-wrap">
              {sampleRunCommand}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
