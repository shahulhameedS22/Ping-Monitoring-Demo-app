import React from 'react';
import { type SessionSummary } from '../types/ping';
import {
  Globe,
  Check,
  AlertTriangle,
  X,
  Clock,
  RotateCw,
} from 'lucide-react';

interface SummaryCardsProps {
  summary: SessionSummary | null;
  lastSessionTime: string | null;
  isRunning: boolean;
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({
  summary,
  lastSessionTime,
  isRunning,
}) => {
  const formatTimeParts = (isoString: string | null) => {
    if (!isoString) return { time: 'No test yet', date: '' };
    try {
      const d = new Date(isoString);
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const date = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      return { time, date };
    } catch {
      return { time: 'No test yet', date: '' };
    }
  };

  const hasRealResults = summary !== null && (
    summary.successfulRegions !== null ||
    summary.partialLossRegions !== null ||
    summary.failedOrUnavailableRegions !== null
  );

  const { time, date } = formatTimeParts(lastSessionTime);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      {/* 1. Total Regions */}
      <div className="bg-white border border-[#D7E3F2] rounded-2xl p-5 shadow-xs flex items-center gap-4 transition-all hover:border-[#1764E8]/40">
        <div className="w-12 h-12 rounded-full bg-[#EBF3FF] flex items-center justify-center text-[#1764E8] shrink-0">
          <Globe className="w-6 h-6 stroke-[2]" />
        </div>
        <div>
          <span className="text-xs font-semibold text-[#607A9B] uppercase tracking-wider block">
            Total Regions
          </span>
          <span className="text-2xl font-bold font-mono text-[#17365D] mt-0.5 block leading-none">
            {summary?.totalRegions ?? 4}
          </span>
        </div>
      </div>

      {/* 2. Successful */}
      <div className="bg-white border border-[#D7E3F2] rounded-2xl p-5 shadow-xs flex items-center justify-between gap-3 transition-all hover:border-[#079669]/40">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#E7F8F2] flex items-center justify-center text-[#079669] shrink-0">
            <Check className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <span className="text-xs font-semibold text-[#607A9B] uppercase tracking-wider block">
              Successful
            </span>
            <span className="text-2xl font-bold font-mono text-[#079669] mt-0.5 block leading-none">
              {hasRealResults && summary?.successfulRegions !== null ? summary.successfulRegions : '—'}
            </span>
          </div>
        </div>
        {hasRealResults && summary?.successfulRegions !== null && (
          <span className="text-xs font-medium text-[#607A9B] self-end mb-1">
            {Math.round((summary.successfulRegions / 4) * 100)}%
          </span>
        )}
      </div>

      {/* 3. Partial Loss */}
      <div className="bg-white border border-[#D7E3F2] rounded-2xl p-5 shadow-xs flex items-center justify-between gap-3 transition-all hover:border-[#E99500]/40">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#FEF5E7] flex items-center justify-center text-[#E99500] shrink-0">
            <AlertTriangle className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <span className="text-xs font-semibold text-[#607A9B] uppercase tracking-wider block">
              Partial Loss
            </span>
            <span className="text-2xl font-bold font-mono text-[#E99500] mt-0.5 block leading-none">
              {hasRealResults && summary?.partialLossRegions !== null ? summary.partialLossRegions : '—'}
            </span>
          </div>
        </div>
        {hasRealResults && summary?.partialLossRegions !== null && (
          <span className="text-xs font-medium text-[#607A9B] self-end mb-1">
            {Math.round((summary.partialLossRegions / 4) * 100)}%
          </span>
        )}
      </div>

      {/* 4. Failed / Down */}
      <div className="bg-white border border-[#D7E3F2] rounded-2xl p-5 shadow-xs flex items-center justify-between gap-3 transition-all hover:border-[#D93652]/40">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#FDECEC] flex items-center justify-center text-[#D93652] shrink-0">
            <X className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <span className="text-xs font-semibold text-[#607A9B] uppercase tracking-wider block">
              Failed / Down
            </span>
            <span className="text-2xl font-bold font-mono text-[#D93652] mt-0.5 block leading-none">
              {hasRealResults && summary?.failedOrUnavailableRegions !== null ? summary.failedOrUnavailableRegions : '—'}
            </span>
          </div>
        </div>
        {hasRealResults && summary?.failedOrUnavailableRegions !== null && (
          <span className="text-xs font-medium text-[#607A9B] self-end mb-1">
            {Math.round((summary.failedOrUnavailableRegions / 4) * 100)}%
          </span>
        )}
      </div>

      {/* 5. Last Test Session */}
      <div className="col-span-2 lg:col-span-1 bg-white border border-[#D7E3F2] rounded-2xl p-5 shadow-xs flex items-center gap-4 transition-all hover:border-[#1764E8]/40">
        <div className="w-12 h-12 rounded-full bg-[#ECEEFE] flex items-center justify-center text-[#5B63F6] shrink-0">
          {isRunning ? (
            <RotateCw className="w-6 h-6 animate-spin text-[#1764E8]" />
          ) : (
            <Clock className="w-6 h-6 stroke-[2]" />
          )}
        </div>
        <div className="min-w-0">
          <span className="text-xs font-semibold text-[#607A9B] uppercase tracking-wider block truncate">
            Last Test Session
          </span>
          <span className="text-base font-bold font-mono text-[#17365D] mt-0.5 block truncate leading-tight">
            {isRunning ? 'Running...' : time}
          </span>
          {date && (
            <span className="text-[11px] text-[#607A9B] block truncate mt-0.5">
              {date}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
