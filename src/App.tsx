/**
 * Regional Ping Monitor - Main Application (Matching Reference Design Image 2)
 */

import React, { useState, useEffect } from 'react';
import { Sidebar, type NavTab } from './components/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { TestHistoryPage } from './pages/TestHistoryPage';
import { ApiConfigPage } from './pages/ApiConfigPage';
import { testConnection } from './lib/firebase';
import { Menu, Activity } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);

  // Validate Firestore server connection on startup
  useEffect(() => {
    testConnection().then(res => {
      if (res.connected) {
        console.log('[Regional Ping Monitor] Firestore connection healthy:', res.message);
      } else {
        console.warn('[Regional Ping Monitor] Firestore connection status:', res.message);
      }
    });
  }, []);

  return (
    <div className="min-h-screen bg-[#EFF5FC] text-[#17365D] font-sans antialiased flex flex-col md:flex-row">
      {/* Fixed Left Sidebar matching Image 2 */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        mobileOpen={mobileSidebarOpen}
        onToggleMobile={() => setMobileSidebarOpen(!mobileSidebarOpen)}
      />

      {/* Mobile Top App Bar (visible only on small screens) */}
      <div className="md:hidden h-16 bg-[#F7FAFF] border-b border-[#D7E3F2] px-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#1764E8] flex items-center justify-center text-white">
            <Activity className="w-4 h-4 stroke-[2.2]" />
          </div>
          <span className="font-bold text-[#17365D] text-sm">Regional Ping Monitor</span>
        </div>
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="p-2 rounded-lg text-[#607A9B] hover:text-[#17365D] hover:bg-[#EFF5FC]"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Main Content Area (offset by sidebar width on desktop) */}
      <main className="flex-1 md:pl-[260px] min-h-screen flex flex-col">
        <div className="flex-1 p-5 sm:p-8 max-w-[1600px] w-full mx-auto">
          {currentTab === 'dashboard' && (
            <DashboardPage onNavigateToApiConfig={() => setCurrentTab('api-config')} />
          )}
          {currentTab === 'history' && <TestHistoryPage />}
          {currentTab === 'api-config' && <ApiConfigPage />}
        </div>
      </main>
    </div>
  );
}
