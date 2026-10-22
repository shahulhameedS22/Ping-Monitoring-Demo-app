import React from 'react';
import { type PingStatus } from '../types/ping';
import { Check, AlertTriangle, X, PlayCircle, Clock } from 'lucide-react';

interface StatusBadgeProps {
  status: PingStatus;
  size?: 'sm' | 'md' | 'lg';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const getBadgeConfig = () => {
    switch (status) {
      case 'Success':
        return {
          bg: 'bg-[#E6F8F3] text-[#079669]',
          icon: Check,
          label: 'Success',
        };
      case 'Partial Loss':
        return {
          bg: 'bg-[#FEF5E7] text-[#E99500]',
          icon: AlertTriangle,
          label: 'Partial Loss',
        };
      case 'Failed':
        return {
          bg: 'bg-[#FDECEC] text-[#D93652]',
          icon: X,
          label: 'Failed',
        };
      case 'Unavailable':
        return {
          bg: 'bg-[#F1F5F9] text-[#607A9B]',
          icon: Clock,
          label: 'Unavailable',
        };
      case 'Running':
        return {
          bg: 'bg-[#E5F0FF] text-[#1764E8]',
          icon: PlayCircle,
          label: 'Running',
        };
      case 'Not Tested':
      default:
        return {
          bg: 'bg-[#EDF2F7] text-[#607A9B]',
          icon: Clock,
          label: 'Not Tested',
        };
    }
  };

  const config = getBadgeConfig();
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-[11px] px-2.5 py-0.5 gap-1 font-semibold',
    md: 'text-xs px-3 py-1 gap-1.5 font-semibold',
    lg: 'text-sm px-3.5 py-1.5 gap-2 font-bold',
  }[size];

  return (
    <span
      className={`inline-flex items-center rounded-full tracking-wide select-none ${config.bg} ${sizeClasses}`}
    >
      <Icon className={size === 'sm' ? 'w-3 h-3 stroke-[2.5]' : 'w-3.5 h-3.5 stroke-[2.5]'} />
      <span>{config.label}</span>
    </span>
  );
};
