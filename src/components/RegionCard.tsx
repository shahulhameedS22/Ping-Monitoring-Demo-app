import React from 'react';
import {
  type RegionPingResult,
  REGIONS,
  COUNTRY_CODES,
} from '../types/ping';
import { StatusBadge } from './StatusBadge';
import {
  MapPin,
  Clock,
  Server,
  Loader2,
} from 'lucide-react';

interface RegionCardProps {
  result: RegionPingResult;
  totalPlannedCount: number;
  onInspectPackets?: (result: RegionPingResult) => void;
}

export const RegionCard: React.FC<RegionCardProps> = ({
  result,
  totalPlannedCount,
  onInspectPackets,
}) => {
  const meta = REGIONS[result.regionId];
  const isRunning = result.status === 'Running';
  const hasResults = result.requestsSent !== null && result.requestsSent > 0;

  const formatLatency = (val: number | null) => {
    return val !== null ? `${val} ms` : '—';
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null) return '—';
    if (ms < 1000) return `~ ${ms} ms`;
    return `~ ${(ms / 1000).toFixed(2)} s`;
  };

  // Top border accent color based on region
  const topBorderClass = {
    'IN-DC01': 'border-t-4 border-t-[#1764E8]',
    'IN-DC02': 'border-t-4 border-t-[#0284C7]',
    'LK-DC01': 'border-t-4 border-t-[#0D9488]',
    'SG-DC01': 'border-t-4 border-t-[#4F46E5]',
  }[result.regionId] || 'border-t-4 border-t-[#1764E8]';

  // Calculate delivery percentage for bottom progress bar
  const deliveryPercent = hasResults && result.requestsSent && result.requestsSent > 0
    ? Math.max(0, Math.min(100, Math.round(((result.successfulReplies ?? 0) / result.requestsSent) * 100)))
    : 0;

  const countryCode = COUNTRY_CODES[result.regionId] || meta?.countryCode || 'IN';

  const countryBadgeClass = {
    'IN': 'bg-[#EFF5FC] text-[#1764E8] border-[#D7E3F2]',
    'SL': 'bg-[#F0FDFA] text-[#0D9488] border-[#CCFBF1]',
    'SG': 'bg-[#EEF2FF] text-[#4F46E5] border-[#E0E7FF]',
  }[countryCode] || 'bg-[#EFF5FC] text-[#1764E8] border-[#D7E3F2]';

  return (
    <div
      className={`bg-white rounded-2xl border border-[#D7E3F2] shadow-xs flex flex-col justify-between overflow-hidden transition-all hover:shadow-sm ${topBorderClass}`}
    >
      <div className="p-5">
        {/* Top Header: Country Code Badge & Region Code, Full Name, Location & Status */}
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0">
            {/* Circular Container with Country Code: IN / SL / SG */}
            <div
              className={`w-[42px] h-[42px] rounded-full border flex items-center justify-center shrink-0 shadow-2xs font-extrabold text-sm tracking-wide select-none ${countryBadgeClass}`}
            >
              {countryCode}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-[#17365D] text-base leading-tight truncate">
                  {meta.name}
                </h3>
              </div>
              <div className="text-xs text-[#607A9B] font-medium leading-tight mt-0.5 truncate">
                {meta.fullName}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-[#607A9B] mt-1 truncate">
                <MapPin className="w-3 h-3 text-[#1764E8] shrink-0" />
                <span className="truncate">{meta.location}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
            {isRunning && <Loader2 className="w-4 h-4 text-[#1764E8] animate-spin" />}
            <StatusBadge status={result.status} size="sm" />
          </div>
        </div>

        {/* Target IP and Requests Count Row */}
        <div className="mt-4 pt-3 border-t border-[#EFF5FC] flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-1.5 text-[#17365D]">
            <Server className="w-3.5 h-3.5 text-[#1764E8]" />
            <span className="text-[#607A9B] font-sans">Target IP:</span>
            <span className="font-bold">{result.targetIp || '8.8.8.8'}</span>
          </div>
          <div className="flex items-center gap-1 text-[#17365D]">
            <span className="text-[#607A9B] font-sans">Requests:</span>
            <span className="font-bold">{totalPlannedCount || 30}</span>
          </div>
        </div>

        {/* Ping Statistics Grid (3 Columns) */}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center pt-1 border-t border-[#EFF5FC]">
          <div>
            <div className="text-[11px] font-medium text-[#607A9B]">Successful</div>
            <div className={`text-base font-bold font-mono mt-1 ${result.successfulReplies !== null ? 'text-[#079669]' : 'text-[#607A9B]'}`}>
              {result.successfulReplies !== null ? result.successfulReplies : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-[#607A9B]">Failed</div>
            <div className={`text-base font-bold font-mono mt-1 ${result.failedRequests !== null && result.failedRequests > 0 ? 'text-[#D93652]' : 'text-[#607A9B]'}`}>
              {result.failedRequests !== null ? result.failedRequests : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-[#607A9B]">Packet Loss</div>
            <div className={`text-base font-bold font-mono mt-1 ${result.packetLossPercent !== null ? (result.packetLossPercent > 0 ? 'text-[#E99500]' : 'text-[#079669]') : 'text-[#607A9B]'}`}>
              {result.packetLossPercent !== null ? `${result.packetLossPercent}%` : '—'}
            </div>
          </div>
        </div>

        {/* Latency Statistics Grid (3 Columns) */}
        <div className="mt-3.5 grid grid-cols-3 gap-2 text-center pt-2.5 border-t border-[#EFF5FC]">
          <div>
            <div className="text-[11px] font-medium text-[#607A9B]">Min Latency</div>
            <div className="text-xs font-bold font-mono text-[#17365D] mt-1">
              {formatLatency(result.minLatencyMs)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-[#607A9B]">Avg Latency</div>
            <div className={`text-sm font-extrabold font-mono mt-0.5 ${result.avgLatencyMs !== null ? 'text-[#1764E8]' : 'text-[#607A9B]'}`}>
              {formatLatency(result.avgLatencyMs)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-[#607A9B]">Max Latency</div>
            <div className="text-xs font-bold font-mono text-[#17365D] mt-1">
              {formatLatency(result.maxLatencyMs)}
            </div>
          </div>
        </div>

        {/* Test Duration Footer Row */}
        <div className="mt-4 pt-2.5 border-t border-[#EFF5FC] flex items-center justify-between text-[11px] text-[#607A9B]">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-[#607A9B]" />
            <span>Test Duration</span>
          </div>
          <span className="font-mono font-medium text-[#17365D]">
            {formatDuration(result.durationMs)}
          </span>
        </div>
      </div>

      {/* Thin colored progress bar at bottom of card */}
      <div className="w-full bg-[#E2E8F0] h-1.5 overflow-hidden">
        {hasResults ? (
          <div
            className="h-full bg-[#079669] transition-all duration-300"
            style={{ width: `${deliveryPercent}%` }}
          />
        ) : (
          <div className="h-full bg-[#CBD5E1] w-0" />
        )}
      </div>
    </div>
  );
};
