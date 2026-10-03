import { useState, useEffect } from 'react';
import {
  Plus, Users, KeyRound, ToggleLeft, ToggleRight, Pencil, X,
  Check, Loader2, Copy, UserPlus, UserMinus,
  ShieldAlert, Building2, ChevronDown, ChevronUp, ShieldCheck, Award, Trash2,
  FileText, User, Mail, Hash, Clock, Route, Globe, Lock, ArrowUp, ArrowDown, Crown
} from 'lucide-react';
import { subAccountAPI, deptAPI } from '../lib/api';
import { loadFeatureFlag } from '../lib/featureFlag';
import { toast } from 'react-hot-toast';

// ── tiny helpers ──────────────────────────────────────────────────────────────
const Badge = ({ children, color = 'gray' }) => {
  const colors = {
    green:  'bg-green-50 text-green-700 border-green-200',
    red:    'bg-red-50 text-red-600 border-red-200',
    gray:   'bg-gray-50 text-gray-500 border-gray-200',
    blue:   'bg-blue-50 text-blue-700 border-blue-200',
  };
  return (
    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${colors[color]}`}>
      {children}
    </span>
  );
};

// ── Code reveal box ──────────────────────────────────────────────────────────
const CodeBox = ({ code, onDismiss }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="mt-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-2">
      <p className="text-[10px] font-black text-amber-700 uppercase tracking-wider">Access Code — Copy now, it won't show again</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-lg font-black text-amber-900 tracking-[0.25em] bg-white border border-amber-200 rounded-xl px-4 py-2 text-center select-all">
          {code}
        </code>
        <button onClick={copy} className="p-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white transition-colors">
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
      <button onClick={onDismiss} className="w-full text-[10px] font-semibold text-amber-600 hover:text-amber-800 transition-colors text-center mt-1">
        I've saved the code — dismiss
      </button>
    </div>
  );
};

// ── User manager for one sub-account ────────────────────────────────────────
const UserManager = ({ sub, availableUsers, onRefresh }) => {
  const [assigning, setAssigning] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState('');

  const unassigned = availableUsers.filter(u => u.departmentId !== sub.id);
  const assigned = sub.users || [];

  const assign = async () => {
    if (!selectedUserId) return;
    setAssigning(selectedUserId);
    try {
      await subAccountAPI.assignUser(sub.id, selectedUserId);
      toast.success('User assigned.');
      setSelectedUserId('');
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to assign user.');
    } finally { setAssigning(null); }
  };

  const remove = async (userId) => {
    setRemoving(userId);
    try {
      await subAccountAPI.removeUser(sub.id, userId);
      toast.success('User removed from sub-account.');
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to remove user.');
    } finally { setRemoving(null); }
  };

  return (
    <div className="mt-4 space-y-3">
      {assigned.length === 0 ? (
        <p className="text-[11px] text-muted-foreground text-center py-3 italic">No staff assigned yet.</p>
      ) : (
        <div className="space-y-1.5">
          {assigned.map(u => (
            <div key={u.id} className="flex items-center justify-between px-3 py-2 bg-muted/30 rounded-xl border border-border/30">
              <div>
                <p className="text-[12px] font-semibold text-foreground">{u.name}</p>
                <p className="text-[10px] text-muted-foreground">{u.email}</p>
              </div>
              <button
                onClick={() => remove(u.id)}
                disabled={removing === u.id}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-40"
                title="Remove from sub-account"
              >
                {removing === u.id ? <Loader2 size={13} className="animate-spin" /> : <UserMinus size={13} />}
              </button>
            </div>
          ))}
        </div>
      )}

      {unassigned.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={selectedUserId}
            onChange={e => setSelectedUserId(e.target.value)}
            className="flex-1 text-xs border border-border/50 rounded-xl px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">— Select a staff member —</option>
            {unassigned.map(u => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
          <button
            onClick={assign}
            disabled={!selectedUserId || !!assigning}
            className="p-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-40"
          >
            {assigning ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
          </button>
        </div>
      )}
    </div>
  );
};

// ── Toggle switch ─────────────────────────────────────────────────────────────
const Toggle = ({ on, onChange, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    onClick={() => !disabled && onChange(!on)}
    disabled={disabled}
    className={`relative inline-flex items-center shrink-0 rounded-full border-2 border-transparent transition-all duration-200 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${
      on
        ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]'
        : 'bg-gray-200'
    }`}
    style={{ width: 44, height: 24 }}
  >
    <span className={`inline-block rounded-full bg-white shadow-sm transition-transform duration-200 ${on ? 'translate-x-[20px]' : 'translate-x-0'}`}
      style={{ width: 20, height: 20 }} />
  </button>
);

// ── Privilege editor for one sub-account ─────────────────────────────────────
const PrivilegeEditor = ({ sub, onUpdatePrivilege }) => {
  const [cashOn, setCashOn]             = useState(!!sub.cashPrivilege || sub.privilegeAmount != null);
  const [cashInput, setCashInput]       = useState(sub.privilegeAmount != null ? String(sub.privilegeAmount) : '');
  const [editingCash, setEditingCash]   = useState(false);
  const [approvalInput, setApprovalInput]     = useState(sub.approvalLimit != null ? String(sub.approvalLimit) : '');
  const [editingApproval, setEditingApproval] = useState(false);
  const [savingApproval, setSavingApproval]   = useState(false);
  const [memoOn, setMemoOn]             = useState(!!sub.memoPrivilege);
  const [materialOn, setMaterialOn]     = useState(!!sub.materialPrivilege);
  const [seeHeadReqs, setSeeHeadReqs]   = useState(!!sub.canSeeHeadReqs);
  const [seeHeadMemos, setSeeHeadMemos] = useState(!!sub.canSeeHeadMemos);
  const [savingCash, setSavingCash]     = useState(false);
  const [savingToggles, setSavingToggles] = useState(false);

  // Direct route state
  const [directRouteOn, setDirectRouteOn]           = useState(!!sub.directRoute);
  // pendingDirectRoute: toggle is visually ON but NOT yet saved — waiting for ≥1 dept selection
  const [pendingDirectRoute, setPendingDirectRoute] = useState(false);
  const [allowedDeptIds, setAllowedDeptIds]         = useState(Array.isArray(sub.allowedRouteDeptIds) ? sub.allowedRouteDeptIds : []);
  const [allDepts, setAllDepts]                     = useState([]);
  const [loadingDepts, setLoadingDepts]             = useState(false);
  const [savingRoute, setSavingRoute]               = useState(false);
  const [selectedDeptToAdd, setSelectedDeptToAdd]   = useState('');

  // ── Context-aware handling limit labels based on parent dept role ─────────
  const parentName = sub.parentDept?.name || '';
  const isAuditParent   = /\baudit\b/i.test(parentName);
  const isAccountParent = /\baccount\b/i.test(parentName);
  // Everything else (HR, GM, CEO, MD, Chairman, etc.) is a threshold/approver dept
  const handlingLabel = isAuditParent ? 'Vetting Limit'
    : isAccountParent ? 'Treatment Limit'
    : 'Approval Limit';
  const handlingDesc = isAuditParent
    ? 'Max request amount they can vet on your behalf'
    : isAccountParent
    ? 'Max request amount they can treat & process on your behalf'
    : `Max request amount they can approve on your behalf`;
  const handlingColor = isAuditParent ? 'text-purple-700'
    : isAccountParent ? 'text-emerald-700'
    : 'text-amber-700';
  const handlingRing = isAuditParent ? 'focus:ring-purple-200'
    : isAccountParent ? 'focus:ring-emerald-200'
    : 'focus:ring-amber-200';
  const handlingBtn = isAuditParent ? 'bg-purple-600 hover:bg-purple-700'
    : isAccountParent ? 'bg-emerald-600 hover:bg-emerald-700'
    : 'bg-amber-600 hover:bg-amber-700';
  const handlingNoAuth = isAuditParent ? 'No vetting authority set'
    : isAccountParent ? 'No treatment authority set'
    : 'No approval authority set';

  // Load departments when Direct Route is toggled on
  useEffect(() => {
    if (!directRouteOn || allDepts.length > 0) return;
    setLoadingDepts(true);
    deptAPI.getDepartments()
      .then(d => setAllDepts((Array.isArray(d) ? d : []).filter(dept => !dept.isSubAccount && dept.name?.toLowerCase() !== 'super admin')))
      .catch(() => {})
      .finally(() => setLoadingDepts(false));
  }, [directRouteOn]);

  const fmt = n => n != null ? `₦${Number(n).toLocaleString()}` : null;

  // ── Shared helper: save a new allowed-dept list (also commits directRoute if pending) ──
  const saveAllowedDepts = async (nextIds, prevIds) => {
    setAllowedDeptIds(nextIds);
    setSelectedDeptToAdd('');
    setSavingRoute(true);
    try {
      const payload = { allowedRouteDeptIds: nextIds.length ? nextIds : null };
      if (pendingDirectRoute) payload.directRoute = true;
      await subAccountAPI.setPrivilege(sub.id, payload);
      if (pendingDirectRoute) {
        setPendingDirectRoute(false);
        onUpdatePrivilege({ directRoute: true, allowedRouteDeptIds: nextIds });
        toast.success('Direct routing enabled.');
      } else {
        onUpdatePrivilege({ allowedRouteDeptIds: nextIds });
        toast.success(nextIds.length > prevIds.length ? 'Department added.' : 'Department removed.');
      }
    } catch (err) {
      setAllowedDeptIds(prevIds); // revert
      if (pendingDirectRoute) setDirectRouteOn(false);
      toast.error(err?.response?.data?.error || 'Failed to update.');
    } finally { setSavingRoute(false); }
  };

  const saveCash = async () => {
    const trimmed = cashInput.trim();
    const amount = trimmed === '' ? null : parseFloat(trimmed.replace(/,/g, ''));
    if (trimmed !== '' && (isNaN(amount) || amount < 0)) {
      toast.error('Enter a valid positive amount, or leave blank to remove.'); return;
    }
    setSavingCash(true);
    try {
      await subAccountAPI.setPrivilege(sub.id, { maxAmount: amount });
      toast.success(amount == null ? 'Cash limit removed.' : `Cash limit set to ₦${amount.toLocaleString()}.`);
      setEditingCash(false);
      onUpdatePrivilege({ privilegeAmount: amount });
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update.');
    } finally { setSavingCash(false); }
  };

  const saveApproval = async () => {
    const trimmed = approvalInput.trim();
    const amount = trimmed === '' ? null : parseFloat(trimmed.replace(/,/g, ''));
    if (trimmed !== '' && (isNaN(amount) || amount < 0)) {
      toast.error('Enter a valid positive amount, or leave blank to remove.'); return;
    }
    setSavingApproval(true);
    try {
      await subAccountAPI.setPrivilege(sub.id, { approvalLimit: amount });
      toast.success(amount == null ? 'Handling limit removed.' : `Handling limit set to ₦${amount.toLocaleString()}.`);
      setEditingApproval(false);
      onUpdatePrivilege({ approvalLimit: amount });
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update.');
    } finally { setSavingApproval(false); }
  };

  const saveToggle = async (field, value, extraPayload = {}) => {
    setSavingToggles(true);
    const labels = { cashPrivilege: 'Cash', memoPrivilege: 'Memo', materialPrivilege: 'Material', canSeeHeadReqs: 'See head\'s requisitions', canSeeHeadMemos: 'See head\'s memos' };
    try {
      await subAccountAPI.setPrivilege(sub.id, { [field]: value, ...extraPayload });
      toast.success(`${labels[field] || field} requests ${value ? 'enabled' : 'disabled'}.`);
      onUpdatePrivilege({ [field]: value, ...extraPayload });
    } catch (err) {
      if (field === 'cashPrivilege') setCashOn(!value);
      if (field === 'memoPrivilege') setMemoOn(!value);
      if (field === 'materialPrivilege') setMaterialOn(!value);
      if (field === 'canSeeHeadReqs') setSeeHeadReqs(!value);
      if (field === 'canSeeHeadMemos') setSeeHeadMemos(!value);
      toast.error(err?.response?.data?.error || 'Failed to update.');
    } finally { setSavingToggles(false); }
  };

  const handleCashToggle = (v) => {
    setCashOn(v);
    if (!v) {
      setCashInput('');
      setEditingCash(false);
      setSavingToggles(true);
      subAccountAPI.setPrivilege(sub.id, { cashPrivilege: false, maxAmount: null, approvalLimit: null })
        .then(() => { toast.success('Cash requests disabled.'); onUpdatePrivilege({ cashPrivilege: false, privilegeAmount: null, approvalLimit: null }); setApprovalInput(''); })
        .catch(err => { setCashOn(true); toast.error(err?.response?.data?.error || 'Failed to disable cash requests.'); })
        .finally(() => setSavingToggles(false));
    } else {
      saveToggle('cashPrivilege', true);
    }
  };
  const handleMemoToggle = (v) => { setMemoOn(v); saveToggle('memoPrivilege', v); };
  const handleMaterialToggle = (v) => { setMaterialOn(v); saveToggle('materialPrivilege', v); };
  const handleSeeHeadReqsToggle = (v) => { setSeeHeadReqs(v); saveToggle('canSeeHeadReqs', v); };
  const handleSeeHeadMemosToggle = (v) => { setSeeHeadMemos(v); saveToggle('canSeeHeadMemos', v); };

  const handleDirectRouteToggle = async (v) => {
    if (v) {
      // Turning ON — only save immediately if dept list already has entries
      setDirectRouteOn(true);
      if (allowedDeptIds.length === 0) {
        // Enter pending state: show picker, don't save until ≥1 dept is chosen
        setPendingDirectRoute(true);
      } else {
        setSavingRoute(true);
        try {
          await subAccountAPI.setPrivilege(sub.id, { directRoute: true });
          toast.success('Direct routing enabled.');
          onUpdatePrivilege({ directRoute: true });
        } catch (err) {
          setDirectRouteOn(false);
          toast.error(err?.response?.data?.error || 'Failed to update routing setting.');
        } finally { setSavingRoute(false); }
      }
    } else {
      // Turning OFF
      if (pendingDirectRoute) {
        // Never saved — just revert local state, no API call
        setDirectRouteOn(false);
        setPendingDirectRoute(false);
      } else {
        setDirectRouteOn(false);
        setSavingRoute(true);
        try {
          await subAccountAPI.setPrivilege(sub.id, { directRoute: false });
          toast.success('Direct routing disabled — requests go through you first.');
          onUpdatePrivilege({ directRoute: false });
        } catch (err) {
          setDirectRouteOn(true);
          toast.error(err?.response?.data?.error || 'Failed to update routing setting.');
        } finally { setSavingRoute(false); }
      }
    }
  };

  // Called when user picks from the dropdown
  const handleDeptDropdownChange = (val) => {
    if (val === '__all__') {
      // "All Departments" — add every available dept at once
      const allIds = allDepts.map(d => d.id);
      const next = [...new Set([...allowedDeptIds, ...allIds])];
      if (next.length === allowedDeptIds.length) return; // nothing new
      saveAllowedDepts(next, allowedDeptIds);
    } else {
      setSelectedDeptToAdd(val);
    }
  };

  const addAllowedDept = () => {
    const id = parseInt(selectedDeptToAdd);
    if (!id || allowedDeptIds.includes(id)) return;
    saveAllowedDepts([...allowedDeptIds, id], allowedDeptIds);
  };

  const removeAllowedDept = (id) => {
    const next = allowedDeptIds.filter(d => d !== id);
    // Block removing last dept when direct route is already saved ON
    if (next.length === 0 && directRouteOn && !pendingDirectRoute) {
      toast.error('At least one department must remain. Disable direct routing first if you want to remove all.');
      return;
    }
    saveAllowedDepts(next, allowedDeptIds);
  };

  const availableDepts = allDepts.filter(d => !allowedDeptIds.includes(d.id));
  const allSelected    = allDepts.length > 0 && availableDepts.length === 0;

  return (
    <div className="mt-3 border-t border-border/20 pt-3 space-y-0">
      <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-2">
        <Award size={10} className="text-amber-500" /> Privilege Settings
      </p>

      {/* Cash Requests toggle + optional limit */}
      <div className="py-2 border-t border-border/10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-foreground">Cash Requests</p>
            <p className="text-[9px] text-muted-foreground/60">Can create &amp; handle cash requests</p>
          </div>
          <Toggle on={cashOn} onChange={handleCashToggle} disabled={savingToggles} />
        </div>
        {cashOn && (
          <div className="mt-2 pl-1 space-y-3">
            {/* ── Creation Limit ── */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-foreground/70 uppercase tracking-wide">Creation limit <span className="font-normal text-muted-foreground/40 normal-case">(optional)</span></span>
                {!editingCash && (
                  <button onClick={() => setEditingCash(true)} className="text-[10px] font-bold text-primary hover:underline">
                    {sub.privilegeAmount != null ? 'Edit' : 'Set'}
                  </button>
                )}
              </div>
              <p className="text-[9px] text-muted-foreground/50 italic">Max amount this unit can create a request for</p>
              {!editingCash ? (
                <p className="text-[11px] text-muted-foreground/70">
                  {sub.privilegeAmount != null
                    ? <><span className="font-black text-amber-700">≤ {fmt(sub.privilegeAmount)}</span> <span className="italic">per request</span></>
                    : <span className="italic text-muted-foreground/40">No limit set</span>}
                </p>
              ) : (
                <div className="flex gap-2 items-center">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-sm font-bold">₦</span>
                    <input type="number" min="0" step="any" value={cashInput}
                      onChange={e => setCashInput(e.target.value)} autoFocus placeholder="e.g. 80000"
                      onKeyDown={e => { if (e.key === 'Enter') saveCash(); if (e.key === 'Escape') setEditingCash(false); }}
                      className="w-full border border-border/50 rounded-xl pl-8 pr-3 py-1.5 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20" />
                  </div>
                  <button onClick={saveCash} disabled={savingCash} className="p-2 rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-40">
                    {savingCash ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  </button>
                  {sub.privilegeAmount != null && (
                    <button onClick={() => { setCashInput(''); saveCash(); }} disabled={savingCash}
                      title="Remove limit" className="p-2 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-40">
                      <Trash2 size={13} />
                    </button>
                  )}
                  <button onClick={() => setEditingCash(false)} className="p-2 rounded-xl border border-border/40 text-muted-foreground">
                    <X size={13} />
                  </button>
                </div>
              )}
            </div>

            {/* ── Handling Limit — label changes per parent dept role ── */}
            <div className="space-y-1 pt-2 border-t border-dashed border-border/20">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-foreground/70 uppercase tracking-wide">
                  {handlingLabel} <span className="font-normal text-muted-foreground/40 normal-case">(optional)</span>
                </span>
                {!editingApproval && (
                  <button onClick={() => setEditingApproval(true)} className="text-[10px] font-bold text-primary hover:bg-primary/8 border border-primary/25 px-2 py-0.5 rounded-lg transition-all">
                    {sub.approvalLimit != null ? 'Edit' : 'Set'}
                  </button>
                )}
              </div>
              <p className="text-[9px] text-muted-foreground/50 italic">{handlingDesc}</p>
              {!editingApproval ? (
                <p className="text-[11px] text-muted-foreground/70">
                  {sub.approvalLimit != null
                    ? <><span className={`font-black ${handlingColor}`}>≤ {fmt(sub.approvalLimit)}</span> <span className="italic">per request</span></>
                    : <span className="italic text-muted-foreground/40">{handlingNoAuth}</span>}
                </p>
              ) : (
                <div className="flex gap-2 items-center">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-sm font-bold">₦</span>
                    <input type="number" min="0" step="any" value={approvalInput}
                      onChange={e => setApprovalInput(e.target.value)} autoFocus placeholder="e.g. 30000"
                      onKeyDown={e => { if (e.key === 'Enter') saveApproval(); if (e.key === 'Escape') setEditingApproval(false); }}
                      className={`w-full border border-border/50 rounded-xl pl-8 pr-3 py-1.5 text-sm bg-white outline-none focus:ring-2 ${handlingRing}`} />
                  </div>
                  <button onClick={saveApproval} disabled={savingApproval} className={`p-2 rounded-xl ${handlingBtn} text-white disabled:opacity-40`}>
                    {savingApproval ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  </button>
                  {sub.approvalLimit != null && (
                    <button onClick={() => { setApprovalInput(''); saveApproval(); }} disabled={savingApproval}
                      title="Remove limit" className="p-2 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-40">
                      <Trash2 size={13} />
                    </button>
                  )}
                  <button onClick={() => setEditingApproval(false)} className="p-2 rounded-xl border border-border/40 text-muted-foreground">
                    <X size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Memo toggle */}
      <div className="flex items-center justify-between py-2 border-t border-border/10">
        <div>
          <p className="text-[11px] font-semibold text-foreground">Memo Requests</p>
          <p className="text-[9px] text-muted-foreground/60">Can create &amp; handle memo requests</p>
        </div>
        <Toggle on={memoOn} onChange={handleMemoToggle} disabled={savingToggles} />
      </div>

      {/* Material toggle */}
      <div className="flex items-center justify-between py-2 border-t border-border/10">
        <div>
          <p className="text-[11px] font-semibold text-foreground">Material Requests</p>
          <p className="text-[9px] text-muted-foreground/60">Can create &amp; handle material requests</p>
        </div>
        <Toggle on={materialOn} onChange={handleMaterialToggle} disabled={savingToggles} />
      </div>

      {/* See Head's Requisitions toggle */}
      <div className="flex items-center justify-between py-2 border-t border-border/10">
        <div>
          <p className="text-[11px] font-semibold text-foreground">See Head's Requisitions</p>
          <p className="text-[9px] text-muted-foreground/60">Can view all submitted cash &amp; material reqs from your desk</p>
        </div>
        <Toggle on={seeHeadReqs} onChange={handleSeeHeadReqsToggle} disabled={savingToggles} />
      </div>

      {/* See Head's Memos toggle */}
      <div className="flex items-center justify-between py-2 border-t border-border/10">
        <div>
          <p className="text-[11px] font-semibold text-foreground">See Head's Memos</p>
          <p className="text-[9px] text-muted-foreground/60">Can view all submitted memos from your desk</p>
        </div>
        <Toggle on={seeHeadMemos} onChange={handleSeeHeadMemosToggle} disabled={savingToggles} />
      </div>

      {/* Direct Route toggle + allowed departments */}
      <div className="py-2 border-t border-border/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1 rounded-lg ${directRouteOn ? (pendingDirectRoute ? 'bg-amber-50' : 'bg-blue-50') : 'bg-muted/40'}`}>
              {directRouteOn
                ? (pendingDirectRoute ? <Lock size={11} className="text-amber-500" /> : <Globe size={11} className="text-blue-600" />)
                : <Lock size={11} className="text-muted-foreground/60" />}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                Direct Routing
                {pendingDirectRoute && (
                  <span className="text-[8px] font-black uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                    Not saved
                  </span>
                )}
              </p>
              <p className="text-[9px] text-muted-foreground/60">
                {directRouteOn ? 'Can send requests directly to departments' : 'All requests route through you first'}
              </p>
            </div>
          </div>
          <Toggle on={directRouteOn} onChange={handleDirectRouteToggle} disabled={savingRoute} />
        </div>

        {/* Pending warning — shown when toggle is ON but no depts selected yet */}
        {pendingDirectRoute ? (
          <div className="mt-2 px-2.5 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-[9px] leading-relaxed">
            <span className="font-black">Action required —</span> Select at least one department below (or choose "All Departments") to save direct routing.
          </div>
        ) : (
          <div className={`mt-2 px-2.5 py-2 rounded-xl text-[9px] leading-relaxed ${directRouteOn ? 'bg-blue-50/60 border border-blue-100 text-blue-700' : 'bg-amber-50/60 border border-amber-100 text-amber-700'}`}>
            {directRouteOn
              ? <><span className="font-black">ON —</span> This unit can choose which department to send requests to directly.</>
              : <><span className="font-black">OFF —</span> Every request this unit creates will be automatically routed to you (the head) first.</>
            }
          </div>
        )}

        {/* Allowed departments — only when direct route is ON */}
        {directRouteOn && (
          <div className="mt-3 pl-1 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-foreground/70 flex items-center gap-1">
                <Route size={9} className="text-blue-500" /> Allowed Departments
                {pendingDirectRoute && <span className="text-red-500 ml-0.5">*</span>}
              </span>
              <span className={`text-[9px] italic font-semibold ${pendingDirectRoute && allowedDeptIds.length === 0 ? 'text-red-400' : 'text-muted-foreground/50'}`}>
                {allSelected
                  ? 'All departments'
                  : allowedDeptIds.length === 0
                    ? (pendingDirectRoute ? 'Required — pick at least one' : 'None')
                    : `${allowedDeptIds.length} selected`}
              </span>
            </div>

            {/* Selected dept chips */}
            {allowedDeptIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {allowedDeptIds.map(id => {
                  const dept = allDepts.find(d => d.id === id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 border border-blue-200 text-blue-700 text-[9px] font-bold">
                      {dept?.name || `Dept #${id}`}
                      <button onClick={() => removeAllowedDept(id)} disabled={savingRoute}
                        className="hover:text-red-500 disabled:opacity-40 transition-colors ml-0.5">
                        <X size={9} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Add department dropdown */}
            {loadingDepts ? (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 py-1">
                <Loader2 size={11} className="animate-spin" /> Loading departments…
              </div>
            ) : !allSelected ? (
              <div className="flex gap-2 items-center">
                <select
                  value={selectedDeptToAdd}
                  onChange={e => handleDeptDropdownChange(e.target.value)}
                  className={`flex-1 text-xs border rounded-xl px-3 py-1.5 bg-white outline-none focus:ring-2 transition-colors
                    ${pendingDirectRoute && allowedDeptIds.length === 0
                      ? 'border-amber-300 focus:ring-amber-200'
                      : 'border-border/50 focus:ring-primary/20'}`}
                >
                  <option value="">— Add a department —</option>
                  <option value="__all__">✓ All Departments</option>
                  {availableDepts.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <button
                  onClick={addAllowedDept}
                  disabled={!selectedDeptToAdd || selectedDeptToAdd === '__all__' || savingRoute}
                  className="p-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-all"
                  title="Add to allowed list"
                >
                  {savingRoute ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                </button>
              </div>
            ) : (
              <p className="text-[9px] text-blue-600 font-bold italic flex items-center gap-1">
                <Check size={10} /> All departments selected — unit can route to anyone.
              </p>
            )}

            <p className="text-[9px] text-muted-foreground/40 italic">
              Choose "All Departments" to allow any department, or add specific ones to restrict where this unit can send requests.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Single sub-account card ──────────────────────────────────────────────────
const SubAccountCard = ({ sub, availableUsers, onRefresh, onUpdatePrivilege, showParent = false, isAdmin = false, canManage = true, canSetPrivileges = true, canReorder = true, position = null, isFirst = false, isLast = false }) => {
  const [expanded, setExpanded] = useState(false);
  const [moving, setMoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(sub.name);
  const [editStaffId, setEditStaffId] = useState(sub.staffId || '');
  const [editEmail, setEditEmail] = useState(sub.headEmail || '');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newCode, setNewCode] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reqs, setReqs] = useState(null);
  const [loadingReqs, setLoadingReqs] = useState(false);

  const saveEdit = async () => {
    if (!editName.trim()) { setEditing(false); return; }
    const nameChanged = editName.trim() !== sub.name;
    const staffIdChanged = editStaffId.trim().toUpperCase() !== (sub.staffId || '');
    const emailChanged = editEmail.trim() !== (sub.headEmail || '');
    if (!nameChanged && !staffIdChanged && !emailChanged) { setEditing(false); return; }
    setSaving(true);
    try {
      await subAccountAPI.update(sub.id, {
        name: editName.trim(),
        staffId: editStaffId.trim().toUpperCase() || null,
        headEmail: editEmail.trim() || null,
      });
      toast.success('Sub-account updated.');
      onRefresh();
      setEditing(false);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update.');
    } finally { setSaving(false); }
  };

  const toggle = async () => {
    setToggling(true);
    try {
      await subAccountAPI.toggle(sub.id);
      toast.success(sub.isDisabled ? 'Sub-account enabled.' : 'Sub-account disabled.');
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to toggle.');
    } finally { setToggling(false); }
  };

  const resetCode = async () => {
    setResetting(true);
    try {
      const res = await subAccountAPI.resetCode(sub.id);
      setNewCode(res.accessCode);
      toast.success('New access code generated.');
      // Do NOT call onRefresh() here — it triggers setLoading(true) which unmounts this card
      // and destroys the newCode state before the user can copy it. Refresh happens on dismiss.
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to reset code.');
    } finally { setResetting(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await subAccountAPI.delete(sub.id);
      toast.success(`"${sub.name}" deleted. All its records are preserved.`);
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to delete sub-account.');
    } finally { setDeleting(false); setConfirmDelete(false); }
  };

  const move = async (direction) => {
    setMoving(true);
    try {
      await subAccountAPI.move(sub.id, direction, sub.parentDept?.id);
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to reorder.');
    } finally { setMoving(false); }
  };

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${sub.isDisabled ? 'border-red-200 opacity-75' : 'border-border/50'}`}>
      {/* Card header */}
      <div className="px-4 py-3 flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${sub.isDisabled ? 'bg-red-50 border border-red-200' : 'bg-primary/8 border border-primary/20'}`}>
          <Building2 size={16} className={sub.isDisabled ? 'text-red-400' : 'text-primary'} />
        </div>

        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }}
                  placeholder="Sub-account name"
                  className="flex-1 text-sm font-bold border border-primary/40 rounded-lg px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary/30"
                />
                <button onClick={saveEdit} disabled={saving} className="text-primary hover:text-primary/80 disabled:opacity-40">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                </button>
                <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground">
                  <X size={13} />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <Hash size={11} className="text-muted-foreground/50 shrink-0" />
                <input
                  value={editStaffId}
                  onChange={e => setEditStaffId(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }}
                  placeholder="Staff ID (e.g. CSS001)"
                  className="flex-1 text-xs border border-border/50 rounded-lg px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary/30 font-mono uppercase tracking-wider"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Mail size={11} className="text-muted-foreground/50 shrink-0" />
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }}
                  placeholder="Email for password reset notifications"
                  className="flex-1 text-xs border border-border/50 rounded-lg px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary/30 text-muted-foreground"
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {position != null && (
                <span className="text-[9px] font-black text-muted-foreground/50 bg-muted/40 rounded-md px-1.5 py-0.5">#{position}</span>
              )}
              <p className="text-sm font-bold text-foreground truncate">{sub.name}</p>
              <Badge color={sub.isDisabled ? 'red' : 'green'}>{sub.isDisabled ? 'Disabled' : 'Active'}</Badge>
              {sub.isActingHeadCandidate && (
                <span className="flex items-center gap-1 text-[9px] font-black uppercase text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">
                  <Crown size={10} /> Acting Head
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {showParent && sub.parentDept?.name && (
              <span className="text-[10px] text-violet-600 font-semibold">{sub.parentDept.name} ·</span>
            )}
            {sub.staffId && (
              <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-primary/70 bg-primary/8 px-1.5 py-0.5 rounded-md">
                {sub.staffId}
              </span>
            )}
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <User size={10} />
              {sub.headName
                ? <span className="font-semibold text-foreground/70">{sub.headName}</span>
                : <span className="italic text-muted-foreground/60">Not set yet</span>}
            </span>
            {sub.headEmail && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Mail size={10} />
                <span className="text-foreground/60 truncate max-w-[140px]">{sub.headEmail}</span>
              </span>
            )}
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <FileText size={10} />
              <span className={sub.reqCount > 0 ? 'font-bold text-primary' : ''}>
                {sub.reqCount} request{sub.reqCount !== 1 ? 's' : ''}
              </span>
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {canManage && (
            <>
              {canReorder && (
                <>
                  <button onClick={() => move('up')} disabled={moving || isFirst} title="Move up (more senior)" className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8 transition-all disabled:opacity-25 disabled:cursor-not-allowed">
                    <ArrowUp size={13} />
                  </button>
                  <button onClick={() => move('down')} disabled={moving || isLast} title="Move down (less senior)" className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8 transition-all disabled:opacity-25 disabled:cursor-not-allowed">
                    <ArrowDown size={13} />
                  </button>
                </>
              )}
              <button onClick={() => setEditing(true)} title="Rename" className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8 transition-all">
                <Pencil size={13} />
              </button>
              <button onClick={resetCode} disabled={resetting} title="Reset access code" className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-600 hover:bg-amber-50 transition-all disabled:opacity-40">
                {resetting ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
              </button>
              <button onClick={toggle} disabled={toggling} title={sub.isDisabled ? 'Enable' : 'Disable'} className="p-1.5 rounded-lg transition-all disabled:opacity-40 text-muted-foreground hover:text-foreground">
                {toggling ? <Loader2 size={13} className="animate-spin" /> : sub.isDisabled ? <ToggleLeft size={16} /> : <ToggleRight size={16} className="text-green-600" />}
              </button>
              <button onClick={() => setConfirmDelete(true)} title="Delete sub-account" className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-all">
                <Trash2 size={13} />
              </button>
            </>
          )}
          <button onClick={async () => {
            const next = !expanded;
            setExpanded(next);
            if (next && reqs === null) {
              setLoadingReqs(true);
              try { setReqs(await subAccountAPI.getRequisitions(sub.id)); }
              catch { setReqs([]); }
              finally { setLoadingReqs(false); }
            }
          }} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-all">
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Admin — current access code / password always visible */}
      {isAdmin && !newCode && sub.accessCodeLabel && (
        <div className={`px-4 pb-3 pt-2 flex items-center justify-between gap-3 border-t ${sub.codeChangedByDept ? 'bg-green-50/60 border-green-100' : 'bg-amber-50/60 border-amber-100'}`}>
          <div className="shrink-0">
            <span className={`text-[9px] font-black uppercase tracking-widest ${sub.codeChangedByDept ? 'text-green-700' : 'text-amber-700'}`}>
              {sub.codeChangedByDept ? 'Password' : 'Access Code'}
            </span>
            <p className={`text-[8px] ${sub.codeChangedByDept ? 'text-green-600/60' : 'text-amber-600/60'}`}>
              {sub.codeChangedByDept ? 'Self-set by user' : 'First-time code'}
            </p>
          </div>
          <code className={`font-mono text-sm font-black tracking-[0.25em] flex-1 text-center select-all ${sub.codeChangedByDept ? 'text-green-900' : 'text-amber-900'}`}>
            {sub.accessCodeLabel}
          </code>
          <button
            onClick={() => { navigator.clipboard.writeText(sub.accessCodeLabel); toast.success('Copied!'); }}
            className={`p-1.5 rounded-lg transition-all ${sub.codeChangedByDept ? 'text-green-600 hover:bg-green-100' : 'text-amber-600 hover:bg-amber-100'}`}
            title="Copy"
          >
            <Copy size={12} />
          </button>
        </div>
      )}

      {/* New code reveal — one-time for dept heads; also shown for admin after reset */}
      {newCode && (
        <div className="px-4 pb-3">
          <CodeBox code={newCode} onDismiss={() => { setNewCode(null); onRefresh(); }} />
        </div>
      )}

      {/* Expanded: requisitions + privileges */}
      {expanded && (
        <div className="border-t border-border/30">

          {/* ── Requisitions list ── */}
          <div className="px-4 pt-3 pb-3">
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <FileText size={11} /> Requests Created
            </p>
            {loadingReqs ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={16} className="animate-spin text-muted-foreground" />
              </div>
            ) : !reqs || reqs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/60 italic py-2 text-center">No requests created yet.</p>
            ) : (
              <div className="space-y-1.5">
                {reqs.map(r => {
                  const statusColor = {
                    draft: 'bg-gray-100 text-gray-500',
                    pending: 'bg-blue-50 text-blue-600',
                    approved: 'bg-green-50 text-green-700',
                    rejected: 'bg-red-50 text-red-600',
                    treated: 'bg-emerald-50 text-emerald-700',
                    published: 'bg-violet-50 text-violet-700',
                  }[r.status?.toLowerCase()] || 'bg-gray-100 text-gray-500';
                  const typeColor = {
                    Cash: 'bg-amber-50 text-amber-700 border-amber-200',
                    Material: 'bg-indigo-50 text-indigo-700 border-indigo-200',
                    Memo: 'bg-purple-50 text-purple-700 border-purple-200',
                  }[r.type] || 'bg-gray-50 text-gray-600 border-gray-200';
                  return (
                    <div key={r.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/30 border border-border/30 hover:bg-muted/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold text-foreground truncate">
                          #{r.id} — {r.title || 'Untitled'}
                        </p>
                        {r.targetDepartment?.name && (
                          <p className="text-[9px] text-muted-foreground/60">To: {r.targetDepartment.name}</p>
                        )}
                      </div>
                      <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${typeColor} shrink-0`}>
                        {r.type}
                      </span>
                      <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full ${statusColor} shrink-0`}>
                        {r.status}
                      </span>
                      <span className="text-[9px] text-muted-foreground/50 shrink-0 flex items-center gap-0.5">
                        <Clock size={9} />
                        {new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Privilege editor — entirely hidden when Super Admin has disabled head access, no notice shown ── */}
          {canSetPrivileges && (
            <div className="px-4 pb-4 border-t border-border/20 pt-3">
              <PrivilegeEditor sub={sub} onUpdatePrivilege={onUpdatePrivilege} />
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="px-4 pb-4 pt-3 border-t-2 border-red-200 bg-red-50/60 space-y-3">
          <div className="flex items-start gap-2">
            <Trash2 size={15} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-black text-red-800">Delete "{sub.name}"?</p>
              <p className="text-[11px] text-red-700/80 mt-0.5 leading-relaxed">
                This sub-account will be permanently removed from the system. It will no longer appear in any list and cannot log in.
              </p>
              <p className="text-[11px] text-green-700 font-semibold mt-1.5 leading-relaxed">
                ✓ All {sub.reqCount} request{sub.reqCount !== 1 ? 's' : ''}, signatures, and history are fully preserved — nothing is lost.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleDelete} disabled={deleting}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black transition-all disabled:opacity-50">
              {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              {deleting ? 'Deleting…' : 'Yes, Delete'}
            </button>
            <button onClick={() => setConfirmDelete(false)} disabled={deleting}
              className="flex-1 py-2 rounded-xl border border-border/60 text-xs font-bold text-muted-foreground hover:bg-muted/40 transition-all">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────────
const SubAccountsPanel = ({ isAdmin = false }) => {
  const [subs, setSubs] = useState([]);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newFirstName, setNewFirstName] = useState('');
  const [newSurname, setNewSurname] = useState('');
  const [newOtherName, setNewOtherName] = useState('');
  const [newStaffId, setNewStaffId] = useState('');
  const [newHeadTitle, setNewHeadTitle] = useState('');
  const [newHeadEmail, setNewHeadEmail] = useState('');
  const [newHeadPhone, setNewHeadPhone] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newCode, setNewCode] = useState(null);
  const [newSubName, setNewSubName] = useState('');

  // Name-clash conflict resolution
  const [conflict, setConflict] = useState(null); // { deletedSub: {...}, suggestedName: '' }
  const [altName, setAltName] = useState('');      // editable version of suggestedName
  const [resolving, setResolving] = useState(false);

  // Admin dept selector
  const [departments, setDepartments] = useState([]);
  const [selectedDeptId, setSelectedDeptId] = useState('');

  // Batch upload (CSV/Excel)
  const [showBatchUpload, setShowBatchUpload] = useState(false);
  const [batchFile, setBatchFile] = useState(null);
  const [batchUploading, setBatchUploading] = useState(false);
  const [batchIssues, setBatchIssues] = useState(null);   // string[] — validation errors, if any
  const [batchResults, setBatchResults] = useState(null); // { headAssigned, created, mostSenior }

  // The parentId to use for all API calls
  const parentId = isAdmin ? (selectedDeptId ? parseInt(selectedDeptId) : null) : null;

  // Super-Admin-controlled permission toggles — admin is never restricted by these,
  // only department heads. Start as `null` (unknown) so the New Unit button / privilege
  // editor stay hidden until the real value loads — defaulting to `true` here caused a
  // visible flash (button shows, then disappears) whenever the setting was disabled.
  const [canManage, setCanManage] = useState(null);
  const [canSetPrivileges, setCanSetPrivileges] = useState(null);

  useEffect(() => {
    if (isAdmin) return; // admin is never gated by these settings
    // Falls back to the last known good cached value on a network failure, not blindly
    // to "enabled" — so a feature Super Admin disabled doesn't get exposed by a network blip.
    Promise.all([
      loadFeatureFlag('heads_can_manage_subaccounts'),
      loadFeatureFlag('heads_can_set_subaccount_privileges'),
    ]).then(([manage, priv]) => { setCanManage(manage); setCanSetPrivileges(priv); });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    deptAPI.getDepartments().then(d => {
      const nonSub = (Array.isArray(d) ? d : []).filter(dept => !dept.isSubAccount && dept.name?.toLowerCase() !== 'super admin');
      setDepartments(nonSub);
    }).catch(() => {});
  }, [isAdmin]);

  const load = async () => {
    setLoading(true);
    try {
      const [subsData, usersData] = await Promise.all([
        subAccountAPI.list(parentId || undefined),
        subAccountAPI.availableUsers(parentId || undefined).catch(() => [])
      ]);
      setSubs(Array.isArray(subsData) ? subsData : []);
      setAvailableUsers(Array.isArray(usersData) ? usersData : []);
    } catch (err) {
      toast.error('Failed to load sub-accounts.');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    // For dept heads load immediately; for admin load when dept selected (or show all)
    if (!isAdmin || selectedDeptId !== undefined) load();
  }, [selectedDeptId, isAdmin]);

  useEffect(() => {
    const handler = () => { if (!isAdmin || selectedDeptId !== undefined) load(); };
    window.addEventListener('globalHardRefresh', handler);
    return () => window.removeEventListener('globalHardRefresh', handler);
  }, [isAdmin, selectedDeptId]);

  const resetCreateForm = () => {
    setNewFirstName('');
    setNewSurname('');
    setNewOtherName('');
    setNewStaffId('');
    setNewHeadTitle('');
    setNewHeadEmail('');
    setNewHeadPhone('');
  };

  const create = async () => {
    if (!newFirstName.trim() || !newSurname.trim() || !newStaffId.trim() || !newHeadEmail.trim() || !newHeadPhone.trim()) return;
    const fullName = [newFirstName.trim(), newSurname.trim(), newOtherName.trim()].filter(Boolean).join(' ');
    setCreating(true);
    setConflict(null);
    try {
      const extra = { headName: fullName, staffId: newStaffId.trim().toUpperCase(), headEmail: newHeadEmail.trim(), phone: newHeadPhone.trim() };
      if (newHeadTitle.trim()) extra.headTitle = newHeadTitle.trim();
      const res = await subAccountAPI.create(fullName, parentId || undefined, extra);
      setNewCode(res.accessCode);
      setNewSubName(res.name);
      resetCreateForm();
      setShowCreate(false);
      load();
      toast.success(`"${res.name}" created.`);
    } catch (err) {
      const data = err?.response?.data;
      if (err?.response?.status === 409 && data?.conflict === 'deleted') {
        // Same Staff ID found in a deleted sub-account → same person coming back
        setConflict(data);
        setAltName(data.suggestedName || '');
      } else if (err?.response?.status === 409 && data?.conflict === 'name_taken') {
        // Name taken by a deleted record (different person) — show the suggested name in a toast
        toast.error(data.error || 'Name already taken — try a different name.');
      } else {
        toast.error(data?.error || 'Failed to create sub-account.');
      }
    } finally { setCreating(false); }
  };

  const resolveReactivate = async () => {
    if (!conflict?.deletedSub?.id) return;
    setResolving(true);
    try {
      const res = await subAccountAPI.reactivate(conflict.deletedSub.id);
      setNewCode(res.accessCode);
      setNewSubName(res.name);
      setConflict(null);
      resetCreateForm();
      setShowCreate(false);
      load();
      toast.success(`"${res.name}" reactivated — all previous records restored.`);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to reactivate.');
    } finally { setResolving(false); }
  };

  const resolveCreateNew = async () => {
    const name = altName.trim();
    if (!name) return;
    setResolving(true);
    try {
      const extra = { headName: name, staffId: newStaffId.trim().toUpperCase(), headEmail: newHeadEmail.trim(), phone: newHeadPhone.trim() };
      if (newHeadTitle.trim()) extra.headTitle = newHeadTitle.trim();
      const res = await subAccountAPI.create(name, parentId || undefined, extra);
      setNewCode(res.accessCode);
      setNewSubName(res.name);
      setConflict(null);
      resetCreateForm();
      setShowCreate(false);
      load();
      toast.success(`"${res.name}" created as a new sub-account.`);
    } catch (err) {
      const data = err?.response?.data;
      if (err?.response?.status === 409 && data?.conflict === 'deleted') {
        setConflict(data);
        setAltName(data.suggestedName || '');
        toast.error('That name also conflicts — try a different name.');
      } else {
        toast.error(data?.error || 'Failed to create sub-account.');
      }
    } finally { setResolving(false); }
  };

  const downloadBatchTemplate = () => {
    const header = 'Staff ID,Surname,First Name,Other Name,Title,Email,Phone';
    const sample = 'CSS001,Adeyemi,John,Chukwuemeka,General Manager,john.adeyemi@cssgroup.internal,+2348000000000';
    const csv = `${header}\n${sample}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'batch-upload-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetBatchUpload = () => {
    setBatchFile(null);
    setBatchIssues(null);
    setBatchResults(null);
  };

  const submitBatchUpload = async () => {
    if (!batchFile || !parentId) return;
    setBatchUploading(true);
    setBatchIssues(null);
    setBatchResults(null);
    try {
      const res = await subAccountAPI.batchUpload(batchFile, parentId);
      setBatchResults(res);
      load();
      toast.success(`Batch upload complete — ${res.created.length + (res.headAssigned ? 1 : 0)} account(s) created.`);
    } catch (err) {
      const data = err?.response?.data;
      if (Array.isArray(data?.issues) && data.issues.length) {
        setBatchIssues(data.issues);
      } else {
        toast.error(data?.error || 'Batch upload failed. Please check the file and try again.');
      }
    } finally { setBatchUploading(false); }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-foreground uppercase tracking-wide">Sub-Accounts / Units</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {isAdmin
              ? 'View and manage sub-accounts across all departments.'
              : 'Create child units that log in with their own password and submit requests under your department.'}
          </p>
        </div>
        {(isAdmin || canManage) && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreate(v => !v)}
              disabled={isAdmin && !selectedDeptId}
              title={isAdmin && !selectedDeptId ? 'Select a department first' : undefined}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-black uppercase tracking-wider hover:bg-primary/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={13} /> New Unit
            </button>
            <button
              onClick={() => { resetBatchUpload(); setShowBatchUpload(v => !v); }}
              disabled={isAdmin && !selectedDeptId}
              title={isAdmin && !selectedDeptId ? 'Select a department first' : undefined}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-primary/40 text-primary text-[11px] font-black uppercase tracking-wider hover:bg-primary/5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileText size={13} /> Batch Upload
            </button>
          </div>
        )}
      </div>

      {/* Admin dept selector */}
      {isAdmin && (
        <div className="flex items-center gap-2">
          <select
            value={selectedDeptId}
            onChange={e => setSelectedDeptId(e.target.value)}
            className="flex-1 text-xs border border-border/50 rounded-xl px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">— All Departments —</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black text-primary uppercase tracking-wider">
              Create Sub-Account{isAdmin && selectedDeptId ? ` — ${departments.find(d => String(d.id) === selectedDeptId)?.name || ''}` : ''}
            </p>
            <button onClick={() => { setShowCreate(false); resetCreateForm(); }} className="p-1 rounded-lg text-muted-foreground hover:text-foreground transition-all">
              <X size={14} />
            </button>
          </div>

          {/* Staff ID — primary identifier */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Staff ID <span className="text-red-400">*</span></label>
            <input
              autoFocus
              value={newStaffId}
              onChange={e => setNewStaffId(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Escape') { setShowCreate(false); resetCreateForm(); } }}
              placeholder="e.g. CSS001"
              className="w-full border border-border/50 rounded-xl px-3 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20 font-mono tracking-wider uppercase"
            />
            <p className="text-[9px] text-muted-foreground/60 italic">Unique identifier for this staff member. Used to track and restore records if the sub-account is ever deleted and re-created.</p>
          </div>

          {/* Name — split into three parts */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">
              Name <span className="text-red-400">*</span>
              <span className="text-muted-foreground/50 font-normal normal-case ml-1">(First &amp; Surname required)</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={newFirstName}
                onChange={e => setNewFirstName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { setShowCreate(false); resetCreateForm(); } }}
                placeholder="First Name *"
                className="w-full border border-border/50 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20"
              />
              <input
                value={newSurname}
                onChange={e => setNewSurname(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { setShowCreate(false); resetCreateForm(); } }}
                placeholder="Surname *"
                className="w-full border border-border/50 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <input
              value={newOtherName}
              onChange={e => setNewOtherName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setShowCreate(false); resetCreateForm(); } }}
              placeholder="Other Name (optional)"
              className="w-full border border-border/50 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20"
            />
            {(newFirstName.trim() || newSurname.trim()) && (
              <p className="text-[10px] text-primary/70 font-semibold">
                Full name: {[newFirstName.trim(), newSurname.trim(), newOtherName.trim()].filter(Boolean).join(' ')}
              </p>
            )}
          </div>

          {/* Head details — pre-filled by the dept head so sub-account skips setup on first login */}
          <div className="pt-1 space-y-2 border-t border-primary/10">
            <p className="text-[10px] text-muted-foreground/70 italic">
              Fill in the unit head details now so the sub-account goes straight to the dashboard on first login.
            </p>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Title / Position</label>
              <input
                value={newHeadTitle}
                onChange={e => setNewHeadTitle(e.target.value)}
                placeholder="e.g. Officer"
                className="w-full border border-border/50 rounded-xl px-3 py-2 text-xs bg-white outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Email Address <span className="text-red-400">*</span></label>
              <input
                type="email"
                value={newHeadEmail}
                onChange={e => setNewHeadEmail(e.target.value)}
                placeholder="email@company.com"
                className="w-full border border-border/50 rounded-xl px-3 py-2 text-xs bg-white outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Phone Number <span className="text-red-400">*</span></label>
              <input
                type="tel"
                value={newHeadPhone}
                onChange={e => setNewHeadPhone(e.target.value)}
                placeholder="+234 800 000 0000"
                className="w-full border border-border/50 rounded-xl px-3 py-2 text-xs bg-white outline-none focus:ring-2 focus:ring-primary/20"
              />
              <p className="text-[9px] text-muted-foreground/60 italic">Required — used to SMS the access code to this sub-account.</p>
            </div>
          </div>

          <button
            onClick={create}
            disabled={creating || !newFirstName.trim() || !newSurname.trim() || !newStaffId.trim() || !newHeadEmail.trim() || !newHeadPhone.trim()}
            className="w-full px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Create Sub-Account
          </button>
          <p className="text-[10px] text-muted-foreground/60 italic text-center">
            A one-time Access Code is auto-generated. The sub-account creates their own password on first login.
          </p>
        </div>
      )}

      {/* ── Batch Upload panel ─────────────────────────────────────────────── */}
      {showBatchUpload && (
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black text-primary uppercase tracking-wider">
              Batch Upload{isAdmin && selectedDeptId ? ` — ${departments.find(d => String(d.id) === selectedDeptId)?.name || ''}` : ''}
            </p>
            <button onClick={() => { setShowBatchUpload(false); resetBatchUpload(); }} className="p-1 rounded-lg text-muted-foreground hover:text-foreground transition-all">
              <X size={14} />
            </button>
          </div>

          {!batchResults && (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Upload a CSV or Excel file with one row per person — <strong>Staff ID, Surname, First Name, Email, and Phone are required</strong> (Other Name and Title are optional). Row order matters: the first row is the most senior. If this department has no head yet, row 1 becomes the head; everyone else becomes a sub-account. If a head already exists, everyone uploaded becomes a sub-account, and row 1 is marked as the designated successor.
              </p>
              <button
                onClick={downloadBatchTemplate}
                className="flex items-center gap-1.5 text-[10px] font-bold text-primary hover:text-primary/80 transition-all"
              >
                <FileText size={12} /> Download CSV Template
              </button>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">File <span className="text-red-400">*</span></label>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={e => { setBatchFile(e.target.files?.[0] || null); setBatchIssues(null); }}
                  className="w-full text-xs border border-border/50 rounded-xl px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-primary/20 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary file:text-[10px] file:font-bold file:uppercase"
                />
              </div>

              {batchIssues && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-1.5 max-h-48 overflow-y-auto">
                  <p className="text-[10px] font-black text-red-700 uppercase tracking-wider">
                    {batchIssues.length} issue(s) found — nothing was created
                  </p>
                  {batchIssues.map((issue, i) => (
                    <p key={i} className="text-[10px] text-red-700 leading-relaxed">• {issue}</p>
                  ))}
                  <p className="text-[10px] text-red-600/80 italic pt-1">Fix these in your file and re-upload.</p>
                </div>
              )}

              <button
                onClick={submitBatchUpload}
                disabled={batchUploading || !batchFile}
                className="w-full px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {batchUploading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {batchUploading ? 'Uploading…' : 'Upload & Create'}
              </button>
            </>
          )}

          {batchResults && (
            <div className="space-y-3">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <p className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">
                  Upload complete — {batchResults.created.length + (batchResults.headAssigned ? 1 : 0)} account(s) created
                </p>
              </div>

              {batchResults.headAssigned && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                  <p className="text-[10px] font-black text-amber-700 uppercase tracking-wider">Assigned as Department Head</p>
                  <p className="text-xs font-bold text-foreground">{batchResults.headAssigned.name} ({batchResults.headAssigned.staffId})</p>
                  <p className="text-[10px] font-mono text-amber-800">Access Code: {batchResults.headAssigned.accessCode}</p>
                </div>
              )}

              {batchResults.created.length > 0 && (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {batchResults.created.map(c => {
                    const isMostSenior = batchResults.mostSenior?.id === c.id;
                    return (
                      <div key={c.id} className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${isMostSenior ? 'bg-primary/5 border-primary/30' : 'bg-white border-border/40'}`}>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-foreground truncate">
                            {c.name} ({c.staffId}) {isMostSenior && <span className="text-primary font-black">— Most Senior</span>}
                          </p>
                        </div>
                        <span className="text-[10px] font-mono font-bold text-foreground shrink-0">{c.accessCode}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {batchResults.mostSenior && (
                <p className="text-[10px] text-muted-foreground/70 italic">
                  {batchResults.mostSenior.name} is currently most senior — they'll be the one auto-elevated to full authority if the head is ever suspended. Reorder anytime from the list below.
                </p>
              )}

              <p className="text-[10px] text-muted-foreground/60 italic">
                Access codes are also being emailed and texted to each person now. Copy any you need from above — this list won't be shown again.
              </p>
              <button
                onClick={() => { setShowBatchUpload(false); resetBatchUpload(); }}
                className="w-full px-4 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-muted transition-all"
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Name conflict resolution panel ─────────────────────────────────── */}
      {conflict && (
        <div className="border border-amber-200 bg-amber-50/60 rounded-2xl p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center flex-shrink-0 mt-0.5">
              <ShieldAlert size={15} className="text-amber-600" />
            </div>
            <div>
              <p className="text-[11px] font-black text-amber-800 uppercase tracking-wide">Same Staff ID — Existing Record Found</p>
              <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
                Staff ID <span className="font-black">"{conflict.deletedSub.staffId}"</span> belongs to a deleted sub-account named <span className="font-black">"{conflict.deletedSub.name}"</span>.
                This appears to be the same person. Choose what you'd like to do:
              </p>
            </div>
            <button onClick={() => setConflict(null)} className="ml-auto p-1 rounded-lg text-amber-500 hover:text-amber-700 flex-shrink-0">
              <X size={13} />
            </button>
          </div>

          {/* Option A — Reactivate */}
          <div className="bg-white border border-emerald-200 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center text-[10px] font-black text-emerald-700">A</div>
              <p className="text-[11px] font-black text-emerald-800">Reactivate "{conflict.deletedSub.name}"</p>
            </div>
            <p className="text-[10px] text-muted-foreground/70 leading-relaxed pl-7">
              Restore the deleted sub-account exactly as it was — all its previous requests, history, and records come back. A new login password will be generated.
            </p>
            <div className="pl-7">
              <button
                onClick={resolveReactivate}
                disabled={resolving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 disabled:opacity-50 transition-all"
              >
                {resolving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                Reactivate Sub-Account
              </button>
            </div>
          </div>

          {/* Option B — Create with new name */}
          <div className="bg-white border border-blue-200 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-[10px] font-black text-blue-700">B</div>
              <p className="text-[11px] font-black text-blue-800">Create a brand new sub-account</p>
            </div>
            <p className="text-[10px] text-muted-foreground/70 leading-relaxed pl-7">
              Start fresh with a different name. The deleted sub-account stays as-is. Edit the suggested name below or type your own.
            </p>
            <div className="pl-7 flex gap-2 items-center">
              <input
                value={altName}
                onChange={e => setAltName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') resolveCreateNew(); }}
                placeholder="Enter a different name…"
                className="flex-1 border border-border/50 rounded-xl px-3 py-1.5 text-xs bg-white outline-none focus:ring-2 focus:ring-blue-200 min-w-0"
              />
              <button
                onClick={resolveCreateNew}
                disabled={resolving || !altName.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-[11px] font-bold hover:bg-blue-700 disabled:opacity-50 transition-all flex-shrink-0"
              >
                {resolving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                Create New
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New code reveal after creation */}
      {newCode && (
        <div>
          <p className="text-[10px] font-bold text-muted-foreground mb-1">
            Access Code for <span className="text-foreground">{newSubName}</span>
            <span className="text-muted-foreground/50 font-normal ml-1">— share this with the unit member for their first login</span>
          </p>
          <CodeBox code={newCode} onDismiss={() => { setNewCode(null); setNewSubName(''); }} />
        </div>
      )}

      {/* Sub-account list */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 size={20} className="animate-spin text-muted-foreground/40" />
        </div>
      ) : subs.length === 0 ? (
        <div className="py-10 text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-muted/40 border border-border/30 flex items-center justify-center mx-auto">
            <Users size={20} className="text-muted-foreground/40" />
          </div>
          <p className="text-sm text-muted-foreground font-medium">No sub-accounts yet</p>
          <p className="text-[11px] text-muted-foreground/60">Create your first unit above to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {subs.map((sub, idx) => {
            // Position/reorder only makes sense within a single department's list — when
            // admin is viewing "All Departments" the flat list mixes siblings from different
            // parents, so showing a position number or move buttons there would be misleading.
            const singleDeptView = !isAdmin || !!selectedDeptId;
            return (
              <SubAccountCard
                key={sub.id}
                sub={sub}
                availableUsers={availableUsers}
                onRefresh={load}
                onUpdatePrivilege={updates => setSubs(prev => prev.map(s => s.id === sub.id ? { ...s, ...updates } : s))}
                showParent={isAdmin && !selectedDeptId}
                isAdmin={isAdmin}
                canManage={isAdmin || canManage}
                canSetPrivileges={isAdmin || canSetPrivileges}
                canReorder={singleDeptView}
                position={singleDeptView ? idx + 1 : null}
                isFirst={idx === 0}
                isLast={idx === subs.length - 1}
              />
            );
          })}
        </div>
      )}

      <div className="p-4 bg-muted/20 rounded-2xl border border-border/20 flex items-start gap-3">
        <ShieldAlert size={14} className="text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground/80 leading-relaxed">
          Sub-accounts log in using their unit name and password, exactly like a department. They can submit requests, use chat, and view their own records. You see all their activity and requests merged into your dashboard. Sub-accounts cannot create further sub-accounts.
        </p>
      </div>
    </div>
  );
};

export default SubAccountsPanel;
