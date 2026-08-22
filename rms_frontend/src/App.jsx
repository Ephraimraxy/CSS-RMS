import React, { useState, useEffect, useCallback, createContext, useContext, Suspense } from 'react'
import Login from './components/Login'
import LoginPagePremium from './components/LoginPagePremium'
import PublicVerify from './components/PublicVerify'
import DepartmentHeadModal from './components/DepartmentHeadModal'
import Layout from './components/Layout'

// ── Error Boundary — catches failed lazy-chunk imports so the app never goes blank ──
class ChunkErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false, error: null }; }
  static getDerivedStateFromError(error) { return { failed: true, error }; }
  componentDidCatch(error) {
    // If it's a chunk-load failure, a hard reload usually fixes it
    if (/Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError/i.test(error?.message || '')) {
      // Give React one tick to paint the error UI before reloading
      setTimeout(() => window.location.reload(), 3000);
    }
  }
  render() {
    if (this.state.failed) {
      const isChunk = /Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError/i.test(this.state.error?.message || '');
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background p-8 text-center space-y-5">
          <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center mx-auto">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-destructive">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-foreground">
              {isChunk ? 'New version available' : 'Something went wrong'}
            </h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              {isChunk
                ? 'The app was updated. The page will reload automatically in a moment…'
                : 'An unexpected error occurred. Please refresh the page.'}
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-all"
          >
            Reload Now
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const Dashboard = React.lazy(() => import('./components/Dashboard'))
const WorkflowBuilder = React.lazy(() => import('./components/WorkflowBuilder'))
const DepartmentManager = React.lazy(() => import('./components/DepartmentManager'))
const AuditLogs = React.lazy(() => import('./components/AuditLogs'))
const Documentation = React.lazy(() => import('./components/Documentation'))
const DocumentStudio = React.lazy(() => import('./components/DocumentStudio'))
const RequisitionsPage = React.lazy(() => import('./components/RequisitionsPage'))
const MemoManagement = React.lazy(() => import('./components/MemoManagement'))
const DepartmentProfile = React.lazy(() => import('./components/DepartmentProfile'))
const SubAccountsPage = React.lazy(() => import('./components/SubAccountsPanel'))
const MyActivity = React.lazy(() => import('./components/MyActivity'))

// ── Store Records ──────────────────────────────────────────────────────────────
const StoreRecordsPage = React.lazy(() => import('./components/StoreRecordsPage'))

// ── ICC Oversight Console ───────────────────────────────────────────────────────
const IccOversightPage = React.lazy(() => import('./components/IccOversightPage'))

// ── HR Portal modules ──────────────────────────────────────────────────────────
const HRDashboard = React.lazy(() => import('./components/HRDashboard'))
const EmployeeDirectory = React.lazy(() => import('./components/EmployeeDirectory'))
const LeaveManagement = React.lazy(() => import('./components/LeaveManagement'))
const AttendanceTracker = React.lazy(() => import('./components/AttendanceTracker'))
const PayrollOverview = React.lazy(() => import('./components/PayrollOverview'))
const RecruitmentPipeline = React.lazy(() => import('./components/RecruitmentPipeline'))

import { AuthProvider, useAuth } from './context/AuthContext'
import { AIFeaturesProvider } from './context/AIFeaturesContext'
import { Toaster, toast } from 'react-hot-toast'

import { flushSyncQueue, getDepartmentById, updateDepartmentHead } from './lib/store';

const NetworkContext = createContext({ isOnline: true, networkQuality: 'strong' });
export const useNetwork = () => useContext(NetworkContext);

const classifyQuality = (rtt) => {
  if (!navigator.onLine) return 'offline';
  const conn = navigator.connection;
  const etype = conn?.effectiveType;
  if (etype === 'slow-2g') return 'poor';
  if (etype === '2g') return 'weak';
  if (etype === '3g') return 'partial';
  if (etype === '4g') return 'strong';
  if (rtt > 2500) return 'poor';
  if (rtt > 900)  return 'weak';
  if (rtt > 350)  return 'partial';
  return 'strong';
};

const NetworkProvider = ({ children }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [networkQuality, setNetworkQuality] = useState(() => {
    if (!navigator.onLine) return 'offline';
    const conn = navigator.connection;
    const etype = conn?.effectiveType;
    if (etype === 'slow-2g') return 'poor';
    if (etype === '2g') return 'weak';
    if (etype === '3g') return 'partial';
    return 'strong';
  });

  useEffect(() => {
    let checkInterval;

    const checkConnectivity = async () => {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch('/health', {
          method: 'GET',
          signal: controller.signal,
          cache: 'no-store'
        });

        clearTimeout(timeoutId);
        const rtt = Date.now() - start;

        if (response.ok) {
          setNetworkQuality(classifyQuality(rtt));
          if (!isOnline) {
            setIsOnline(true);
            toast.success('Connection Restored. Syncing pending actions…', {
              icon: <img src="/CSS_Group.png" className="w-8 h-5 object-cover rounded" alt="" />
            });
            flushSyncQueue();
          }
        }
      } catch (err) {
        const rtt = Date.now() - start;
        const likelyOffline = !navigator.onLine || rtt < 300;
        setNetworkQuality(likelyOffline ? 'offline' : 'poor');
        if (isOnline) {
          setIsOnline(false);
          toast.error('Offline Mode Active. Drafts will save locally.', {
            icon: <img src="/CSS_Group.png" className="w-8 h-5 object-cover rounded grayscale opacity-50" alt="" />,
            duration: 4000
          });
        }
      }
    };

    const handleConnectionChange = () => {
      if (!navigator.onLine) return;
      const conn = navigator.connection;
      if (conn?.effectiveType) {
        const etype = conn.effectiveType;
        if (etype === 'slow-2g') setNetworkQuality('poor');
        else if (etype === '2g') setNetworkQuality('weak');
        else if (etype === '3g') setNetworkQuality('partial');
        else if (etype === '4g') setNetworkQuality('strong');
      }
    };

    // Initial check
    checkConnectivity();

    // Periodic heartbeat (every 10 seconds)
    checkInterval = setInterval(checkConnectivity, 30000);

    const handleBrowserStatusChange = () => {
      if (navigator.onLine) checkConnectivity();
      else { setIsOnline(false); setNetworkQuality('offline'); }
    };

    window.addEventListener('online', handleBrowserStatusChange);
    window.addEventListener('offline', handleBrowserStatusChange);
    navigator.connection?.addEventListener('change', handleConnectionChange);

    return () => {
      clearInterval(checkInterval);
      window.removeEventListener('online', handleBrowserStatusChange);
      window.removeEventListener('offline', handleBrowserStatusChange);
      navigator.connection?.removeEventListener('change', handleConnectionChange);
    };
  }, [isOnline]);

  return (
    <NetworkContext.Provider value={{ isOnline, networkQuality }}>
      {children}
    </NetworkContext.Provider>
  );
};

// Valid view names — used to validate hash on load and popstate
const VALID_VIEWS = [
  'dashboard', 'requisitions', 'memos', 'activity',
  'workflow_builder', 'department_manager', 'audit_logs', 'documentation',
  'document_studio', 'dept_profile', 'sub_accounts',
  // HR Portal views
  'hr_dashboard', 'hr_employees', 'hr_leaves', 'hr_attendance', 'hr_payroll', 'hr_recruitment',
  // Store Records
  'store_records',
  // ICC Oversight
  'icc_oversight'
];

const getViewFromHash = () => {
  const hash = window.location.hash.replace('#', '');
  return VALID_VIEWS.includes(hash) ? hash : 'dashboard';
};

// ── Maintenance overlay ────────────────────────────────────────────────────────
// Shown when MAINTENANCE_MODE=true in Railway. Polls /api/public/app-status
// every 30 s. When maintenance is detected, the logged-in user is signed out
// and this full-screen message is shown for all visitors on the production URL.
const MAINT_CSS = `
  @keyframes maintFadeUp   { from { opacity:0; transform:translateY(28px); } to { opacity:1; transform:translateY(0); } }
  @keyframes maintFadeIn   { from { opacity:0; } to { opacity:1; } }
  @keyframes maintSlideUp  { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
  @keyframes maintGlow     { 0%,100% { text-shadow:0 0 18px rgba(134,239,172,.18),0 0 40px rgba(134,239,172,.08); } 50% { text-shadow:0 0 32px rgba(134,239,172,.38),0 0 70px rgba(134,239,172,.18); } }
  @keyframes maintPulseBar { 0%,100% { opacity:.35; transform:scaleX(.85); } 50% { opacity:.7; transform:scaleX(1); } }
  @keyframes maintBadge    { 0%,100% { box-shadow:0 0 0 0 rgba(251,191,36,.22); } 60% { box-shadow:0 0 0 10px rgba(251,191,36,0); } }
  @keyframes maintDot      { 0%,100% { opacity:.5; } 50% { opacity:1; } }
  @keyframes maintIconBob  { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-6px); } }
  @keyframes maintScanline { 0% { transform:translateY(-100%); } 100% { transform:translateY(100vh); } }
`;
const MaintenanceScreen = () => (
  <div className="min-h-screen relative flex flex-col items-center justify-center bg-gradient-to-br from-[#0a1a0c] via-[#1a3320] to-[#0a1a0c] text-white p-8 text-center overflow-hidden">
    <style>{MAINT_CSS}</style>

    {/* Slow scanline shimmer */}
    <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-white/6 to-transparent pointer-events-none"
      style={{ animation:'maintScanline 8s linear infinite', top:0 }} />

    {/* Full-page background logo */}
    <img src="/CSS_Group.png" alt="" aria-hidden="true"
      className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
      style={{ opacity: 0.06, filter: 'brightness(3) saturate(0)' }} />

    <div className="relative z-10 max-w-lg w-full space-y-8">

      {/* Icon badge */}
      <div className="w-24 h-24 mx-auto rounded-3xl bg-white/10 border border-white/20 flex items-center justify-center overflow-hidden"
        style={{ animation:'maintIconBob 3.5s ease-in-out infinite, maintFadeIn .6s ease both' }}>
        <img src="/CSS_Favicon.png" alt="CSS Group" className="w-full h-full object-contain p-2" />
      </div>

      {/* Headline */}
      <div style={{ animation:'maintFadeUp .7s ease .1s both' }}>
        <p className="text-xs font-black uppercase tracking-[0.42em] text-white/35 mb-3"
          style={{ animation:'maintFadeIn .6s ease .05s both' }}>
          CSS Group RMS
        </p>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight leading-tight"
          style={{ textWrap:'balance', animation:'maintGlow 4s ease-in-out infinite' }}>
          System Undergoing<br/>Maintenance
        </h1>
        {/* Animated underline bar */}
        <div className="mt-4 h-[3px] w-24 rounded-full bg-gradient-to-r from-green-400/60 via-green-300/80 to-green-400/60 mx-auto"
          style={{ animation:'maintPulseBar 2.8s ease-in-out infinite', transformOrigin:'center' }} />
      </div>

      {/* Body text */}
      <p className="text-white/55 text-lg leading-relaxed max-w-sm mx-auto"
        style={{ textWrap:'balance', animation:'maintSlideUp .7s ease .25s both' }}>
        The CSS Group RMS portal is currently undergoing an upgrade to serve you better.
        We'll be back shortly — thank you for your patience.
      </p>

      {/* Status row */}
      <div className="flex items-center justify-center gap-3 text-white/45 text-sm font-medium"
        style={{ animation:'maintSlideUp .7s ease .4s both' }}>
        <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-amber-400/25 bg-amber-400/8"
          style={{ animation:'maintBadge 2.4s ease-in-out infinite' }}>
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" style={{ animation:'maintDot 1.2s ease-in-out infinite' }} />
          Upgrade in progress
        </span>
        <span className="text-white/25">·</span>
        <span className="text-white/35 text-xs">Please check back soon</span>
      </div>

    </div>
  </div>
);

const AppContent = () => {
  const { user, loading, logout } = useAuth();
  const [currentView, setCurrentView] = useState(getViewFromHash);
  const [deptProfile, setDeptProfile] = useState(null);
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [deepLinkReqId, setDeepLinkReqId] = useState(null);
  // Seed from sessionStorage so the very first render already knows whether
  // maintenance is on — eliminates the login→maintenance flash on reload.
  const [maintenance, setMaintenance] = useState(
    () => sessionStorage.getItem('rms_maintenance') === 'true'
  );
  // Read cached value first so there is zero flash on refresh
  const [loginStyle, setLoginStyle] = useState(
    () => sessionStorage.getItem('rms_login_style') || null
  );

  useEffect(() => {
    fetch('/api/public/login-style')
      .then(r => r.json())
      .then(d => {
        const style = d?.value || 'standard';
        setLoginStyle(style);
        sessionStorage.setItem('rms_login_style', style);
      })
      .catch(() => setLoginStyle('standard'));
  }, []);

  // Poll maintenance status every 30 s; auto-logout when maintenance activates
  useEffect(() => {
    const checkMaintenance = () => {
      fetch('/api/public/app-status').then(r => r.json()).then(d => {
        if (d?.maintenance) {
          sessionStorage.setItem('rms_maintenance', 'true');
          setMaintenance(true);
          if (user) logout();
        } else {
          sessionStorage.removeItem('rms_maintenance');
          setMaintenance(false);
        }
      }).catch(() => {});
    };
    checkMaintenance();
    const iv = setInterval(checkMaintenance, 30000);
    return () => clearInterval(iv);
  }, [user]);

  // navigate(view) — normal navigation
  // navigate('requisitions', { reqId: 31 }) — deep-link directly into a requisition
  const navigate = useCallback((view, opts = {}) => {
    const target = VALID_VIEWS.includes(view) ? view : 'dashboard';
    if (opts.reqId) setDeepLinkReqId(opts.reqId);
    setCurrentView(target);
    window.history.pushState({ view: target }, '', `#${target}`);
  }, []);

  // Handle browser back / forward buttons
  useEffect(() => {
    const onPopState = (e) => {
      const view = e.state?.view || getViewFromHash();
      setCurrentView(VALID_VIEWS.includes(view) ? view : 'dashboard');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    // Reset to dashboard whenever user session changes (login or logout)
    navigate('dashboard');
    setDeptProfile(null);
    setShowDeptModal(false);

    // Handle push-notification deep link: /?req=123
    const params = new URLSearchParams(window.location.search);
    const reqId = params.get('req');
    if (reqId && user) {
      window.history.replaceState({}, '', window.location.hash || '/');
      setDeepLinkReqId(parseInt(reqId));
      setCurrentView('requisitions');
    }
  }, [user?.id]);

  useEffect(() => {
    const loadDept = async () => {
      if (!user || user.role !== 'department' || !user.deptId) return;
      const dept = await getDepartmentById(user.deptId);
      if (!dept) return;
      setDeptProfile(dept);
      // Sub-accounts have their details pre-filled by the dept head at creation — skip the setup modal
      if (!user?.isSubAccount && (!dept.headName || !dept.headTitle || !dept.headEmail)) {
        setShowDeptModal(true);
      }
    };
    loadDept();
  }, [user?.role, user?.deptId]);

  if (maintenance) return <MaintenanceScreen />;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center space-y-6">
        <div className="relative">
          <div className="w-20 h-20 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <img src="/CSS_Group.png" className="w-24 h-14 object-cover rounded-xl animate-pulse" alt="Loading" />
          </div>
        </div>
        <div className="text-center space-y-2">
          <p className="text-sm font-bold text-primary tracking-widest uppercase animate-pulse">Initializing Portal</p>
          <p className="text-[10px] text-muted-foreground font-mono">Securing Session...</p>
        </div>
      </div>
    );
  }

  // loginStyle null = first visit, fetch in flight — show spinner to avoid standard→premium flash
  if (!user && loginStyle === null) return (
    <div className="min-h-screen bg-[#b8d9b8] flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
    </div>
  );

  if (!user) return loginStyle === 'premium' ? <LoginPagePremium /> : <Login />;

  const isAdminView = ['workflow_builder', 'department_manager', 'audit_logs', 'documentation'].includes(currentView);
  const isHRView = ['hr_dashboard', 'hr_employees', 'hr_leaves', 'hr_attendance', 'hr_payroll', 'hr_recruitment'].includes(currentView);
  // HR department users log in with role='department' — detect them by name
  const isHRDept    = /\bhr\b|human\s*resource/i.test(user?.name || '');
  const isStoreDept = /\bstore\b/i.test(user?.name || '') || /\bstore\b/i.test(user?.parentDeptName || '');
  const isIccDept   = /\bicc\b|internal.*control|control.*compliance/i.test(user?.name || '');
  const canAccessHR    = user.role === 'hr' || user.role === 'global_admin' || isHRDept;
  const canAccessAdmin = user.role === 'global_admin';
  const canAccessStore = user.role === 'global_admin' || isStoreDept;
  const canAccessIcc   = user.role === 'global_admin' || user.role === 'department';
  const activeView = (isAdminView && !canAccessAdmin) ? 'dashboard'
    : (isHRView && !canAccessHR) ? 'dashboard'
    : (currentView === 'store_records' && !canAccessStore) ? 'dashboard'
    : (currentView === 'icc_oversight' && !canAccessIcc) ? 'dashboard'
    : currentView;

  const views = {
    dashboard: <Dashboard onViewChange={navigate} />,
    requisitions: <RequisitionsPage onViewChange={navigate} initialReqId={deepLinkReqId} onDeepLinkConsumed={() => setDeepLinkReqId(null)} />,
    memos: <MemoManagement onViewChange={navigate} />,
    activity: <MyActivity onViewChange={navigate} />,
    workflow_builder: <WorkflowBuilder onViewChange={navigate} />,
    department_manager: <DepartmentManager onViewChange={navigate} />,
    audit_logs: <AuditLogs onViewChange={navigate} />,
    documentation: <Documentation onViewChange={navigate} />,
    document_studio: <DocumentStudio user={user} onViewChange={navigate} />,
    dept_profile: <DepartmentProfile user={user} onViewChange={navigate} />,
    sub_accounts: (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm">
          <SubAccountsPage isAdmin={user?.role === 'global_admin'} />
        </div>
      </div>
    ),
    // Store Records
    store_records: <StoreRecordsPage onViewChange={navigate} />,
    // ICC Oversight Console
    icc_oversight: <IccOversightPage onViewChange={navigate} />,
    // HR Portal
    hr_dashboard:   <HRDashboard onViewChange={navigate} />,
    hr_employees:   <EmployeeDirectory onViewChange={navigate} />,
    hr_leaves:      <LeaveManagement onViewChange={navigate} />,
    hr_attendance:  <AttendanceTracker onViewChange={navigate} />,
    hr_payroll:     <PayrollOverview onViewChange={navigate} />,
    hr_recruitment: <RecruitmentPipeline onViewChange={navigate} />,
  };

  return (
    <>
    <Layout user={user} currentView={activeView} onViewChange={navigate}>
      <ChunkErrorBoundary>
        <Suspense fallback={
          <div className="flex-1 flex flex-col items-center justify-center p-12">
            <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
            <p className="mt-4 text-xs font-mono text-muted-foreground animate-pulse">Loading module...</p>
          </div>
        }>
          {views[activeView] || views.dashboard}
        </Suspense>
      </ChunkErrorBoundary>
    </Layout>
      <DepartmentHeadModal
        isOpen={showDeptModal}
        department={deptProfile}
        onSave={async (payload) => {
          if (!deptProfile) return;
          const updated = await updateDepartmentHead(deptProfile.id, payload);
          setDeptProfile(updated);
          setShowDeptModal(false);
        }}
        onClose={logout}
      />
    </>
  );
};

function App() {
  if (window.location.pathname.startsWith('/verify')) {
    return (
      <>
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: '#ffffff',
              color: '#1a1f2e',
              border: '1px solid rgba(26, 92, 26, 0.15)',
              borderRadius: '12px',
              fontSize: '13px',
              fontWeight: '600',
              boxShadow: '0 10px 25px -5px rgba(249, 115, 22, 0.12), 0 4px 10px -3px rgba(0,0,0,0.06)'
            }
          }}
        />
        <PublicVerify />
      </>
    )
  }
  return (
    <NetworkProvider>
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: 'hsl(var(--card))',
            color: 'hsl(var(--foreground))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '12px',
            fontSize: '14px',
            fontWeight: '600',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)'
          }
        }}
      />
      <AuthProvider>
        <AIFeaturesProvider>
          <AppContent />
        </AIFeaturesProvider>
      </AuthProvider>
    </NetworkProvider>
  )
}

export default App
