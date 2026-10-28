import React, { useState, useRef } from 'react';
import {
  type RegionId,
  type RegionPingResult,
  type PingSession,
  type SessionSummary,
} from '../types/ping';
import {
  executePingSession,
  createInitialRegionalResults,
  calculateSessionSummary,
} from '../services/pingService';
import { areRealRegionalApisConfigured } from '../services/regionalApi';
import { savePingSession } from '../services/firebaseService';
import { SummaryCards } from '../components/SummaryCards';
import { RegionCard } from '../components/RegionCard';
import { ResultsTable } from '../components/ResultsTable';
import { PacketInspectionModal } from '../components/PacketInspectionModal';
import {
  Play,
  RotateCw,
  Radio,
  ListFilter,
  Clock,
  Layers,
  AlertCircle,
  Settings,
  X,
} from 'lucide-react';

interface DashboardPageProps {
  onNavigateToApiConfig?: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  onNavigateToApiConfig,
}) => {
  const targetIp = '8.8.8.8';
  const pingCount = 30;

  // Execution state
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [regionalResults, setRegionalResults] = useState<Record<RegionId, RegionPingResult>>(
    () => createInitialRegionalResults(targetIp)
  );
  const [lastSession, setLastSession] = useState<PingSession | null>(null);
  const [apiNotice, setApiNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Packet inspection modal state
  const [inspectedRegion, setInspectedRegion] = useState<RegionPingResult | null>(null);

  // Ref to prevent duplicate test submissions
  const isExecutingRef = useRef<boolean>(false);

  const handleRunAllTests = async () => {
    if (isRunning || isExecutingRef.current) return;

    setApiNotice(null);
    setErrorMessage(null);

    isExecutingRef.current = true;
    setIsRunning(true);

    // Immediately flip all 4 regional cards to 'Running' in UI
    const runStartTime = new Date().toISOString();
    setRegionalResults(prev => ({
      'IN-DC01': { ...prev['IN-DC01'], status: 'Running', startedAt: runStartTime, errorDetails: null },
      'IN-DC02': { ...prev['IN-DC02'], status: 'Running', startedAt: runStartTime, errorDetails: null },
      'LK-DC01': { ...prev['LK-DC01'], status: 'Running', startedAt: runStartTime, errorDetails: null },
      'SG-DC01': { ...prev['SG-DC01'], status: 'Running', startedAt: runStartTime, errorDetails: null },
    }));

    try {
      const session = await executePingSession({
        userId: 'operator',
        targetIp,
        pingCount,
        onRegionProgress: (regionId, updatedResult) => {
          setRegionalResults(prev => ({
            ...prev,
            [regionId]: { ...updatedResult },
          }));
        },
      });

      setLastSession(session);
      setRegionalResults(session.regions);

      // Check if all endpoints were missing or if some failed
      const unconfiguredRegions = Object.values(session.regions).filter(
        r => r.status === 'Unavailable' || (r.errorDetails && r.errorDetails.includes('not configured'))
      );
      const failedRegions = Object.values(session.regions).filter(
        r => r.status === 'Failed'
      );

      if (unconfiguredRegions.length === 4) {
        setApiNotice(
          'Regional ping APIs are not configured yet. Connect the authorized regional servers in API Configuration to run real tests.'
        );
      } else if (unconfiguredRegions.length > 0 || failedRegions.length > 0) {
        const issues: string[] = [];
        if (unconfiguredRegions.length > 0) {
          issues.push(`${unconfiguredRegions.length} region(s) missing endpoint`);
        }
        if (failedRegions.length > 0) {
          issues.push(`${failedRegions.length} region(s) unreachable or failed`);
        }
        setErrorMessage(`Ping test completed with notices: ${issues.join(', ')}. Inspect regional cards for details.`);
      }

      // Save to Firestore only if at least one region succeeded
      const hasRealSuccess = Object.values(session.regions).some(
        r => r.status === 'Success' || r.status === 'Partial Loss'
      );
      if (hasRealSuccess) {
        try {
          await savePingSession(session);
        } catch (dbErr: any) {
          console.warn('Could not save session to Firestore:', dbErr);
        }
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to complete regional ping session.');
    } finally {
      setIsRunning(false);
      isExecutingRef.current = false;
    }
  };

  const currentSummary: SessionSummary = lastSession
    ? lastSession.summary
    : calculateSessionSummary(regionalResults);

  const formatHeaderTime = (isoString: string | null) => {
    if (!isoString) return null;
    try {
      const d = new Date(isoString);
      return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return null;
    }
  };

  const headerTimestamp = formatHeaderTime(lastSession?.completedAt || null);

  return (
    <div className="space-y-6">
      {/* Top Header matching Image 2 */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Left Side: Title, Subtitle & Metadata Pills */}
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight text-[#17365D]">
              Regional Ping Monitor
            </h2>

            {/* Target IP Pill */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E8F1FC] border border-[#D7E3F2] text-xs font-semibold text-[#17365D]">
              <Radio className="w-3.5 h-3.5 text-[#1764E8]" />
              <span>Target IP: {targetIp}</span>
            </div>

            {/* Requests Pill */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E8F1FC] border border-[#D7E3F2] text-xs font-semibold text-[#17365D]">
              <ListFilter className="w-3.5 h-3.5 text-[#1764E8]" />
              <span>Requests per region: {pingCount}</span>
            </div>
          </div>

          <p className="text-sm text-[#607A9B] mt-1 font-normal">
            Regional Network Connectivity Monitoring
          </p>
        </div>

        {/* Right Side: Last Test timestamp & Run All Button */}
        <div className="flex items-center gap-5">
          {headerTimestamp && (
            <div className="hidden sm:flex items-center gap-2 text-right">
              <Clock className="w-4 h-4 text-[#607A9B]" />
              <div className="text-xs">
                <div className="text-[#607A9B] font-medium">Last Test</div>
                <div className="text-[#17365D] font-bold font-mono">{headerTimestamp}</div>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleRunAllTests}
            disabled={isRunning}
            className="py-2.5 px-5 rounded-xl font-semibold text-sm transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer bg-[#1764E8] hover:bg-[#124A9C] text-white disabled:opacity-50 disabled:pointer-events-none active:scale-[0.99]"
          >
            {isRunning ? (
              <>
                <RotateCw className="w-4 h-4 animate-spin text-white" />
                <span>Running Tests...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current text-white" />
                <span>Run All Ping Tests</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Concise Unconfigured API Notice Banner (Dismissible) */}
      {apiNotice && (
        <div className="p-3.5 rounded-xl bg-[#E8F1FC] border border-[#BBD3F5] text-[#17365D] text-xs flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-[#1764E8] shrink-0" />
            <span className="font-medium">{apiNotice}</span>
          </div>

          <div className="flex items-center gap-2">
            {onNavigateToApiConfig && (
              <button
                type="button"
                onClick={onNavigateToApiConfig}
                className="px-2.5 py-1 rounded-lg bg-white border border-[#BBD3F5] text-[#1764E8] font-bold hover:bg-[#F7FAFF] transition-colors text-xs"
              >
                Configure APIs
              </button>
            )}
            <button
              onClick={() => setApiNotice(null)}
              className="p-1 text-[#607A9B] hover:text-[#17365D]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Five Summary Cards */}
      <SummaryCards
        summary={currentSummary}
        lastSessionTime={lastSession?.completedAt || null}
        isRunning={isRunning}
      />

      {/* Four Regional Data Center Nodes Section */}
      <div className="space-y-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#EBF3FF] flex items-center justify-center text-[#1764E8]">
            <Layers className="w-4 h-4 stroke-[2.2]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#17365D] tracking-tight leading-tight">
              Regional Data Center Nodes
            </h3>
            <p className="text-xs text-[#607A9B]">
              Live ping results from all regions
            </p>
          </div>
        </div>

        {/* 4 Cards in One Row on Desktop (Responsive Grid) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {(['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'] as RegionId[]).map(rId => (
            <RegionCard
              key={rId}
              result={regionalResults[rId]}
              totalPlannedCount={pingCount}
              onInspectPackets={res => setInspectedRegion(res)}
            />
          ))}
        </div>
      </div>

      {/* Detailed Telemetry Results Table */}
      <ResultsTable
        results={regionalResults}
        isRunning={isRunning}
        onInspectRegion={res => setInspectedRegion(res)}
      />

      {/* Packet Inspection Trace Modal */}
      {inspectedRegion && (
        <PacketInspectionModal
          result={inspectedRegion}
          onClose={() => setInspectedRegion(null)}
        />
      )}
    </div>
  );
};
