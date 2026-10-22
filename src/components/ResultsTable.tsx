import React, { useState, useMemo } from 'react';
import {
  type RegionPingResult,
  REGIONS,
  COUNTRY_CODES,
} from '../types/ping';
import { StatusBadge } from './StatusBadge';
import {
  FileSpreadsheet,
  Search,
} from 'lucide-react';

interface ResultsTableProps {
  results: Record<string, RegionPingResult>;
  isRunning: boolean;
  onInspectRegion: (result: RegionPingResult) => void;
}

type SortField = 'region' | 'status' | 'avgLatency' | 'loss';

export const ResultsTable: React.FC<ResultsTableProps> = ({
  results,
  isRunning,
  onInspectRegion,
}) => {
  const [sortField, setSortField] = useState<SortField>('region');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredAndSortedList = useMemo(() => {
    let list = Object.values(results);

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(r => {
        const meta = REGIONS[r.regionId];
        return (
          r.regionId.toLowerCase().includes(q) ||
          r.regionName.toLowerCase().includes(q) ||
          (meta && meta.location.toLowerCase().includes(q))
        );
      });
    }

    // Filter by status
    if (statusFilter !== 'all') {
      list = list.filter(r => r.status === statusFilter);
    }

    // Sort
    return list.sort((a, b) => {
      if (sortField === 'region') {
        return a.regionId.localeCompare(b.regionId);
      } else if (sortField === 'status') {
        return a.status.localeCompare(b.status);
      } else if (sortField === 'avgLatency') {
        const aVal = a.avgLatencyMs ?? 99999;
        const bVal = b.avgLatencyMs ?? 99999;
        return aVal - bVal;
      } else if (sortField === 'loss') {
        const aLoss = a.packetLossPercent ?? -1;
        const bLoss = b.packetLossPercent ?? -1;
        return aLoss - bLoss;
      }
      return 0;
    });
  }, [results, sortField, searchQuery, statusFilter]);

  const formatDuration = (ms: number | null) => {
    if (ms === null) return '—';
    if (ms < 1000) return `~ ${ms} ms`;
    return `~ ${(ms / 1000).toFixed(2)} s`;
  };

  return (
    <div className="bg-white border border-[#D7E3F2] rounded-2xl overflow-hidden shadow-xs">
      {/* Table Header & Controls Bar matching Image 2 */}
      <div className="p-5 border-b border-[#D7E3F2] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#EBF3FF] flex items-center justify-center text-[#1764E8]">
            <FileSpreadsheet className="w-4 h-4 stroke-[2.2]" />
          </div>
          <h3 className="text-base font-bold text-[#17365D]">
            Ping Test Results
          </h3>
        </div>

        {/* Toolbar matching Image 2 */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {/* Sort By Dropdown */}
          <div className="flex items-center gap-1.5 text-[#607A9B]">
            <span className="font-medium text-xs">Sort by:</span>
            <select
              value={sortField}
              onChange={e => setSortField(e.target.value as SortField)}
              className="bg-white border border-[#D7E3F2] rounded-lg px-3 py-1.5 text-xs text-[#17365D] font-medium focus:outline-none focus:border-[#1764E8] cursor-pointer"
            >
              <option value="region">Region</option>
              <option value="avgLatency">Average Latency</option>
              <option value="loss">Packet Loss</option>
              <option value="status">Status</option>
            </select>
          </div>

          {/* Status Filter Dropdown */}
          <div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-white border border-[#D7E3F2] rounded-lg px-3 py-1.5 text-xs text-[#17365D] font-medium focus:outline-none focus:border-[#1764E8] cursor-pointer"
            >
              <option value="all">All Status</option>
              <option value="Not Tested">Not Tested</option>
              <option value="Success">Success</option>
              <option value="Partial Loss">Partial Loss</option>
              <option value="Failed">Failed</option>
            </select>
          </div>

          {/* Search field */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#607A9B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search regions..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-lg border border-[#D7E3F2] bg-white text-xs text-[#17365D] placeholder-[#607A9B] focus:outline-none focus:border-[#1764E8] w-40 sm:w-48"
            />
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F8FAFC] text-[#607A9B] border-b border-[#D7E3F2] text-[11px] font-semibold tracking-wider select-none">
            <tr>
              <th className="py-3.5 px-4">Region</th>
              <th className="py-3.5 px-4 font-mono">Target IP</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-3 text-center">Requests Sent</th>
              <th className="py-3.5 px-3 text-center">Successful Replies</th>
              <th className="py-3.5 px-3 text-center">Failed Requests</th>
              <th className="py-3.5 px-3 text-center">Packet Loss</th>
              <th className="py-3.5 px-3 text-center">Min Latency</th>
              <th className="py-3.5 px-3 text-center">Avg Latency</th>
              <th className="py-3.5 px-3 text-center">Max Latency</th>
              <th className="py-3.5 px-4 text-center">Duration</th>
              <th className="py-3.5 px-4 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EBF2FA]">
            {filteredAndSortedList.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-8 text-center text-[#607A9B]">
                  No regions match the selected filter.
                </td>
              </tr>
            ) : (
              filteredAndSortedList.map(res => {
                return (
                  <tr
                    key={res.regionId}
                    className="hover:bg-[#F8FAFD] transition-colors"
                  >
                    <td className="py-3.5 px-4 font-bold text-[#17365D]">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 font-bold text-xs select-none ${
                            (COUNTRY_CODES[res.regionId] || 'IN') === 'IN'
                              ? 'bg-[#EFF5FC] text-[#1764E8] border-[#D7E3F2]'
                              : (COUNTRY_CODES[res.regionId] || 'IN') === 'SL'
                              ? 'bg-[#F0FDFA] text-[#0D9488] border-[#CCFBF1]'
                              : 'bg-[#EEF2FF] text-[#4F46E5] border-[#E0E7FF]'
                          }`}
                          title={REGIONS[res.regionId]?.country}
                        >
                          {COUNTRY_CODES[res.regionId] || 'IN'}
                        </span>
                        <span>{res.regionId}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-[#17365D] font-mono">
                      {res.targetIp || '8.8.8.8'}
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={res.status} size="sm" />
                    </td>
                    <td className="py-3.5 px-3 text-center text-[#17365D] font-mono font-medium">
                      {res.requestsSent !== null ? res.requestsSent : '—'}
                    </td>
                    <td className="py-3.5 px-3 text-center font-mono font-semibold text-[#079669]">
                      {res.successfulReplies !== null ? res.successfulReplies : '—'}
                    </td>
                    <td
                      className={`py-3.5 px-3 text-center font-mono font-semibold ${
                        res.failedRequests !== null && res.failedRequests > 0 ? 'text-[#D93652]' : 'text-[#607A9B]'
                      }`}
                    >
                      {res.failedRequests !== null ? res.failedRequests : '—'}
                    </td>
                    <td className="py-3.5 px-3 text-center font-mono font-medium">
                      <span
                        className={
                          res.packetLossPercent !== null
                            ? res.packetLossPercent > 0
                              ? 'text-[#E99500] font-bold'
                              : 'text-[#079669] font-medium'
                            : 'text-[#607A9B]'
                        }
                      >
                        {res.packetLossPercent !== null ? `${res.packetLossPercent}%` : '—'}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-center text-[#17365D] font-mono">
                      {res.minLatencyMs !== null ? `${res.minLatencyMs} ms` : '—'}
                    </td>
                    <td className="py-3.5 px-3 text-center font-mono font-bold text-[#1764E8]">
                      {res.avgLatencyMs !== null ? `${res.avgLatencyMs} ms` : '—'}
                    </td>
                    <td className="py-3.5 px-3 text-center text-[#17365D] font-mono">
                      {res.maxLatencyMs !== null ? `${res.maxLatencyMs} ms` : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-center text-[#607A9B] font-mono">
                      {formatDuration(res.durationMs)}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <button
                        onClick={() => onInspectRegion(res)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1764E8] hover:bg-[#124A9C] text-white text-xs font-medium transition-colors shadow-2xs cursor-pointer"
                        title="View details"
                      >
                        <span>View Details</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
