import { useState, useEffect } from 'react';
import { reqAPI } from '../lib/api';
import { X, Send, ArrowRight, RotateCcw, CheckCircle2, AlertCircle, DollarSign, Clock, Eye } from 'lucide-react';

const ACTION_STYLES = {
  created:              { icon: Send,          bg: 'bg-blue-500',    ring: 'ring-blue-400/30',   text: 'text-blue-700',   label: 'Created & Sent' },
  forwarded:            { icon: ArrowRight,    bg: 'bg-emerald-500', ring: 'ring-emerald-400/30',text: 'text-emerald-700',label: 'Forwarded' },
  returned:             { icon: RotateCcw,     bg: 'bg-amber-500',   ring: 'ring-amber-400/30',  text: 'text-amber-700',  label: 'Returned' },
  rejected:             { icon: AlertCircle,   bg: 'bg-red-500',     ring: 'ring-red-400/30',    text: 'text-red-700',    label: 'Rejected' },
  vetting:              { icon: Eye,           bg: 'bg-violet-500',  ring: 'ring-violet-400/30', text: 'text-violet-700', label: 'Vetting Action' },
  paid:                 { icon: DollarSign,    bg: 'bg-teal-500',    ring: 'ring-teal-400/30',   text: 'text-teal-700',   label: 'Payment' },
  approved:             { icon: CheckCircle2,  bg: 'bg-indigo-500',  ring: 'ring-indigo-400/30', text: 'text-indigo-700', label: 'Approved' },
  stage_approved:       { icon: CheckCircle2,  bg: 'bg-green-600',   ring: 'ring-green-400/30',  text: 'text-green-700',  label: 'Stage Approved' },
  stage_rejected:       { icon: AlertCircle,   bg: 'bg-red-600',     ring: 'ring-red-400/30',    text: 'text-red-700',    label: 'Stage Rejected' },
  reapproved:           { icon: CheckCircle2,  bg: 'bg-emerald-600', ring: 'ring-emerald-400/30',text: 'text-emerald-700',label: 'Re-Approved' },
  forwarded_for_reapproval: { icon: RotateCcw, bg: 'bg-orange-500',  ring: 'ring-orange-400/30', text: 'text-orange-700', label: 'Sent for Re-Approval' },
  default:              { icon: Clock,         bg: 'bg-slate-400',   ring: 'ring-slate-400/30',  text: 'text-slate-700',  label: 'Action' },
};

function resolveActionStyle(action, isVetting, amountDisbursed) {
  if (isVetting && (amountDisbursed > 0)) return ACTION_STYLES.paid;
  if (isVetting) return ACTION_STYLES.vetting;
  return ACTION_STYLES[action] || ACTION_STYLES.default;
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function StatusPill({ finalApprovalStatus, status }) {
  const map = {
    treated:   { label: 'Fully Treated',   cls: 'bg-indigo-100 text-indigo-700 border-indigo-300' },
    published: { label: 'Published',       cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
    partial:   { label: 'Partial Payment', cls: 'bg-orange-100 text-orange-700 border-orange-300' },
    vetting:   { label: 'In Vetting',      cls: 'bg-blue-100 text-blue-700 border-blue-300' },
    approved:  { label: 'Approved',        cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
    rejected:  { label: 'Rejected',        cls: 'bg-red-100 text-red-700 border-red-300' },
    pending:   { label: 'Pending',         cls: 'bg-amber-100 text-amber-700 border-amber-300' },
  };
  const key = finalApprovalStatus && finalApprovalStatus !== 'none' ? finalApprovalStatus : (status || 'pending');
  const s = map[key] || map.pending;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-[0.12em] border ${s.cls}`}>
      {s.label}
    </span>
  );
}

export default function RequisitionFlowModal({ reqId, viewingDeptId, viewingDeptName, onClose }) {
  const [req, setReq] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!reqId) return;
    setLoading(true);
    setError(null);
    reqAPI.getRequisition(reqId)
      .then(setReq)
      .catch(() => setError('Could not load the requisition flow. Please try again.'))
      .finally(() => setLoading(false));
  }, [reqId]);

  // Build a merged, chronological timeline from forwardEvents + vettingEvents + approvals
  const timeline = (() => {
    if (!req) return [];
    const items = [];

    (req.forwardEvents || []).forEach(e => {
      const fromId = e.fromDeptId ?? e.fromDepartment?.id;
      const toId   = e.toDeptId   ?? e.toDepartment?.id;
      items.push({
        id: `fw-${e.id}`,
        type: 'forward',
        action: e.action || 'forwarded',
        fromName: e.fromDepartment?.name || `Dept #${fromId}`,
        toName:   e.toDepartment?.name   || null,
        fromId:   Number(fromId),
        toId:     toId ? Number(toId) : null,
        note: e.note,
        actor: e.actorName,
        createdAt: e.createdAt,
        amount: null,
      });
    });

    (req.vettingEvents || []).forEach(e => {
      items.push({
        id: `ve-${e.id}`,
        type: 'vetting',
        action: e.action || 'vetting',
        fromName: e.deptName || `Dept #${e.deptId}`,
        toName: null,
        fromId: Number(e.deptId),
        toId: null,
        note: e.comment,
        actor: e.actorName,
        createdAt: e.createdAt,
        amount: e.amountDisbursed || null,
      });
    });

    // Workflow approval stages — HR, GM, Chairman/CEO sign-offs
    (req.approvals || []).forEach(a => {
      const stageName = a.stage?.name || a.stage?.role || 'Approval Stage';
      items.push({
        id: `ap-${a.id}`,
        type: 'approval',
        action: a.action === 'approved' ? 'stage_approved' : 'stage_rejected',
        fromName: stageName,
        stageRole: a.stage?.role || null,
        stageThreshold: a.stage?.threshold || null,
        toName: null,
        fromId: null,
        toId: null,
        note: a.remarks || null,
        actor: a.user?.name || null,
        createdAt: a.createdAt,
        amount: null,
      });
    });

    return items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  })();

  // Match a stage role / name to the viewing dept to decide the YOU badge
  const isMyApprovalNode = (node) => {
    if (!viewingDeptName || !node.stageRole) return false;
    const n = viewingDeptName.toLowerCase();
    const r = (node.stageRole || '').toLowerCase();
    const sName = (node.fromName || '').toLowerCase();
    if (r === 'hr' || /\bhr\b|human.?resource/.test(r))       return /\bhr\b|human.?resource/.test(n);
    if (r === 'gm' || /general.?manager/.test(r))             return /\bgm\b|general.?manager/.test(n);
    if (r === 'chairman' || /ceo|chairman/.test(r))           return /ceo|chairman/.test(n);
    // fallback: stage name contains dept name or vice versa
    return sName.includes(n.slice(0, 4)) || n.includes(sName.slice(0, 4));
  };

  const isMyNode = (node) => {
    if (!viewingDeptId && !viewingDeptName) return false;
    if (node.type === 'approval') return isMyApprovalNode(node);
    const vid = Number(viewingDeptId);
    return node.fromId === vid || node.toId === vid;
  };

  const effectiveAmount = req
    ? (req.iccOverrideAmount || req.auditAmount || req.amount || 0)
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-xl max-h-[88vh] flex flex-col bg-background rounded-[2rem] shadow-2xl border border-border overflow-hidden animate-in fade-in zoom-in-95 duration-200">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 p-5 pb-4 border-b border-border/40 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-black text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full tracking-widest uppercase">
                #{req?.id || reqId}
              </span>
              <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-bold">{req?.type}</span>
              {req && <StatusPill finalApprovalStatus={req.finalApprovalStatus} status={req.status} />}
            </div>
            <h2 className="text-base font-black text-foreground truncate">{req?.title || 'Loading…'}</h2>
            {effectiveAmount > 0 && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Amount: <span className="font-black text-foreground">₦{Number(effectiveAmount).toLocaleString()}</span>
                {req?.amountDisbursed > 0 && (
                  <span className="ml-2 text-teal-600 font-bold">· ₦{Number(req.amountDisbursed).toLocaleString()} disbursed</span>
                )}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-2 rounded-xl hover:bg-muted/60 text-muted-foreground transition-colors active:scale-90"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Viewing-as banner ── */}
        {viewingDeptName && (
          <div className="shrink-0 px-5 py-2 bg-violet-50/60 border-b border-violet-100/60">
            <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest">
              Viewing as <span className="text-violet-800">{viewingDeptName}</span> — your steps are highlighted
            </p>
          </div>
        )}

        {/* ── Timeline body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-[11px] text-muted-foreground font-medium">Loading journey…</p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700">
              <AlertCircle size={16} className="shrink-0" />
              <p className="text-[12px] font-medium">{error}</p>
            </div>
          )}

          {!loading && !error && timeline.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Clock size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-[12px] font-medium">No movement recorded yet.</p>
            </div>
          )}

          {!loading && !error && timeline.length > 0 && (
            <div className="relative">
              {/* Vertical connector line */}
              <div className="absolute left-[19px] top-5 bottom-5 w-0.5 bg-border/50 rounded-full" />

              <div className="space-y-1">
                {timeline.map((node, idx) => {
                  const mine = isMyNode(node);
                  const style = resolveActionStyle(node.action, node.type === 'vetting', node.amount);
                  const Icon = style.icon;
                  const isLast = idx === timeline.length - 1;

                  return (
                    <div key={node.id} className="relative flex gap-3">
                      {/* Dot */}
                      <div className={`relative z-10 shrink-0 w-10 h-10 rounded-full flex items-center justify-center shadow-sm ring-4 ${style.ring} ${style.bg} text-white`}>
                        <Icon size={14} />
                      </div>

                      {/* Card */}
                      <div className={`flex-1 mb-3 rounded-2xl border p-3.5 transition-all ${
                        mine
                          ? 'bg-violet-50 border-violet-300 ring-2 ring-violet-200/60 shadow-sm shadow-violet-100'
                          : 'bg-muted/30 border-border/40'
                      }`}>
                        {/* Top row: action label + YOU badge + timestamp */}
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[9px] font-black uppercase tracking-[0.15em] ${style.text}`}>
                              {style.label}
                            </span>
                            {mine && (
                              <span className="bg-violet-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-widest">
                                YOU
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] text-muted-foreground/50 font-mono shrink-0">
                            {fmtDate(node.createdAt)}
                          </span>
                        </div>

                        {/* Department / stage name */}
                        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                          <span className={`text-[11px] font-black ${mine ? 'text-violet-700' : 'text-foreground'}`}>
                            {node.fromName}
                          </span>
                          {node.toName && (
                            <>
                              <ArrowRight size={10} className="text-muted-foreground/40 shrink-0" />
                              <span className={`text-[11px] font-black ${mine && node.toId === Number(viewingDeptId) ? 'text-violet-700' : 'text-foreground'}`}>
                                {node.toName}
                              </span>
                            </>
                          )}
                          {/* Approval threshold band */}
                          {node.type === 'approval' && node.stageThreshold > 0 && (
                            <span className="text-[9px] font-bold text-muted-foreground/50 border border-border/40 rounded px-1.5 py-0.5">
                              threshold ≥ ₦{Number(node.stageThreshold).toLocaleString()}
                            </span>
                          )}
                        </div>

                        {/* Amount (vetting payments) */}
                        {node.amount > 0 && (
                          <p className="text-[11px] font-black text-teal-700 mb-1">
                            ₦{Number(node.amount).toLocaleString()} disbursed
                          </p>
                        )}

                        {/* Note / comment */}
                        {node.note && (
                          <p className="text-[11px] text-muted-foreground italic leading-snug border-l-2 border-border pl-2">
                            "{node.note}"
                          </p>
                        )}

                        {/* Actor */}
                        {node.actor && (
                          <p className="text-[9px] text-muted-foreground/50 mt-1 uppercase tracking-widest">
                            By {node.actor}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Current state footer */}
              {req && (
                <div className="mt-2 p-3.5 rounded-2xl bg-background border border-border/60 flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
                  <div>
                    <p className="text-[9px] font-black text-muted-foreground/50 uppercase tracking-widest mb-0.5">Current State</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusPill finalApprovalStatus={req.finalApprovalStatus} status={req.status} />
                      {(req.currentVettingDept?.name || req.currentVettingDeptId) && (
                        <span className="text-[10px] text-muted-foreground font-medium">
                          · Currently with <span className="font-black text-foreground">{req.currentVettingDept?.name || `Dept #${req.currentVettingDeptId}`}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
