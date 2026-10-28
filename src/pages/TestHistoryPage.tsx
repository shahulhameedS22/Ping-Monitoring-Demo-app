import React, { useState, useEffect } from 'react';
import { type PingSession } from '../types/ping';
import { getRecentPingSessions } from '../services/firebaseService';
import { StatusBadge } from '../components/StatusBadge';
import { SessionDetailModal } from '../components/SessionDetailModal';
import {
  History,
  RotateCw,
  Search,
  Filter,
  Calendar,
  ExternalLink,
  Radio,
  Clock,
  AlertCircle,
  Inbox,
} from 'lucide-react';

export const TestHistoryPage: React.FC = () => {
  const [sessions, setSessions] = useState<PingSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('all');

  // Selected session for detail modal
  const [selectedSession, setSelectedSession] = useState<PingSession | null>(null);

  const fetchHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRecentPingSessions({
        limitCount: 50,
      });
      // Filter out any simulated records to guarantee only genuine tests appear
      const realOnly = data.filter(s => !s.isSimulated);
      setSessions(realOnly);
    } catch (err: any) {
      setError(err?.message || 'Failed to load test history from Firestore.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const filteredSessions = sessions.filter(session => {
    if (statusFilter !== 'all' && session.status !== statusFilter) {
      return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchId = session.id.toLowerCase().includes(q);
      const matchIp = session.targetIp.toLowerCase().includes(q);
      if (!matchId && !matchIp) return false;
    }

    if (dateFilter !== 'all') {
      const sessionDate = new Date(session.startedAt);
      const now = new Date();
      if (dateFilter === 'today') {
        const isToday = sessionDate.toDateString() === now.toDateString();
        if (!isToday) return false;
      } else if (dateFilter === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        if (sessionDate < weekAgo) return false;
      }
    }

    return true;
  });

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString([], {
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

  const mapSessionBadgeStatus = (status: string) => {
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
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="bg-white border border-[#D7E3F2] rounded-2xl p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#EBF3FF] flex items-center justify-center text-[#1764E8]">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#17365D] flex items-center gap-2">
                Test Session History
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#EFF5FC] border border-[#D7E3F2] text-[#17365D] font-sans font-medium">
                  {filteredSessions.length} records
                </span>
              </h2>
              <p className="text-xs text-[#607A9B]">
                Audit log of all regional ping executions stored in Cloud Firestore
              </p>
            </div>
          </div>

          <button
            onClick={fetchHistory}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#D7E3F2] hover:bg-[#EFF5FC] text-[#17365D] text-xs font-medium transition-colors self-start sm:self-auto cursor-pointer shadow-xs"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#1764E8]' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Filters Row */}
        <div className="mt-5 pt-4 border-t border-[#D7E3F2]/60 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-xs">
          {/* Search box */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#607A9B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter by Session ID or IP..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-[#F8FAFC] border border-[#D7E3F2] rounded-lg text-[#17365D] placeholder-[#607A9B] focus:outline-none focus:border-[#1764E8] font-mono text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter */}
            <div className="flex items-center gap-1.5 bg-[#F8FAFC] px-2.5 py-1.5 rounded-lg border border-[#D7E3F2]">
              <Filter className="w-3.5 h-3.5 text-[#607A9B]" />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-transparent text-[#17365D] text-xs focus:outline-none font-medium cursor-pointer"
              >
                <option value="all">All Statuses</option>
                <option value="success">Success Only</option>
                <option value="partial_loss">Partial Loss</option>
                <option value="failed">Failed Only</option>
              </select>
            </div>

            {/* Date Filter */}
            <div className="flex items-center gap-1.5 bg-[#F8FAFC] px-2.5 py-1.5 rounded-lg border border-[#D7E3F2]">
              <Calendar className="w-3.5 h-3.5 text-[#607A9B]" />
              <select
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
                className="bg-transparent text-[#17365D] text-xs focus:outline-none font-medium cursor-pointer"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">Past 7 Days</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Error alert if any */}
      {error && (
        <div className="p-4 rounded-xl bg-[#FDECEC] border border-[#F8B4B4] text-[#D93652] text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-[#D93652] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Sessions List */}
      {loading ? (
        <div className="bg-white border border-[#D7E3F2] rounded-2xl p-12 text-center text-[#607A9B] shadow-xs">
          <RotateCw className="w-8 h-8 mx-auto animate-spin text-[#1764E8] mb-3" />
          <p className="font-mono text-sm text-[#17365D] font-medium">Checking Firestore Session History...</p>
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="bg-white border border-[#D7E3F2] rounded-2xl p-12 text-center text-[#607A9B] shadow-xs">
          <Inbox className="w-10 h-10 mx-auto text-[#607A9B]/60 mb-3" />
          <p className="font-semibold text-[#17365D] text-base">No test history available</p>
          <p className="text-xs text-[#607A9B] mt-1 max-w-md mx-auto">
            Genuine test sessions will be recorded in Cloud Firestore once the authorized regional ping APIs are connected and executed.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSessions.map(session => (
            <div
              key={session.id}
              onClick={() => setSelectedSession(session)}
              className="bg-white hover:bg-[#F8FAFD] border border-[#D7E3F2] hover:border-[#1764E8]/40 rounded-2xl p-4 sm:p-5 transition-all shadow-xs cursor-pointer flex flex-col lg:flex-row lg:items-center justify-between gap-4"
            >
              {/* Left Column: ID, Time, Target */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-xs text-[#17365D] bg-[#EFF5FC] px-2 py-0.5 rounded border border-[#D7E3F2]">
                    {session.id}
                  </span>
                  <StatusBadge status={mapSessionBadgeStatus(session.status)} size="sm" />
                </div>

                <div className="flex items-center gap-4 text-xs text-[#607A9B] font-mono">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-[#607A9B]" />
                    {formatDate(session.startedAt)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Radio className="w-3.5 h-3.5 text-[#1764E8]" />
                    {session.targetIp} ({session.pingCount} pkts)
                  </span>
                </div>
              </div>

              {/* Middle Column: Regional Mini Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                {Object.values(session.regions || {}).map(r => (
                  <div
                    key={r.regionId}
                    className="p-2 rounded-lg bg-[#EFF5FC] border border-[#D7E3F2] flex flex-col"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#17365D] font-bold">{r.regionId}</span>
                      <span
                        className={
                          r.status === 'Success'
                            ? 'text-[#079669] font-semibold'
                            : r.status === 'Partial Loss'
                            ? 'text-[#E99500] font-semibold'
                            : 'text-[#D93652] font-semibold'
                        }
                      >
                        {r.avgLatencyMs !== null ? `${r.avgLatencyMs}ms` : 'FAIL'}
                      </span>
                    </div>
                    <span className="text-[10px] text-[#607A9B] mt-0.5">
                      Loss: {r.packetLossPercent !== null ? `${r.packetLossPercent}%` : '—'}
                    </span>
                  </div>
                ))}
              </div>

              {/* Right Column: Inspect Action */}
              <div className="flex items-center justify-between lg:justify-end gap-3 pt-3 lg:pt-0 border-t lg:border-t-0 border-[#D7E3F2]/60">
                <button
                  type="button"
                  onClick={() => setSelectedSession(session)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1764E8] hover:bg-[#124A9C] text-white text-xs font-medium transition-colors shadow-2xs cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>View Details</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Session Detail Modal */}
      {selectedSession && (
        <SessionDetailModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  );
};
