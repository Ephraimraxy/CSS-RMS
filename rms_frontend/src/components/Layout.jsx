import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNetwork } from '../App';
import {
  LayoutDashboard, FileText, ClipboardCheck, History, Settings,
  LogOut, Bell, Briefcase, Activity, User as UserIcon, PenTool,
  ChevronLeft, ChevronRight, ChevronDown, Menu, Inbox, Clock, WifiOff, RefreshCcw,
  Building2, ShieldAlert, Users, CalendarDays, DollarSign, UserPlus,
  HeartHandshake, Loader2, CheckCircle2, XCircle, X, FilePen, Trash2, GitBranch,
  Package, AlertTriangle, ScanEye, BookOpen, Smartphone, Download
} from 'lucide-react';
import { getNotifications, getSyncQueueStatus, flushSyncQueue, markNotificationRead, markAllNotificationsRead, clearNotifications, getRequisitions, isMemoRecord, getDepartments } from '../lib/store';
import { reqAPI, settingsAPI, authAPI } from '../lib/api';
import { loadFeatureFlag } from '../lib/featureFlag';
import ChatWidget from './ChatWidget';

const normalizeRole = (r) => (r || '').toLowerCase().replace(/\s+/g, '_');

const SidebarItem = ({ icon: Icon, label, active = false, onClick, mobile = false, isCollapsed = false, badge = 0 }) => {
  const [clickId, setClickId] = useState(0);

  const handleClick = () => {
    setClickId(id => id + 1);
    onClick?.();
  };

  return (
    <div
      onClick={handleClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleClick()}
      tabIndex={0}
      title={isCollapsed ? label : ''}
      className={mobile
        ? `relative overflow-hidden flex-1 flex flex-col items-center justify-center py-2 px-1 rounded-2xl cursor-pointer transition-all active:scale-95 outline-none focus-electric-halo hover-orange-pulse ${active ? 'text-[#f97316] animate-electric-pulse' : 'text-white'}`
        : `relative flex items-center group px-3 py-2.5 rounded-2xl cursor-pointer transition-all duration-300 hover-shine-effect outline-none focus-electric-halo hover-orange-pulse ${isCollapsed ? 'justify-center mx-1' : 'space-x-4 mx-1'} ${active ? (isCollapsed ? 'bg-[#f97316]/20 text-[#f97316] shadow-lg shadow-[#f97316]/25 ring-1 ring-[#f97316]/25 scale-[0.98] animate-electric-pulse animate-active-hum' : 'bg-white/15 text-[#f97316] shadow-lg shadow-black/20 scale-[0.98] animate-electric-pulse animate-active-hum') : 'text-white'}`
      }
    >
      {/* Click ripple flash */}
      {clickId > 0 && (
        <span key={clickId} className="absolute inset-0 rounded-2xl bg-white/25 nav-click-ripple pointer-events-none" />
      )}
      {/* Active left accent bar (desktop only) */}
      {active && !mobile && (
        <span className="absolute left-0 inset-y-0 flex items-center pointer-events-none">
          <span className="w-[3px] bg-[#f97316] rounded-r-full nav-indicator-in" style={{ height: '1.5rem' }} />
        </span>
      )}
      <div className={`relative transition-transform duration-300 ${active ? 'scale-110' : 'group-hover:scale-110'}`}>
        <Icon size={mobile ? 20 : 18} />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] bg-amber-500 text-white text-[8px] font-black rounded-full flex items-center justify-center px-0.5 shadow-sm shadow-amber-900/30 animate-pulse">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </div>
      {!mobile && !isCollapsed && (
        <span className="font-bold text-[13px] tracking-tight whitespace-nowrap overflow-hidden transition-all duration-300">
          {label}
        </span>
      )}
      {isCollapsed && !mobile && (
        <div className="absolute left-full ml-4 px-3 py-2 bg-white text-primary text-[10px] font-black rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-all translate-x-[-10px] group-hover:translate-x-0 shadow-xl whitespace-nowrap z-[100] uppercase tracking-widest">
          {label}
        </div>
      )}
      {mobile && <span className={`text-[9px] font-black mt-1.5 uppercase tracking-tighter transition-all ${active ? 'text-[#f97316]' : 'text-white'}`}>{label}</span>}
    </div>
  );
};

const SignalBars = ({ bars }) => (
  <div className="flex items-end gap-[2.5px]" style={{ height: '11px' }}>
    {[1, 2, 3, 4].map(i => (
      <div
        key={i}
        className={`w-[3px] rounded-[1px] transition-all duration-500 ${i <= bars ? 'bg-current' : 'bg-current opacity-[0.12]'}`}
        style={{ height: `${25 * i}%` }}
      />
    ))}
  </div>
);

const QUALITY_CFG = {
  offline: { label: 'Offline',  bars: 0, cls: 'bg-rose-500/10 border-rose-400/30 text-rose-600',      dot: 'bg-rose-500' },
  poor:    { label: 'Poor',     bars: 1, cls: 'bg-red-500/10 border-red-400/30 text-red-600',          dot: 'bg-red-500 animate-pulse' },
  weak:    { label: 'Weak',     bars: 2, cls: 'bg-orange-500/10 border-orange-400/30 text-orange-600', dot: 'bg-orange-500 animate-pulse' },
  partial: { label: 'Partial',  bars: 3, cls: 'bg-amber-500/10 border-amber-400/30 text-amber-700',    dot: 'bg-amber-500' },
  strong:  { label: 'Full',     bars: 4, cls: 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600', dot: 'bg-emerald-500 animate-pulse' },
};

const REFRESH_STEPS = [
  { key: 'ping',   label: 'Verifying server connection' },
  { key: 'reqs',   label: 'Fetching latest requisitions' },
  { key: 'notifs', label: 'Refreshing notifications' },
  { key: 'page',   label: 'Syncing current page data' },
];

const Navbar = ({ user, toggleSidebar, isCollapsed, notifications, setNotifications, showBell, setShowBell, onLogout, onViewChange, currentView, actionAlert, onChatDeepLink, parentDeptLabel }) => {
  const { isOnline, networkQuality } = useNetwork();
  const qcfg = QUALITY_CFG[networkQuality] || QUALITY_CFG.strong;
  const unreadCount = notifications.filter(n => !n.isRead).length;

  const [showDrafts, setShowDrafts] = React.useState(false);
  const [drafts, setDrafts] = React.useState([]);
  const [loadingDrafts, setLoadingDrafts] = React.useState(false);
  const [deletingDraftId, setDeletingDraftId] = React.useState(null);

  const loadDrafts = React.useCallback(async () => {
    setLoadingDrafts(true);
    try {
      const data = await reqAPI.getRequisitions({ status: 'draft' });
      const serverDrafts = Array.isArray(data) ? data.filter(r => r.status === 'draft') : [];

      // Also surface any localStorage autosaves not yet promoted to a server draft.
      // key format: rms_autosave_${type}_${deptId} — only include keys for the current dept
      const currentDeptId = String(user?.deptId || '');
      const localDrafts = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('rms_autosave_')) continue;
        // Parse deptId from key suffix and skip drafts that belong to other depts
        const parts = key.replace('rms_autosave_', '').split('_');
        const keyDeptId = parts[parts.length - 1];
        if (currentDeptId && keyDeptId !== currentDeptId) continue;
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const snap = JSON.parse(raw);
          // Expire snapshots older than 24 h
          if (Date.now() - (snap.savedAt || 0) > 86400000) { localStorage.removeItem(key); continue; }
          const hasContent = snap.subject?.trim() || snap.comment?.trim() ||
            snap.items?.some(it => it.description?.trim());
          if (!hasContent) continue;
          const typeSlug = parts.slice(0, -1).join('_') || 'Cash';
          localDrafts.push({
            id: `local_${key}`,
            _isLocal: true,
            _lsKey: key,
            title: snap.subject?.trim() || `${typeSlug} Draft`,
            type: typeSlug,
            amount: snap.items?.reduce((s, it) => s + ((parseFloat(it.qty) || 1) * (parseFloat(it.amount) || 0)), 0) || null,
            updatedAt: new Date(snap.savedAt || Date.now()).toISOString(),
            createdAt: new Date(snap.savedAt || Date.now()).toISOString(),
          });
        } catch { /* corrupt key — skip */ }
      }

      setDrafts([...serverDrafts, ...localDrafts]);
    } catch { setDrafts([]); }
    finally { setLoadingDrafts(false); }
  }, [user?.deptId]);

  React.useEffect(() => {
    loadDrafts();
    window.addEventListener('rms:draftSaved', loadDrafts);
    return () => window.removeEventListener('rms:draftSaved', loadDrafts);
  }, [loadDrafts]);

  const handleDeleteDraft = async (id) => {
    setDeletingDraftId(id);
    try {
      const draft = drafts.find(d => d.id === id);
      if (draft?._isLocal) {
        localStorage.removeItem(draft._lsKey);
        setDrafts(prev => prev.filter(d => d.id !== id));
      } else {
        await reqAPI.deleteRequisition(id);
        setDrafts(prev => prev.filter(d => d.id !== id));
        window.dispatchEvent(new CustomEvent('globalHardRefresh'));
      }
    } catch { /* ignore */ }
    finally { setDeletingDraftId(null); }
  };

  const handleOpenDraft = (draft) => {
    setShowDrafts(false);
    if (draft._isLocal) {
      // Remove from badge immediately so count drops right away
      setDrafts(prev => prev.filter(d => d.id !== draft.id));
      // Tell the form to restore autosave data when it opens
      sessionStorage.setItem(`rms_restore_${draft.type}`, '1');
      // Persist form-open intent for the lazy-load fallback
      sessionStorage.setItem('rms_pending_open_request', draft.type);
      // Navigate to the correct view for this draft type
      const targetView = draft.type === 'Memo' ? 'memos' : 'requisitions';
      onViewChange(targetView);
      // Fire event for the already-mounted case (+ 400 ms fallback)
      window.dispatchEvent(new CustomEvent('rms:openNewRequest', { detail: { type: draft.type } }));
      setTimeout(() => window.dispatchEvent(new CustomEvent('rms:openNewRequest', { detail: { type: draft.type } })), 400);
    } else {
      const targetView = draft.type === 'Memo' ? 'memos' : 'requisitions';
      onViewChange(targetView);
      window.dispatchEvent(new CustomEvent('rms:openDraftEdit', { detail: { id: draft.id, type: draft.type } }));
    }
  };

  const handleNotifClick = async (n) => {
    // Mark as read (fire and forget — don't await so UI stays responsive)
    if (!n.isRead) {
      markNotificationRead(n.id).catch(() => { });
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
    }

    setShowBell(false);

    // Chat deep-link: ?chat=group or ?chat=dm:5
    if (n.link) {
      const chatMatch = n.link.match(/[?&]chat=([^&]+)/);
      if (chatMatch) {
        onChatDeepLink?.(chatMatch[1]);
        return;
      }
    }

    let matchedId = null;
    let memoMatched = false;
    if (n.link) {
      const match = n.link.match(/\/requisitions\/(\d+)/);
      const memoMatch = n.link.match(/\/memos\/(\d+)/);
      if (match) matchedId = match[1];
      if (memoMatch) {
        matchedId = memoMatch[1];
        memoMatched = true;
      }
    }

    if (memoMatched) {
      onViewChange('memos');
    } else if (matchedId) {
      // Persist the target so freshly-mounted RequisitionsPage can pick it up after load
      localStorage.setItem('rms_pending_requisition_id', matchedId);
      onViewChange('requisitions');
      // Fire at 100ms (component may already be mounted) and again at 700ms
      // (fallback for slow mount + data load). The localStorage approach also
      // catches it independently after loadData() resolves.
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('openRequisition', { detail: matchedId }));
      }, 100);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('openRequisition', { detail: matchedId }));
      }, 700);
    } else {
      onViewChange('requisitions');
    }
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead();
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  const handleClearAll = async () => {
    await clearNotifications();
    setNotifications([]);
  };

  const [showRefreshPopover, setShowRefreshPopover] = useState(false);
  const [refreshRunning, setRefreshRunning] = useState(false);
  const [refreshSteps, setRefreshSteps] = useState(REFRESH_STEPS.map(s => ({ ...s, status: 'idle', error: null })));
  const [refreshSummary, setRefreshSummary] = useState(null);

  // Background update detection — badge count
  const [pendingUpdates, setPendingUpdates] = useState(0);
  const lastKnownUnread = React.useRef(null);
  const swUpdated = React.useRef(false);

  useEffect(() => {
    const swPollRef = { current: null };

    const silentPoll = async () => {
      if (!navigator.onLine) return;
      try {
        const notifs = await getNotifications();
        const freshUnread = (notifs || []).filter(n => !n.isRead).length;
        if (lastKnownUnread.current === null) {
          // First run — just set baseline, don't count as new
          lastKnownUnread.current = freshUnread;
          return;
        }
        const diff = freshUnread - lastKnownUnread.current;
        if (diff > 0) {
          setPendingUpdates(prev => prev + diff);
          setNotifications(notifs); // silently update the bell too
        }
        lastKnownUnread.current = freshUnread;
      } catch { }
    };

    const pollId = setInterval(silentPoll, 90000); // every 90 s

    // Detect new deployment via service worker update
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then(reg => {
          swPollRef.current = setInterval(() => reg.update().catch(() => {}), 120000);
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New SW installed and waiting — notify user
                if (!swUpdated.current) {
                  swUpdated.current = true;
                  setPendingUpdates(prev => prev + 1);
                }
              }
            });
          });
        })
        .catch(() => {});
    }

    return () => {
      clearInterval(pollId);
      if (swPollRef.current) clearInterval(swPollRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleHardRefresh = async () => {
    if (refreshRunning) return;
    const hadSwUpdate = swUpdated.current; // capture before we reset it
    setPendingUpdates(0); // clear badge immediately on click
    setShowRefreshPopover(true);
    setRefreshRunning(true);
    setRefreshSummary(null);
    setRefreshSteps(REFRESH_STEPS.map(s => ({ ...s, status: 'pending', error: null })));

    const setStep = (key, status, error = null) =>
      setRefreshSteps(prev => prev.map(s => s.key === key ? { ...s, status, error } : s));

    let ok = 0, fail = 0;

    // Step 1: server ping
    setStep('ping', 'running');
    try {
      if (!navigator.onLine) throw new Error('Device is offline');
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch('/health', { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setStep('ping', 'done'); ok++;
    } catch (e) {
      const msg = e.name === 'AbortError'
        ? 'Request timed out — network too slow to reach server'
        : !navigator.onLine ? 'No internet connection'
        : e.message;
      setStep('ping', 'error', msg); fail++;
      setRefreshSummary({ ok, fail: REFRESH_STEPS.length - ok });
      setRefreshRunning(false);
      return;
    }

    // Step 2: requisitions
    setStep('reqs', 'running');
    try {
      await reqAPI.getRequisitions();
      setStep('reqs', 'done'); ok++;
    } catch (e) {
      const msg = e?.response?.status === 401 ? 'Session expired — please log in again'
        : (e?.code === 'ERR_NETWORK' || e?.name === 'AbortError') ? 'Connection dropped while fetching'
        : e?.message || 'Could not fetch requisitions';
      setStep('reqs', 'error', msg); fail++;
    }

    // Step 3: notifications
    setStep('notifs', 'running');
    try {
      const notifs = await getNotifications();
      setNotifications(notifs);
      lastKnownUnread.current = (notifs || []).filter(n => !n.isRead).length;
      swUpdated.current = false;
      setStep('notifs', 'done'); ok++;
    } catch (e) {
      setStep('notifs', 'error', e?.message || 'Notification refresh failed'); fail++;
    }

    // Step 4: signal current page to reload
    setStep('page', 'running');
    window.dispatchEvent(new CustomEvent('globalHardRefresh'));
    setStep('page', 'done'); ok++;

    setRefreshSummary({ ok, fail });
    setRefreshRunning(false);
    if (fail === 0) {
      if (hadSwUpdate) {
        // New deployment detected — tell the waiting SW to activate, then reload
        // so the page loads the fresh JS/CSS assets instead of cached old ones
        const activateAndReload = async () => {
          try {
            const reg = await navigator.serviceWorker.ready;
            const waiting = reg.waiting;
            if (waiting) {
              await new Promise((resolve) => {
                navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
                waiting.postMessage({ type: 'SKIP_WAITING' });
              });
            }
          } catch { /* SW not available — reload anyway */ }
          window.location.reload();
        };
        setTimeout(activateAndReload, 800);
      } else {
        setTimeout(() => setShowRefreshPopover(false), 3500);
      }
    }
  };

  return (
    <nav className="h-14 border-b border-border/40 bg-white/70 backdrop-blur-xl sticky top-0 z-[60] flex items-center justify-between px-4 lg:px-6">
      <div className="flex items-center space-x-3 lg:space-x-5">
        <button onClick={toggleSidebar} className="hidden lg:flex p-1.5 hover:bg-muted rounded-lg text-muted-foreground transition-colors mr-1">
          <Menu size={18} />
        </button>
        <div className="w-20 h-11 rounded-xl overflow-hidden shrink-0 shadow-sm border border-primary/10">
          <img src="/CSS_Group.png" alt="Logo" className="w-full h-full object-cover object-center" />
        </div>
        <div className="flex flex-col">
          <h1 className="text-[10px] font-black text-foreground tracking-[0.2em] uppercase flex items-center leading-none">
            <span className="ml-2 px-1.5 py-0.5 rounded-md bg-primary/5 border border-primary/10 text-[7px] text-primary/60 font-mono hidden md:inline-block">V1.0.4</span>
          </h1>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[8px] font-black text-primary uppercase tracking-widest">
              {currentView === 'dashboard' ? 'Overview' :
                currentView === 'requisitions' ? 'Requisition Directory' :
                  currentView === 'dept_profile' ? 'Authority Profile' :
                    currentView === 'memos' ? 'Document Management' :
                      currentView === 'activity' ? 'System Activity' :
                      
                        currentView === 'document_studio' ? 'Document Studio' :
                          currentView === 'workflow_builder' ? 'Workflow Architecture' :
                            currentView === 'department_manager' ? 'Tenant Control' :
                              currentView === 'audit_logs' ? 'Security Audit' :
                                currentView === 'documentation' ? 'System Documentation' :
                              currentView === 'sub_accounts' ? 'Sub-Accounts & Units' :
                                currentView === 'hr_dashboard' ? 'HR Overview' :
                                  currentView === 'hr_employees' ? 'Employee Directory' :
                                    currentView === 'hr_leaves' ? 'Leave Management' :
                                      currentView === 'hr_attendance' ? 'Attendance Tracker' :
                                        currentView === 'hr_payroll' ? 'Payroll Overview' :
                                          currentView === 'hr_recruitment' ? 'Recruitment Pipeline' : 'Portal'}
            </span>
          </div>
        </div>
      </div>

      {/* Centered Status Badge / Action Alert */}
      <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center">
        {actionAlert ? (
          <div
            onClick={() => onViewChange(actionAlert.view || 'requisitions', actionAlert.reqId ? { reqId: actionAlert.reqId } : {})}
            className={`px-4 py-1.5 rounded-full border flex items-center gap-2.5 cursor-pointer transition-all duration-500 shadow-lg group hover:scale-105 active:scale-95 ${actionAlert.mode === 'desk'
              ? 'bg-rose-500 text-white border-rose-600 shadow-rose-500/30 animate-pulse'
              : 'bg-amber-500 text-white border-amber-600 shadow-amber-500/30'
              }`}>
            <ShieldAlert size={14} className={actionAlert.mode === 'desk' ? 'animate-bounce' : ''} />
            <span className="text-[9px] font-black uppercase tracking-[0.2em] whitespace-nowrap">
              {actionAlert.mode === 'desk'
                ? `${actionAlert.count} Awaiting Your Action`
                : `${actionAlert.count} Urgent In-Flight`}
            </span>
          </div>
        ) : (
          <div className={`px-3 py-1.5 rounded-full border flex items-center gap-2 transition-all duration-500 shadow-sm ${qcfg.cls}`}>
            <SignalBars bars={qcfg.bars} />
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${qcfg.dot}`} />
            <span className="text-[9px] font-black uppercase tracking-[0.22em] whitespace-nowrap">
              Your Network Is: {qcfg.label}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-3 lg:space-x-5">

        {/* Hard refresh — pull latest data from server */}
        <div className="relative">
          <button
            onClick={() => { setShowDrafts(false); setShowBell(false); handleHardRefresh(); }}
            disabled={refreshRunning}
            title={pendingUpdates > 0 ? `${pendingUpdates} new update${pendingUpdates > 1 ? 's' : ''} — click to apply` : 'Pull latest data from server'}
            className={`relative p-1.5 rounded-lg transition-all disabled:opacity-40 ${showRefreshPopover ? 'bg-foreground text-background shadow-md' : 'text-muted-foreground hover:bg-muted hover:text-primary'}`}
          >
            <RefreshCcw size={16} className={refreshRunning ? 'animate-spin text-primary' : ''} />
            {pendingUpdates > 0 && !refreshRunning && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] rounded-full bg-red-500 text-white text-[8px] font-black flex items-center justify-center px-1 ring-2 ring-white shadow-sm animate-bounce">
                {pendingUpdates > 9 ? '9+' : pendingUpdates}
              </span>
            )}
          </button>

          {showRefreshPopover && (
            <div className="fixed inset-x-4 top-[60px] sm:absolute sm:inset-auto sm:right-0 sm:mt-3 sm:w-72 bg-white rounded-2xl border border-border/80 shadow-[0_20px_50px_rgba(0,0,0,0.15)] z-[100] animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
              <div className="p-4 border-b border-border/40 bg-muted/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {refreshRunning
                    ? <Loader2 size={13} className="animate-spin text-primary" />
                    : refreshSummary?.fail === 0
                      ? <CheckCircle2 size={13} className="text-emerald-500" />
                      : refreshSummary
                        ? <XCircle size={13} className="text-amber-500" />
                        : <RefreshCcw size={13} className="text-muted-foreground" />
                  }
                  <h3 className="text-xs font-black uppercase tracking-widest text-foreground">
                    {refreshRunning ? 'Refreshing…' : 'System Refresh'}
                  </h3>
                </div>
                {!refreshRunning && (
                  <button onClick={() => setShowRefreshPopover(false)} className="p-0.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors">
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="p-4 space-y-3">
                {refreshSteps.map(step => (
                  <div key={step.key} className="flex items-start gap-3">
                    <div className="w-4 h-4 shrink-0 mt-0.5 flex items-center justify-center">
                      {(step.status === 'idle' || step.status === 'pending')
                        ? <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/20" />
                        : step.status === 'running'
                          ? <Loader2 size={13} className="animate-spin text-primary" />
                          : step.status === 'done'
                            ? <CheckCircle2 size={13} className="text-emerald-500" />
                            : <XCircle size={13} className="text-red-500" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[11px] font-bold leading-tight ${
                        step.status === 'error'   ? 'text-red-600'
                        : step.status === 'done'   ? 'text-emerald-700'
                        : step.status === 'running' ? 'text-primary'
                        : 'text-muted-foreground/50'
                      }`}>{step.label}</p>
                      {step.error && (
                        <p className="text-[10px] text-red-500/90 mt-0.5 leading-snug break-words">{step.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {refreshSummary && (
                <div className={`px-4 py-3 border-t border-border/30 flex items-center justify-between ${refreshSummary.fail === 0 ? 'bg-emerald-50/70' : 'bg-amber-50/70'}`}>
                  <span className={`text-[10px] font-black uppercase tracking-widest ${refreshSummary.fail === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {refreshSummary.fail === 0
                      ? `✓ All ${REFRESH_STEPS.length} systems refreshed`
                      : `${refreshSummary.ok}/${REFRESH_STEPS.length} complete — ${refreshSummary.fail} failed`}
                  </span>
                  {refreshSummary.fail > 0 && (
                    <button onClick={handleHardRefresh} className="text-[9px] font-black text-primary hover:text-primary/70 uppercase tracking-widest">
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Drafts quick-access */}
        <div className="relative">
          <button
            onClick={() => { setShowDrafts(v => !v); setShowBell(false); setShowRefreshPopover(false); if (!showDrafts) loadDrafts(); }}
            title="My Drafts"
            className={`relative p-1.5 rounded-lg transition-all ${showDrafts ? 'bg-foreground text-background shadow-md' : 'text-muted-foreground hover:bg-muted hover:text-primary'}`}
          >
            <FilePen size={17} />
            {drafts.length > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] rounded-full bg-amber-500 text-white text-[8px] font-black flex items-center justify-center px-0.5 ring-2 ring-white shadow-sm">
                {drafts.length > 9 ? '9+' : drafts.length}
              </span>
            )}
          </button>

          {showDrafts && (
            <div className="fixed inset-x-4 top-[60px] sm:absolute sm:inset-auto sm:right-0 sm:mt-3 sm:w-80 bg-white rounded-2xl border border-border/80 shadow-[0_20px_50px_rgba(0,0,0,0.15)] z-[100] animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
              <div className="p-4 border-b border-border/40 bg-muted/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FilePen size={13} className="text-amber-500" />
                  <h3 className="text-xs font-black uppercase tracking-widest text-foreground">My Drafts</h3>
                  {drafts.length > 0 && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">{drafts.length}</span>
                  )}
                </div>
                <button onClick={() => setShowDrafts(false)} className="p-0.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors">
                  <X size={14} />
                </button>
              </div>

              <div className="max-h-[380px] overflow-y-auto custom-scrollbar">
                {loadingDrafts ? (
                  <div className="p-8 flex items-center justify-center">
                    <Loader2 size={18} className="animate-spin text-muted-foreground" />
                  </div>
                ) : drafts.length === 0 ? (
                  <div className="p-10 text-center space-y-3">
                    <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto opacity-50">
                      <FilePen size={20} className="text-muted-foreground" />
                    </div>
                    <p className="text-xs text-muted-foreground font-medium">No drafts saved yet.</p>
                    <p className="text-[10px] text-muted-foreground/60">Start a request and save it as a draft to continue later.</p>
                  </div>
                ) : (
                  drafts.map(draft => {
                    const isDeleting = deletingDraftId === draft.id;
                    const amount = draft.amount ? `₦${parseFloat(draft.amount).toLocaleString()}` : null;
                    const daysAgo = Math.floor((Date.now() - new Date(draft.updatedAt || draft.createdAt)) / 86400000);
                    const timeLabel = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`;
                    return (
                      <div key={draft.id} className="p-3 border-b border-border/20 last:border-0 hover:bg-muted/30 transition-colors group">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                            <FilePen size={13} className="text-amber-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-[12px] font-bold text-foreground truncate leading-tight">{draft.title || 'Untitled Draft'}</p>
                              {draft._isLocal && (
                                <span className="text-[8px] font-black uppercase tracking-widest text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full shrink-0">Local</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">{draft.type || 'Request'}</span>
                              {amount && <span className="text-[9px] font-bold text-primary">{amount}</span>}
                              <span className="text-[9px] text-muted-foreground/50">{timeLabel}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleOpenDraft(draft)}
                              title="Continue editing"
                              className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-white transition-all"
                            >
                              <FilePen size={11} />
                            </button>
                            <button
                              onClick={() => handleDeleteDraft(draft.id)}
                              disabled={isDeleting}
                              title="Delete draft"
                              className="p-1.5 rounded-lg bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all disabled:opacity-40"
                            >
                              {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {drafts.length > 0 && (
                <div className="p-3 bg-muted/20 border-t border-border/40 text-center">
                  <button
                    onClick={() => { setShowDrafts(false); onViewChange('requisitions'); }}
                    className="text-[9px] font-black text-primary hover:text-primary/70 uppercase tracking-widest transition-colors"
                  >
                    View All in Requisitions
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => { setShowBell(v => !v); setShowDrafts(false); setShowRefreshPopover(false); }}
            className={`relative transition-all p-1.5 rounded-lg ${showBell ? 'bg-foreground text-background shadow-md' : 'text-muted-foreground hover:bg-muted hover:text-primary'}`}
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-primary rounded-full border-2 border-background text-[8px] font-black text-primary-foreground flex items-center justify-center px-0.5 shadow-sm">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showBell && (
            <div className="fixed inset-x-4 top-[60px] sm:absolute sm:inset-auto sm:right-0 sm:mt-3 sm:w-80 bg-white rounded-2xl border border-border/80 shadow-[0_20px_50px_rgba(0,0,0,0.15)] z-[100] animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
              <div className="p-4 border-b border-border/40 bg-muted/30 flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-widest text-foreground">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold">{unreadCount} Unread</span>
                )}
              </div>
              <div className="max-h-[350px] overflow-y-auto custom-scrollbar">
                {notifications.length === 0 ? (
                  <div className="p-10 text-center space-y-3">
                    <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto opacity-50">
                      <Bell size={20} className="text-muted-foreground" />
                    </div>
                    <p className="text-xs text-muted-foreground font-medium">No notifications yet.</p>
                  </div>
                ) : (
                  notifications.map(n => (
                    <div
                      key={n.id}
                      onClick={() => handleNotifClick(n)}
                      className={`p-4 border-b border-border/20 last:border-0 hover:bg-primary/5 transition-colors cursor-pointer group ${!n.isRead ? 'bg-primary/[0.03]' : ''}`}
                    >
                      <div className="flex items-start space-x-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform ${!n.isRead ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                          <Inbox size={14} />
                        </div>
                        <div className="flex-1 space-y-1">
                          <p className={`text-[11px] leading-tight ${!n.isRead ? 'font-bold text-foreground' : 'font-medium text-muted-foreground'}`}>{n.message}</p>
                          <div className="flex items-center space-x-2 opacity-60">
                            <Clock size={10} />
                            <span className="text-[9px] font-medium">{new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-primary ml-1" />}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="p-3 bg-muted/20 border-t border-border/40 text-center">
                <div className="flex items-center justify-center gap-2">
                  <button onClick={handleMarkAllRead} className="text-[9px] font-black text-primary hover:text-primary/70 uppercase tracking-widest transition-colors">
                    Mark All Read
                  </button>
                  <span className="w-1 h-1 rounded-full bg-border" />
                  <button onClick={handleClearAll} className="text-[9px] font-black text-red-500 hover:text-red-400 uppercase tracking-widest transition-colors">
                    Clear All
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-3 pl-4 lg:pl-5 border-l border-border/30">
          <div className="text-right hidden sm:block">
            <p className="text-[11px] font-black text-foreground leading-none flex items-center justify-end space-x-1.5">
              <span>{user?.name || 'Administrator'}</span>
            </p>
            <p className="text-[9px] text-primary font-black mt-1 uppercase tracking-tighter opacity-80 flex items-center justify-end gap-1.5">
              {user?.role === 'department' ? (user?.isSubAccount ? 'Sub-Account' : 'Controller') : (user?.role || 'Admin Account')}
              {user?.isSubAccount && (
                <span className="px-1.5 py-0.5 rounded-full bg-violet-100 border border-violet-200 text-violet-700 text-[7px] font-black tracking-widest normal-case">
                  {parentDeptLabel || 'UNIT'}
                </span>
              )}
            </p>
          </div>

          {/* Mobile Log Out Button */}
          <button
            onClick={onLogout}
            className="lg:hidden p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
            title="Log Out"
          >
            <LogOut size={18} />
          </button>

          <button
            onClick={() => onViewChange('dept_profile')}
            title="My Profile"
            className={`w-8 h-8 rounded-xl border flex items-center justify-center shadow-sm overflow-hidden font-black text-xs transition-all cursor-pointer
            ${currentView === 'dept_profile'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-primary/10 border-primary/20 text-primary hover:bg-primary hover:text-primary-foreground hover:border-primary'}`}
          >
            {user?.name ? user.name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') : <UserIcon size={16} />}
          </button>
        </div>
      </div>
    </nav>
  );
};

const Layout = ({ children, user, currentView, onViewChange }) => {
  const { logout } = useAuth();
  const { isOnline } = useNetwork();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('rms_sidebar_collapsed');
    return saved === 'true';
  });
  const [notifications, setNotifications] = useState([]);
  const [showBell, setShowBell] = useState(false);
  const [syncPending, setSyncPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [actionAlert, setActionAlert] = useState(null);
  const [showOversightMenu, setShowOversightMenu] = useState(false);
  const [showDeptMoreMenu, setShowDeptMoreMenu] = useState(false);
  const [parentDeptLabel, setParentDeptLabel] = useState(user?.parentDeptName || null);

  useEffect(() => {
    if (!user?.isSubAccount || !user?.parentDeptId || user?.parentDeptName) return;
    getDepartments().then(depts => {
      const parent = depts.find(d => d.id === parseInt(user.parentDeptId));
      if (parent?.name) setParentDeptLabel(parent.name);
    }).catch(() => {});
  }, [user?.parentDeptId, user?.parentDeptName, user?.isSubAccount]);

  useEffect(() => {
    const fetchNotifs = async () => {
      try {
        const data = await getNotifications();
        setNotifications(data);
      } catch (err) { console.error("Notif fetch error:", err); }
    };
    fetchNotifs();
    // Fallback poll — catches anything SSE misses (e.g. reconnect gaps)
    const interval = setInterval(fetchNotifs, 30000);
    return () => clearInterval(interval);
  }, []);

  // Global SSE — refresh notification bell instantly on any requisition update
  useEffect(() => {
    if (!localStorage.getItem('rms_user')) return;
    let es;
    let reconnectTimer;
    let closed = false;
    const connect = async () => {
      if (closed) return;
      try {
        const { ticket } = await authAPI.getSseTicket();
        if (closed) return;
        es = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);
        es.addEventListener('requisition_updated', () => {
          getNotifications().then(data => setNotifications(data)).catch(() => {});
        });
        es.addEventListener('chat_message', (e) => {
          window.dispatchEvent(new CustomEvent('rms:chatMessage', { detail: e.data }));
          // Skip notification refresh for edit events (no new notif created)
          try { if (JSON.parse(e.data)?._action === 'edit') return; } catch {}
          getNotifications().then(data => setNotifications(data)).catch(() => {});
        });
        es.onerror = () => {
          if (closed) return;
          es.close();
          reconnectTimer = setTimeout(connect, 8000);
        };
      } catch {
        if (!closed) reconnectTimer = setTimeout(connect, 15000);
      }
    };
    connect();
    return () => { closed = true; es?.close(); clearTimeout(reconnectTimer); };
  }, []);

  const [deptStatus, setDeptStatus] = useState({ isReady: true });
  useEffect(() => {
    if (user?.role === 'department') {
      const checkStats = async () => {
        try {
          const profile = await reqAPI.getDeptProfile();
          setDeptStatus({ isReady: profile.hasSignature && profile.headName && profile.headEmail });
        } catch (e) { }
      };
      checkStats();
    }
  }, [user]);

  useEffect(() => {
    const checkActions = async () => {
      if (!user?.deptId) return;
      try {
        const all = await getRequisitions();
        const userDeptId = Number(user.deptId);
        const userDeptName = user.departmentName || '';
        const isAdmin = normalizeRole(user.role) === 'global_admin';
        const isExecutive = isAdmin ||
          /ceo|chairman/i.test(userDeptName) ||
          /general\s*manager|\bgm\b/i.test(userDeptName);

        // Items actively waiting for MY action (Red Pulse: folder is on your desk)
        const pendingForMe = all.filter(r => {
          const isTargeted = Number(r.targetDepartmentId) === userDeptId && r.status === 'pending' && (!r.finalApprovalStatus || r.finalApprovalStatus === 'none');
          const needsFinal = isExecutive && r.status === 'approved' && (!r.finalApprovalStatus || r.finalApprovalStatus === 'none');
          const isVetting = Number(r.currentVettingDeptId) === userDeptId && r.finalApprovalStatus === 'vetting';
          return isTargeted || needsFinal || isVetting;
        });

        if (pendingForMe.length > 0) {
          const firstPending = pendingForMe[0];
          // Red Pulse Alert: folder is on your desk for your signature
          setActionAlert({
            urgency: 'critical',
            count: pendingForMe.length,
            mode: 'desk',
            view: isMemoRecord(firstPending) ? 'memos' : 'requisitions',
            reqId: isMemoRecord(firstPending) ? null : firstPending?.id
          });
        } else {
          // Amber Alert: check if you have urgent in-flight items pending someone else's input
          const urgentElsewhere = all.filter(r => {
            const submittedByMe = Number(r.departmentId) === userDeptId;
            const isInFlight = r.status === 'pending' ||
              (r.finalApprovalStatus && !['treated', 'published', 'none'].includes(r.finalApprovalStatus));
            const isUrgent = ['urgent', 'critical'].includes((r.urgency || '').toLowerCase());
            return submittedByMe && isInFlight && isUrgent;
          });

          if (urgentElsewhere.length > 0) {
            // Amber Alert: urgent folder pending someone else's input
            setActionAlert({ urgency: 'urgent', count: urgentElsewhere.length, mode: 'elsewhere' });
          } else {
            setActionAlert(null); // Neural Core Online: all clear
          }
        }
      } catch (err) {
        console.warn("Action check failed:", err);
      }
    };

    checkActions();
    const interval = setInterval(checkActions, 60000);
    window.addEventListener('requisitionUpdated', checkActions);
    return () => {
      clearInterval(interval);
      window.removeEventListener('requisitionUpdated', checkActions);
    };
  }, [user?.deptId]);

  // PWA push notification subscription — register/refresh on every login
  useEffect(() => {
    if (!user) return;
    const subscribeToPush = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      try {
        const { key } = await fetch('/api/push/vapid-public').then(r => r.json());
        if (!key) return; // VAPID not configured — skip silently

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        const appKey = (() => {
          const b64 = key.replace(/-/g, '+').replace(/_/g, '/');
          const raw = atob(b64);
          return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
        })();

        const reg = await navigator.serviceWorker.ready;
        // Reuse existing subscription or create a new one
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
        }

        // Always re-POST so the server has the latest deptId/userId binding
        const { endpoint, keys } = sub.toJSON();
        await fetch('/api/push/subscribe', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth })
        });
      } catch (_) {}
    };
    subscribeToPush();
  }, [user?.id]);

  useEffect(() => {
    const loadSync = async () => {
      const status = await getSyncQueueStatus();
      setSyncPending(status.pending || 0);
    };
    loadSync();
    const interval = setInterval(loadSync, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    const sync = async () => {
      setSyncing(true);
      await flushSyncQueue();
      const status = await getSyncQueueStatus();
      setSyncPending(status.pending || 0);
      setSyncing(false);
    };
    sync();
  }, [isOnline]);

  useEffect(() => {
    localStorage.setItem('rms_sidebar_collapsed', isCollapsed);
  }, [isCollapsed]);

  // ── Partial payment warning for Account dept ──────────────────────────────
  const _isAccountDept = /\baccount\b/i.test(user?.name || '');
  const [partialCount, setPartialCount] = useState(0);
  useEffect(() => {
    if (!_isAccountDept || !user?.deptId) return;
    const userDeptId = Number(user.deptId);
    const fetchPartials = async () => {
      try {
        const all = await getRequisitions({ scope: 'all' });
        const count = all.filter(r =>
          r.finalApprovalStatus === 'partial' &&
          (Number(r.currentVettingDeptId) === userDeptId || Number(r.treatedByDeptId) === userDeptId)
        ).length;
        setPartialCount(count);
      } catch { /* silent */ }
    };
    fetchPartials();
    const t = setInterval(fetchPartials, 60000);
    return () => clearInterval(t);
  }, [_isAccountDept, user?.deptId]);

  const [hrPortalOpen, setHrPortalOpen] = useState(false);
  const [mobileHrOpen, setMobileHrOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showAppModal, setShowAppModal] = useState(false);

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setDeferredPrompt(null);
  };
  const [hrPortalEnabled, setHrPortalEnabled] = useState(null);
  const [hrPortalAdminEnabled, setHrPortalAdminEnabled] = useState(null);
  const [studioEnabled, setStudioEnabled] = useState(null);
  const [storeRecordsEnabled, setStoreRecordsEnabled] = useState(null);
  // Starts `null` (unknown) so the Oversight button stays hidden until the real setting
  // loads — defaulting to `true` would flash the button then hide it if disabled.
  const [iccOversightEnabled, setIccOversightEnabled] = useState(null);
  const [chatDeepLink, setChatDeepLink] = useState(null);

  useEffect(() => {
    // Each flag falls back to its last known good cached value on a network failure —
    // never blindly to "enabled" — so a feature an admin disabled doesn't get exposed
    // just because the device went offline or the network hiccuped.
    const loadFeatureFlags = async () => {
      const [hr, hrAdmin, studio, store, iccOversight] = await Promise.all([
        loadFeatureFlag('hr_portal_enabled'),
        loadFeatureFlag('hr_portal_admin_enabled'),
        loadFeatureFlag('document_studio_enabled'),
        loadFeatureFlag('store_records_enabled'),
        loadFeatureFlag('icc_oversight_enabled'),
      ]);
      setHrPortalEnabled(hr);
      setHrPortalAdminEnabled(hrAdmin);
      setStudioEnabled(studio);
      setStoreRecordsEnabled(store);
      setIccOversightEnabled(iccOversight);
    };
    loadFeatureFlags();
    window.addEventListener('rms:flags:updated', loadFeatureFlags);
    return () => window.removeEventListener('rms:flags:updated', loadFeatureFlags);
  }, []);

  const toggleSidebar = () => setIsCollapsed(!isCollapsed);
  const isAdminRole  = user?.role === 'global_admin';
  const sidebarBg    = isAdminRole ? 'bg-[#0f172a]' : 'bg-[#206e33]';
  const isHRDept    = /\bhr\b|human\s*resource/i.test(user?.name || '');
  const isStoreDept = /\bstore\b/i.test(user?.name || '') || /\bstore\b/i.test(user?.parentDeptName || '');
  const isIccDept   = /\bicc\b|internal.*control|control.*compliance/i.test(user?.name || '');
  const showHRPortal     = user?.role === 'global_admin'
    ? hrPortalAdminEnabled
    : (user?.role === 'hr' || isHRDept) && hrPortalEnabled;
  const showStoreRecords = (user?.role === 'global_admin' || isStoreDept) && storeRecordsEnabled;

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-foreground selection:bg-primary/30 font-sans antialiased overflow-x-hidden">
      <Navbar
        user={user}
        toggleSidebar={toggleSidebar}
        isCollapsed={isCollapsed}
        notifications={notifications}
        setNotifications={setNotifications}
        showBell={showBell}
        setShowBell={setShowBell}
        onLogout={logout}
        onViewChange={onViewChange}
        currentView={currentView}
        actionAlert={actionAlert}
        onChatDeepLink={setChatDeepLink}
        parentDeptLabel={parentDeptLabel}
      />

      {/* Persistent offline banner — always visible while disconnected */}
      {!isOnline && (
        <div className="bg-red-600 text-white text-xs font-bold px-4 py-2 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <WifiOff size={13} className="shrink-0" />
            Offline — you&apos;re viewing cached data. All actions are queued and will sync automatically when reconnected.
          </span>
          {syncPending > 0 && (
            <span className="shrink-0 bg-white/20 border border-white/30 px-2 py-0.5 rounded-full text-[10px] font-black tracking-wide">
              {syncPending} queued
            </span>
          )}
        </div>
      )}

      {syncPending > 0 && isOnline && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-xs font-bold px-4 py-2 flex items-center justify-between">
          <span>{syncPending} item(s) pending sync</span>
          <button
            onClick={async () => {
              if (syncing) return;
              setSyncing(true);
              await flushSyncQueue({ force: true });
              const status = await getSyncQueueStatus();
              setSyncPending(status.pending || 0);
              setSyncing(false);
            }}
            className="flex items-center space-x-2 px-3 py-1 rounded-full border border-amber-300 hover:bg-amber-100 text-[10px] uppercase tracking-widest"
          >
            <RefreshCcw size={12} className={syncing ? 'animate-spin' : ''} />
            <span>{syncing ? 'Syncing' : 'Sync Now'}</span>
          </button>
        </div>
      )}

      <div className="flex h-[calc(100vh-56px)] overflow-hidden">
        {/* Desktop Sidebar App-Tile Navigation */}
        <aside
          className={`border-r border-white/5 ${sidebarBg} sticky top-0 hidden lg:flex flex-col transition-all duration-500 cubic-bezier(0.4, 0, 0.2, 1) ${isCollapsed ? 'w-20' : 'w-64'}`}
        >
          {/* Collapsed-only logo mark */}
          {isCollapsed && (
            <div className="flex items-center justify-center pt-5 pb-4 border-b border-white/5 shrink-0">
              <div className="w-11 h-11 rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-lg shadow-black/30">
                <img src="/CSS_Group.png" alt="CSS Group" className="w-full h-full object-cover object-center" />
              </div>
            </div>
          )}
          <div className="p-4 pt-6 flex-1 overflow-y-auto custom-scrollbar overflow-x-hidden">
            <div className="space-y-2">
              {!isCollapsed && (
                <p className="px-4 text-[9px] font-black text-white/30 uppercase tracking-[0.25em] mb-4 ml-1 animate-in fade-in slide-in-from-left-2 duration-700">
                  Main Network
                </p>
              )}
              <SidebarItem icon={LayoutDashboard} label="Dashboard" active={currentView === 'dashboard'} onClick={() => onViewChange('dashboard')} isCollapsed={isCollapsed} />
              <SidebarItem icon={ClipboardCheck} label="Requisitions" active={currentView === 'requisitions'} onClick={() => onViewChange('requisitions')} isCollapsed={isCollapsed} badge={partialCount} />

              {user?.role === 'department' && (
                <SidebarItem
                  icon={deptStatus.isReady ? Building2 : ShieldAlert}
                  label="Profile"
                  active={currentView === 'dept_profile'}
                  onClick={() => onViewChange('dept_profile')}
                  isCollapsed={isCollapsed}
                />
              )}

              {(user?.role === 'department' && !user?.isSubAccount) || user?.role === 'global_admin' ? (
                <SidebarItem
                  icon={GitBranch}
                  label="Sub-Accounts"
                  active={currentView === 'sub_accounts'}
                  onClick={() => onViewChange('sub_accounts')}
                  isCollapsed={isCollapsed}
                />
              ) : null}

              <SidebarItem icon={FileText} label="MEMO" active={currentView === 'memos'} onClick={() => onViewChange('memos')} isCollapsed={isCollapsed} />
              <SidebarItem icon={History} label="My Activity" active={currentView === 'activity'} onClick={() => onViewChange('activity')} isCollapsed={isCollapsed} />
              {studioEnabled && (
                <SidebarItem icon={PenTool} label="Studio" active={currentView === 'document_studio'} onClick={() => onViewChange('document_studio')} isCollapsed={isCollapsed} />
              )}
              {showStoreRecords && (
                <SidebarItem icon={Package} label="Store Records" active={currentView === 'store_records'} onClick={() => onViewChange('store_records')} isCollapsed={isCollapsed} />
              )}
              {isIccDept && iccOversightEnabled && (
                <SidebarItem icon={ScanEye} label="Oversight" active={currentView === 'icc_oversight'} onClick={() => onViewChange('icc_oversight')} isCollapsed={isCollapsed} />
              )}
            </div>

            {isCollapsed && <div className="mt-5 mb-1 flex items-center justify-center"><div className="w-5 h-px bg-white/10" /></div>}

            {showHRPortal && (
              <div className={isCollapsed ? 'mt-1 space-y-1' : 'mt-10 space-y-1'}>
                {/* HR Portal toggle button */}
                <button
                  onClick={() => setHrPortalOpen(v => !v)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all text-white/70 hover:text-white hover:bg-white/10 ${hrPortalOpen ? 'bg-white/10 text-white' : ''}`}
                >
                  <HeartHandshake size={18} className="shrink-0" />
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 text-left text-[11px] font-black uppercase tracking-[0.15em]">HR Portal</span>
                      <ChevronDown size={14} className={`transition-transform duration-200 ${hrPortalOpen ? 'rotate-180' : ''}`} />
                    </>
                  )}
                </button>
                {/* Collapsible items */}
                {hrPortalOpen && (
                  <div className="space-y-1 pl-2 animate-in slide-in-from-top-1 duration-200">
                    <SidebarItem icon={HeartHandshake} label="HR Overview" active={currentView === 'hr_dashboard'} onClick={() => onViewChange('hr_dashboard')} isCollapsed={isCollapsed} />
                    <SidebarItem icon={Users} label="Employees" active={currentView === 'hr_employees'} onClick={() => onViewChange('hr_employees')} isCollapsed={isCollapsed} />
                    <SidebarItem icon={CalendarDays} label="Leave" active={currentView === 'hr_leaves'} onClick={() => onViewChange('hr_leaves')} isCollapsed={isCollapsed} />
                    <SidebarItem icon={Clock} label="Attendance" active={currentView === 'hr_attendance'} onClick={() => onViewChange('hr_attendance')} isCollapsed={isCollapsed} />
                    <SidebarItem icon={DollarSign} label="Payroll" active={currentView === 'hr_payroll'} onClick={() => onViewChange('hr_payroll')} isCollapsed={isCollapsed} />
                    <SidebarItem icon={UserPlus} label="Recruitment" active={currentView === 'hr_recruitment'} onClick={() => onViewChange('hr_recruitment')} isCollapsed={isCollapsed} />
                  </div>
                )}
              </div>
            )}

            {user?.role !== 'department' && user?.role !== 'hr' && (
              <div className={isCollapsed ? 'mt-1 space-y-2' : 'mt-10 space-y-2'}>
                {isCollapsed && <div className="mt-2 mb-1 flex items-center justify-center"><div className="w-5 h-px bg-white/10" /></div>}
                {!isCollapsed && (
                  <p className="px-4 text-[9px] font-black text-white/30 uppercase tracking-[0.25em] mb-4 ml-1 animate-in fade-in slide-in-from-left-2 duration-700">
                    Oversight Center
                  </p>
                )}
                <SidebarItem icon={Settings} label="System Settings" active={currentView === 'workflow_builder'} onClick={() => onViewChange('workflow_builder')} isCollapsed={isCollapsed} />
                <SidebarItem icon={Briefcase} label="Departments" active={currentView === 'department_manager'} onClick={() => onViewChange('department_manager')} isCollapsed={isCollapsed} />
                <SidebarItem icon={Activity} label="System Audit" active={currentView === 'audit_logs'} onClick={() => onViewChange('audit_logs')} isCollapsed={isCollapsed} />
                <SidebarItem icon={BookOpen} label="Documentation" active={currentView === 'documentation'} onClick={() => onViewChange('documentation')} isCollapsed={isCollapsed} />
              </div>
            )}
          </div>

          <div className="p-3 border-t border-border/20 mb-2 space-y-1">
            <SidebarItem icon={Smartphone} label="Applications" onClick={() => setShowAppModal(true)} isCollapsed={isCollapsed} />
            <button
              onClick={toggleSidebar}
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={`w-full flex items-center rounded-2xl px-3 py-2.5 text-white/30 hover:text-white/60 hover:bg-white/5 transition-all duration-300 group ${isCollapsed ? 'justify-center mx-1' : 'gap-4 mx-1'}`}
            >
              {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              {!isCollapsed && <span className="font-bold text-[13px] tracking-tight">Collapse</span>}
            </button>
            <SidebarItem icon={LogOut} label="Log Out" onClick={logout} isCollapsed={isCollapsed} />
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto custom-scrollbar relative z-10 w-full bg-[#FAF9F6]/50">
          <div className="rms-app-content p-3 lg:p-5 max-w-full mx-auto animate-slide-up">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Nav — full-width bar anchored to device bottom */}
      <div className="fixed bottom-0 left-0 right-0 lg:hidden z-[100] animate-in slide-in-from-bottom-5 duration-500">

        {/* ── HR sub-nav row: slides up above main nav when HR is toggled ── */}
        {showHRPortal && mobileHrOpen && (
          <div className={`${sidebarBg} border-t border-white/20 flex items-center px-1 py-1 animate-in slide-in-from-bottom-2 duration-200`}>
            {[
              { icon: HeartHandshake, label: 'Overview',   view: 'hr_dashboard' },
              { icon: Users,          label: 'Employees',  view: 'hr_employees' },
              { icon: CalendarDays,   label: 'Leave',      view: 'hr_leaves' },
              { icon: Clock,          label: 'Attendance', view: 'hr_attendance' },
              { icon: DollarSign,     label: 'Payroll',    view: 'hr_payroll' },
              { icon: UserPlus,       label: 'Recruit',    view: 'hr_recruitment' },
            ].map(({ icon: Icon, label, view }) => (
              <button
                key={view}
                onClick={() => { onViewChange(view); setMobileHrOpen(false); }}
                className={`flex-1 flex flex-col items-center justify-center py-2 px-1 rounded-xl transition-all active:scale-95 outline-none ${currentView === view ? 'text-[#f97316]' : 'text-white/70 hover:text-white'}`}
              >
                <Icon size={18} />
                <span className={`text-[8px] font-black mt-1 uppercase tracking-tighter ${currentView === view ? 'text-[#f97316]' : ''}`}>{label}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Main nav bar ── */}
        <nav className={`${sidebarBg} border-t border-white/10 flex items-center px-1 py-1 shadow-2xl shadow-black/40`}>
          {user?.role === 'department' ? (
            <>
              <SidebarItem icon={LayoutDashboard} label="Home" active={currentView === 'dashboard'} onClick={() => onViewChange('dashboard')} mobile />
              <SidebarItem icon={ClipboardCheck} label="Requests" active={currentView === 'requisitions'} onClick={() => onViewChange('requisitions')} mobile badge={partialCount} />
              <SidebarItem icon={FileText} label="MEMO" active={currentView === 'memos'} onClick={() => onViewChange('memos')} mobile />
              <SidebarItem icon={History} label="Activity" active={currentView === 'activity'} onClick={() => onViewChange('activity')} mobile />
              {!user?.isSubAccount && (
                <SidebarItem icon={GitBranch} label="Sub-Units" active={currentView === 'sub_accounts'} onClick={() => onViewChange('sub_accounts')} mobile />
              )}
              {studioEnabled && (
                <SidebarItem icon={PenTool} label="Studio" active={currentView === 'document_studio'} onClick={() => onViewChange('document_studio')} mobile />
              )}
              {showStoreRecords && (
                <SidebarItem icon={Package} label="Store" active={currentView === 'store_records'} onClick={() => onViewChange('store_records')} mobile />
              )}
              {isIccDept && iccOversightEnabled && (
                <SidebarItem icon={ScanEye} label="Oversight" active={currentView === 'icc_oversight'} onClick={() => onViewChange('icc_oversight')} mobile />
              )}
              <SidebarItem icon={deptStatus.isReady ? Building2 : ShieldAlert} label="Profile" active={currentView === 'dept_profile'} onClick={() => onViewChange('dept_profile')} mobile />
              <SidebarItem icon={Smartphone} label="Apps" onClick={() => setShowAppModal(true)} mobile />
            </>
          ) : showHRPortal && user?.role !== 'global_admin' ? (
            // Pure HR role — main nav IS the HR sections
            <>
              <SidebarItem icon={HeartHandshake} label="Overview" active={currentView === 'hr_dashboard'} onClick={() => onViewChange('hr_dashboard')} mobile />
              <SidebarItem icon={Users} label="Employees" active={currentView === 'hr_employees'} onClick={() => onViewChange('hr_employees')} mobile />
              <SidebarItem icon={CalendarDays} label="Leave" active={currentView === 'hr_leaves'} onClick={() => onViewChange('hr_leaves')} mobile />
              <SidebarItem icon={Clock} label="Attendance" active={currentView === 'hr_attendance'} onClick={() => onViewChange('hr_attendance')} mobile />
              <SidebarItem icon={DollarSign} label="Payroll" active={currentView === 'hr_payroll'} onClick={() => onViewChange('hr_payroll')} mobile />
              <SidebarItem icon={UserPlus} label="Recruit" active={currentView === 'hr_recruitment'} onClick={() => onViewChange('hr_recruitment')} mobile />
              <SidebarItem icon={Smartphone} label="Apps" onClick={() => setShowAppModal(true)} mobile />
            </>
          ) : (
            // Global admin — full admin nav; HR button toggles the sub-nav row above
            <>
              <SidebarItem icon={LayoutDashboard} label="Home" active={currentView === 'dashboard'} onClick={() => onViewChange('dashboard')} mobile />
              <SidebarItem icon={ClipboardCheck} label="Requests" active={currentView === 'requisitions'} onClick={() => onViewChange('requisitions')} mobile />
              <SidebarItem icon={GitBranch} label="Sub-Units" active={currentView === 'sub_accounts'} onClick={() => onViewChange('sub_accounts')} mobile />
              <SidebarItem icon={FileText} label="MEMO" active={currentView === 'memos'} onClick={() => onViewChange('memos')} mobile />
              <SidebarItem icon={History} label="Activity" active={currentView === 'activity'} onClick={() => onViewChange('activity')} mobile />
              {showHRPortal && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setMobileHrOpen(v => !v)}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setMobileHrOpen(v => !v)}
                  className={`flex-1 flex flex-col items-center justify-center py-2 px-1 rounded-2xl cursor-pointer transition-all active:scale-95 outline-none ${mobileHrOpen || currentView?.startsWith('hr_') ? 'text-[#f97316]' : 'text-white'}`}
                >
                  <div className="relative">
                    <HeartHandshake size={20} />
                    <ChevronDown size={10} className={`absolute -bottom-1 -right-1 transition-transform duration-200 ${mobileHrOpen ? 'rotate-180' : ''}`} />
                  </div>
                  <span className={`text-[9px] font-black mt-1.5 uppercase tracking-tighter ${mobileHrOpen || currentView?.startsWith('hr_') ? 'text-[#f97316]' : 'text-white'}`}>HR</span>
                </div>
              )}
              {studioEnabled && (
                <SidebarItem icon={PenTool} label="Studio" active={currentView === 'document_studio'} onClick={() => onViewChange('document_studio')} mobile />
              )}
              {showStoreRecords && (
                <SidebarItem icon={Package} label="Store" active={currentView === 'store_records'} onClick={() => onViewChange('store_records')} mobile />
              )}
              <SidebarItem icon={Settings} label="System" active={currentView === 'workflow_builder'} onClick={() => onViewChange('workflow_builder')} mobile />
              <SidebarItem icon={Briefcase} label="Depts" active={currentView === 'department_manager'} onClick={() => onViewChange('department_manager')} mobile />
              <SidebarItem icon={Activity} label="Audit" active={currentView === 'audit_logs'} onClick={() => onViewChange('audit_logs')} mobile />
              <SidebarItem icon={BookOpen} label="Docs" active={currentView === 'documentation'} onClick={() => onViewChange('documentation')} mobile />
              <SidebarItem icon={Smartphone} label="Apps" onClick={() => setShowAppModal(true)} mobile />
            </>
          )}
        </nav>
      </div>

      {showAppModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowAppModal(false)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-xl font-black text-[#0f172a] tracking-tight">Get the App</h2>
                <p className="text-sm text-[#64748b] mt-0.5">Install CSS Group RMS on your device</p>
              </div>
              <button
                onClick={() => setShowAppModal(false)}
                className="p-2 rounded-2xl hover:bg-black/5 transition-colors text-[#64748b] -mt-1 -mr-1"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <button
                onClick={handleInstallPWA}
                disabled={!deferredPrompt}
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[#0f172a] text-white hover:bg-[#1e293b] disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
              >
                <div className="p-2.5 rounded-xl bg-white/10 shrink-0">
                  <Smartphone size={20} />
                </div>
                <div className="text-left">
                  <p className="font-bold text-sm">Get PWA App</p>
                  <p className="text-xs text-white/60">
                    {deferredPrompt ? 'Install directly from your browser' : 'Already installed or use browser menu'}
                  </p>
                </div>
              </button>
              <a
                href="/api/downloads/cssrms.apk"
                download
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[#206e33] text-white hover:bg-[#1a5a2a] transition-all active:scale-[0.98] no-underline"
              >
                <div className="p-2.5 rounded-xl bg-white/10 shrink-0">
                  <Download size={20} />
                </div>
                <div className="text-left">
                  <p className="font-bold text-sm">Get APK for Android</p>
                  <p className="text-xs text-white/60">Direct download for Android devices</p>
                </div>
              </a>
              <div className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[#f1f5f9] text-[#94a3b8] cursor-not-allowed">
                <div className="p-2.5 rounded-xl bg-[#e2e8f0] shrink-0">
                  <Smartphone size={20} />
                </div>
                <div className="text-left">
                  <p className="font-bold text-sm text-[#94a3b8]">iOS App</p>
                  <p className="text-xs text-[#94a3b8]">Coming Soon</p>
                </div>
                <span className="ml-auto text-[10px] font-black bg-[#e2e8f0] text-[#94a3b8] px-2.5 py-1 rounded-full uppercase tracking-wide shrink-0">Soon</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <ChatWidget
        initialDeepLink={chatDeepLink}
        onDeepLinkConsumed={() => setChatDeepLink(null)}
      />
    </div>
  );
};

export default Layout;
