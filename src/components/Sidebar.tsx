import React from 'react';
import {
  Activity,
  History,
  LayoutDashboard,
  Settings,
  Radio,
  Menu,
  X,
} from 'lucide-react';

export type NavTab = 'dashboard' | 'history' | 'api-config';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  mobileOpen: boolean;
  onToggleMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  mobileOpen,
  onToggleMobile,
}) => {
  const navItems = [
    {
      id: 'dashboard' as NavTab,
      label: 'Dashboard',
      icon: LayoutDashboard,
    },
    {
      id: 'history' as NavTab,
      label: 'Test History',
      icon: History,
    },
    {
      id: 'api-config' as NavTab,
      label: 'Settings',
      icon: Settings,
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs z-40 md:hidden"
          onClick={onToggleMobile}
        />
      )}

      {/* Main Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-[260px] bg-[#F7FAFF] border-r border-[#D7E3F2] flex flex-col justify-between transition-transform duration-200 ease-in-out md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          {/* Top Brand Logo */}
          <div className="h-20 px-6 flex items-center justify-between border-b border-[#D7E3F2]/60">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#1764E8] flex items-center justify-center text-white shadow-xs">
                <Activity className="w-5 h-5 stroke-[2.2]" />
              </div>
              <div>
                <h1 className="text-base font-bold text-[#17365D] tracking-tight leading-tight">
                  Regional Ping Monitor
                </h1>
              </div>
            </div>

            {/* Close button on mobile */}
            <button
              onClick={onToggleMobile}
              className="md:hidden p-1.5 rounded-lg text-[#607A9B] hover:text-[#17365D] hover:bg-[#EFF5FC]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1.5">
            {navItems.map(item => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onSelectTab(item.id);
                    if (mobileOpen) onToggleMobile();
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#E5F0FF] text-[#1764E8] font-semibold shadow-2xs'
                      : 'text-[#607A9B] hover:text-[#17365D] hover:bg-[#EFF5FC]'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-[#1764E8]' : 'text-[#607A9B]'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom System Status Widget (matching Image 2) */}
        <div className="p-5 border-t border-[#D7E3F2]/60">
          <div className="p-3.5 bg-white rounded-xl border border-[#D7E3F2] shadow-2xs flex items-center gap-3">
            <div className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#079669] opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#079669]"></span>
            </div>
            <div>
              <div className="text-xs font-bold text-[#17365D]">System Online</div>
              <div className="text-[11px] text-[#607A9B]">API Gateway Standby</div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
