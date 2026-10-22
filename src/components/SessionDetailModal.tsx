import React from 'react';
import { type PingSession, REGIONS, COUNTRY_CODES } from '../types/ping';
import { StatusBadge } from './StatusBadge';
import {
  X,
  History,
  Calendar,
  Radio,
  Server,
  Layers,
} from 'lucide-react';

interface SessionDetailModalProps {
  session: PingSession | null;
  onClose: () => void;
}

export const SessionDetailModal: React.FC<SessionDetailModalProps> = ({
  session,
  onClose,
}) => {
  if (!session) return null;

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const getSessionBadgeStatus = (status: string) => {
    switch (status) {
      case 'success':
        return 'Success';
      case 'partial_loss':
        return 'Partial Loss';
      case 'failed':
        return 'Failed';
      case 'running':
        return 'Running';
      default:
        return 'Not Tested';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base">
                  Test Session Details
                </h3>
              </div>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                ID: {session.id}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <StatusBadge status={getSessionBadgeStatus(session.status)} />
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Overview Bar */}
        <div className="p-4 bg-white border-b border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-slate-500 flex items-center gap-1 font-medium">
              <Calendar className="w-3.5 h-3.5 text-slate-400" /> Started:
            </span>
            <span className="text-slate-800 font-mono font-semibold mt-1 block">
              {formatDate(session.startedAt)}
            </span>
          </div>

          <div>
            <span className="text-slate-500 flex items-center gap-1 font-medium">
              <Radio className="w-3.5 h-3.5 text-blue-600" /> Target IP:
            </span>
            <span className="text-slate-800 font-mono font-semibold mt-1 block">
              {session.targetIp} ({session.pingCount} pkts)
            </span>
          </div>

          <div>
            <span className="text-slate-500 flex items-center gap-1 font-medium">
              <Layers className="w-3.5 h-3.5 text-slate-400" /> Regions Tested:
            </span>
            <span className="text-slate-800 font-mono font-semibold mt-1 block">
              {session.summary?.totalRegions || 4} Regional DCs
            </span>
          </div>

          <div>
            <span className="text-slate-500 flex items-center gap-1 font-medium">
              <Server className="w-3.5 h-3.5 text-blue-600" /> Overall Avg:
            </span>
            <span className="text-blue-700 font-mono font-bold mt-1 block">
              {session.summary?.overallAvgLatencyMs !== null
                ? `${session.summary?.overallAvgLatencyMs} ms`
                : '—'}
            </span>
          </div>
        </div>

        {/* Regional Breakdown Grid */}
        <div className="p-5 overflow-y-auto space-y-4 bg-slate-50/50">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
            Regional Data Center Results
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.values(session.regions || {}).map(res => {
              const meta = REGIONS[res.regionId];
              return (
                <div
                  key={res.regionId}
                  className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 font-bold text-[11px] select-none ${
                            (COUNTRY_CODES[res.regionId] || 'IN') === 'IN'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : (COUNTRY_CODES[res.regionId] || 'IN') === 'SL'
                              ? 'bg-teal-50 text-teal-700 border-teal-200'
                              : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          }`}
                        >
                          {COUNTRY_CODES[res.regionId] || 'IN'}
                        </span>
                        <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-800">
                          {res.regionId}
                        </span>
                        <span className="font-semibold text-slate-900 text-sm">
                          {meta ? meta.name : res.regionName}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">{meta?.location}</span>
                    </div>
                    <StatusBadge status={res.status} size="sm" />
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded bg-slate-50 border border-slate-200/80 font-mono text-center text-xs">
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase font-sans">Min</div>
                      <div className="text-slate-800 font-semibold">
                        {res.minLatencyMs !== null ? `${res.minLatencyMs}ms` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-blue-600 uppercase font-sans font-bold">Avg</div>
                      <div className="text-blue-700 font-bold">
                        {res.avgLatencyMs !== null ? `${res.avgLatencyMs}ms` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase font-sans">Max</div>
                      <div className="text-slate-800 font-semibold">
                        {res.maxLatencyMs !== null ? `${res.maxLatencyMs}ms` : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono text-slate-600 pt-1">
                    <span>Replies: <strong className="text-emerald-600">{res.successfulReplies !== null ? res.successfulReplies : '—'}</strong> / {res.requestsSent !== null ? res.requestsSent : '—'}</span>
                    <span>Loss: <strong className={res.packetLossPercent !== null && res.packetLossPercent > 0 ? 'text-amber-600' : 'text-slate-700'}>{res.packetLossPercent !== null ? `${res.packetLossPercent}%` : '—'}</strong></span>
                    <span>Jitter: {res.jitterMs !== null ? `${res.jitterMs}ms` : '—'}</span>
                  </div>

                  {res.errorDetails && (
                    <div className="p-2.5 rounded bg-rose-50 border border-rose-200 text-rose-800 text-xs font-mono">
                      {res.errorDetails}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-white border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-medium transition-colors"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
};
