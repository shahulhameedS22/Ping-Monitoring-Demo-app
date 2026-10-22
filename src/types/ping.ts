/**
 * Regional Ping Monitor - Data Type Definitions
 */

export type RegionId = 'IN-DC01' | 'IN-DC02' | 'LK-DC01' | 'SG-DC01';

export type PingStatus = 
  | 'Not Tested'
  | 'Running'
  | 'Success'
  | 'Partial Loss'
  | 'Failed'
  | 'Unavailable';

export interface RegionMetadata {
  id: RegionId;
  name: string;
  fullName: string;
  code: string;
  countryCode: 'IN' | 'SL' | 'SG';
  location: string;
  country: string;
  coordinates: string;
  provider: string;
  accentColor: string;
  flagUrl?: string;
  flagAlt?: string;
}

export interface PingPacket {
  sequence: number;
  success: boolean;
  latencyMs: number | null;
  ttl?: number;
  timestamp: string;
}

export interface RegionPingResult {
  regionId: RegionId;
  regionName: string;
  targetIp: string;
  status: PingStatus;
  requestsSent: number | null;
  successfulReplies: number | null;
  failedRequests: number | null;
  packetLossPercent: number | null;
  minLatencyMs: number | null;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  jitterMs: number | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  errorDetails?: string | null;
  packets?: PingPacket[];
}

export interface SessionSummary {
  totalRegions: number;
  successfulRegions: number | null;
  partialLossRegions: number | null;
  failedOrUnavailableRegions: number | null;
  overallAvgLatencyMs: number | null;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
}

export interface PingSession {
  id: string;
  userId?: string;
  userEmail?: string;
  targetIp: string;
  pingCount: number;
  status: 'running' | 'success' | 'partial_loss' | 'failed' | 'not_tested';
  isSimulated: boolean;
  startedAt: string;
  completedAt?: string;
  createdAt?: string;
  summary: SessionSummary;
  regions: Record<RegionId, RegionPingResult>;
}

export const COUNTRY_CODES: Record<RegionId, 'IN' | 'SL' | 'SG'> = {
  'IN-DC01': 'IN',
  'IN-DC02': 'IN',
  'LK-DC01': 'SL',
  'SG-DC01': 'SG',
};

export const REGIONS: Record<RegionId, RegionMetadata> = {
  'IN-DC01': {
    id: 'IN-DC01',
    name: 'IN-DC01',
    fullName: 'Primary Data Center',
    code: 'IN-DC01',
    countryCode: 'IN',
    location: 'Mumbai, Maharashtra',
    country: 'India',
    coordinates: '19.0760° N, 72.8777° E',
    provider: 'CtrlS / Equinix MB1',
    accentColor: '#1764E8', // Primary Blue
  },
  'IN-DC02': {
    id: 'IN-DC02',
    name: 'IN-DC02',
    fullName: 'Secondary Data Center',
    code: 'IN-DC02',
    countryCode: 'IN',
    location: 'Chennai, Tamil Nadu',
    country: 'India',
    coordinates: '13.0827° N, 80.2707° E',
    provider: 'AdaniConneX / Sify',
    accentColor: '#0284C7', // Cyan-blue
  },
  'LK-DC01': {
    id: 'LK-DC01',
    name: 'LK-DC01',
    fullName: 'Sri Lanka Data Center',
    code: 'LK-DC01',
    countryCode: 'SL',
    location: 'Colombo, Western Province',
    country: 'Sri Lanka',
    coordinates: '6.9271° N, 79.8612° E',
    provider: 'SLT-MOBITEL Tier III',
    accentColor: '#0D9488', // Teal
  },
  'SG-DC01': {
    id: 'SG-DC01',
    name: 'SG-DC01',
    fullName: 'Regional Hub',
    code: 'SG-DC01',
    countryCode: 'SG',
    location: 'Jurong West, Singapore',
    country: 'Singapore',
    coordinates: '1.3521° N, 103.8198° E',
    provider: 'Equinix SG2 / Singtel',
    accentColor: '#4F46E5', // Indigo-blue
  },
};
