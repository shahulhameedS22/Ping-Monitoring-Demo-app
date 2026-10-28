import React from 'react';
import { type RegionPingResult, REGIONS, COUNTRY_CODES } from '../types/ping';
import { StatusBadge } from './StatusBadge';
import { X, Terminal, Radio, Server, Clock, AlertCircle } from 'lucide-react';

interface PacketInspectionModalProps {
  result: RegionPingResult | null;
  onClose: () => void;
}

export const PacketInspectionModal: React.FC<PacketInspectionModalProps> = ({
  result,
  onClose,
}) => {
  if (!result) return null;
  const meta = REGIONS[result.regionId];
  const hasRealPackets = result.packets && result.packets.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 font-bold text-xs select-none ${
                    (COUNTRY_CODES[result.regionId] || 'IN') === 'IN'
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : (COUNTRY_CODES[result.regionId] || 'IN') === 'SL'
                      ? 'bg-teal-50 text-teal-700 border-teal-200'
                      : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  }`}
                >
                  {COUNTRY_CODES[result.regionId] || 'IN'}
                </span>
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  {result.regionId}
                </span>
                <h3 className="font-bold text-slate-900 text-base">
                  {meta.fullName} — Regional Node Diagnostics
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {meta.location} • {meta.provider}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <StatusBadge status={result.status} size="sm" />
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Diagnostic Overview */}
        <div className="p-5 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-slate-500 font-medium">Target IP</span>
              <div className="text-slate-900 font-bold font-mono mt-1 text-sm">{result.targetIp || '8.8.8.8'}</div>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-slate-500 font-medium">Requests Sent</span>
              <div className="text-slate-900 font-bold font-mono mt-1 text-sm">{result.requestsSent !== null ? result.requestsSent : '—'}</div>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-slate-500 font-medium">Packet Loss</span>
              <div className="text-slate-900 font-bold font-mono mt-1 text-sm">{result.packetLossPercent !== null ? `${result.packetLossPercent}%` : '—'}</div>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-slate-500 font-medium">Average Latency</span>
              <div className="text-blue-700 font-bold font-mono mt-1 text-sm">{result.avgLatencyMs !== null ? `${result.avgLatencyMs}ms` : '—'}</div>
            </div>
          </div>

          {/* Packet Stream or Clean Standby Message */}
          {hasRealPackets ? (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 text-xs font-semibold text-slate-700">
                Captured ICMP Packets
              </div>
              <div className="p-4 bg-slate-900 font-mono text-xs text-slate-200 max-h-60 overflow-y-auto space-y-1">
                {result.packets!.map(p => (
                  <div key={p.sequence} className="flex justify-between">
                    <span>Seq={p.sequence} {p.success ? `bytes=32 time=${p.latencyMs}ms TTL=${p.ttl || 117}` : 'Request timed out'}</span>
                    <span className="text-slate-500">{p.timestamp}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50 text-slate-500">
              <Radio className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="font-semibold text-slate-700 text-sm">No Packet Telemetry Captured</p>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Detailed packet reply telemetry will appear here after executing tests through the authorized regional daemon for {meta.name}.
              </p>
            </div>
          )}

          {result.errorDetails && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span className="font-mono">{result.errorDetails}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>Target Architecture: Authorized regional server process isolation.</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
