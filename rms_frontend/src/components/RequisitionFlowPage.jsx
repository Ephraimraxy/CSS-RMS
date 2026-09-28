import { useState, useEffect, useRef } from 'react';
import { reqAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft, Send, ArrowRight, RotateCcw, CheckCircle2,
  AlertCircle, DollarSign, Clock, Eye, BadgeCheck
} from 'lucide-react';

/* ── Action metadata ───────────────────────────────────────────────── */
const ACTION_META = {
  created:                  { Icon: Send,         color: '#3B82F6', label: 'Created & Sent',       bg: '#EFF6FF', border: '#BFDBFE' },
  forwarded:                { Icon: ArrowRight,   color: '#10B981', label: 'Forwarded',             bg: '#F0FDF4', border: '#BBF7D0' },
  returned:                 { Icon: RotateCcw,    color: '#F59E0B', label: 'Returned',              bg: '#FFFBEB', border: '#FDE68A' },
  rejected:                 { Icon: AlertCircle,  color: '#EF4444', label: 'Rejected',              bg: '#FEF2F2', border: '#FECACA' },
  vetting:                  { Icon: Eye,           color: '#8B5CF6', label: 'Vetting Action',        bg: '#F5F3FF', border: '#DDD6FE' },
  paid:                     { Icon: DollarSign,   color: '#0D9488', label: 'Payment',               bg: '#F0FDFA', border: '#99F6E4' },
  stage_approved:           { Icon: CheckCircle2, color: '#16A34A', label: 'Stage Approved',        bg: '#F0FDF4', border: '#86EFAC' },
  stage_rejected:           { Icon: AlertCircle,  color: '#DC2626', label: 'Stage Rejected',        bg: '#FEF2F2', border: '#FECACA' },
  reapproved:               { Icon: CheckCircle2, color: '#059669', label: 'Re-Approved',           bg: '#ECFDF5', border: '#6EE7B7' },
  forwarded_for_reapproval: { Icon: RotateCcw,   color: '#EA580C', label: 'Sent for Re-Approval',  bg: '#FFF7ED', border: '#FED7AA' },
};
const DEFAULT_META = { Icon: Clock, color: '#94A3B8', label: 'Action', bg: '#F8FAFC', border: '#E2E8F0' };

function resolveMeta(action, isVetting, amount) {
  if (isVetting && amount > 0) return ACTION_META.paid;
  if (isVetting) return ACTION_META.vetting;
  return ACTION_META[action] || DEFAULT_META;
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

/* ── Individual flow node ──────────────────────────────────────────── */
function FlowNode({ node, isMine, viewingDeptId, isFirst, isLast }) {
  const meta = resolveMeta(node.action, node.type === 'vetting', node.amount);
  const { Icon } = meta;

  return (
    <div className="flex flex-col items-center">
      {/* Card */}
      <div
        className="relative w-full max-w-sm rounded-2xl border-2 p-4 shadow-sm transition-all"
        style={{
          borderColor: isMine ? '#7C3AED' : meta.border,
          backgroundColor: isMine ? '#F5F3FF' : meta.bg,
          boxShadow: isMine ? '0 0 0 3px #DDD6FE' : undefined,
        }}
      >
        {/* YOU badge */}
        {isMine && (
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-violet-600 text-white text-[9px] font-black px-3 py-0.5 rounded-full uppercase tracking-widest shadow-sm">
            YOUR DEPT
          </span>
        )}

        {/* Header row */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: meta.color + '22' }}
            >
              <Icon size={15} style={{ color: meta.color }} />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: meta.color }}>
              {meta.label}
            </span>
          </div>
          <span className="text-[9px] text-slate-400 font-mono">{fmtDate(node.createdAt)}</span>
        </div>

        {/* Department/stage names */}
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          <span className={`text-sm font-black ${isMine ? 'text-violet-800' : 'text-slate-800'}`}>
            {node.fromName}
          </span>
          {node.toName && (
            <>
              <ArrowRight size={12} className="text-slate-400 shrink-0" />
              <span className={`text-sm font-black ${isMine && node.toId === Number(viewingDeptId) ? 'text-violet-800' : 'text-slate-800'}`}>
                {node.toName}
              </span>
            </>
          )}
          {/* Approval threshold badge */}
          {node.type === 'approval' && node.stageThreshold > 0 && (
            <span className="text-[8px] font-bold text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">
              ≥ ₦{Number(node.stageThreshold).toLocaleString()}
            </span>
          )}
        </div>

        {/* Amount */}
        {node.amount > 0 && (
          <div className="flex items-center gap-1 mb-1">
            <span className="text-sm font-black text-teal-700">₦{Number(node.amount).toLocaleString()} disbursed</span>
          </div>
        )}

        {/* Note */}
        {node.note && (
          <p className="text-[11px] text-slate-500 italic leading-snug border-l-2 pl-2 mb-1" style={{ borderColor: meta.border }}>
            "{node.note}"
          </p>
        )}

        {/* Actor */}
        {node.actor && (
          <p className="text-[9px] text-slate-400 uppercase tracking-widest">By {node.actor}</p>
        )}
      </div>
    </div>
  );
}

/* ── Arrow between nodes ────────────────────────────────────────────── */
function FlowArrow({ fromAction }) {
  const isReturn  = fromAction === 'returned';
  const isReapproval = fromAction === 'forwarded_for_reapproval';
  const color = isReturn || isReapproval ? '#F59E0B' : '#CBD5E1';

  return (
    <div className="flex flex-col items-center my-1 select-none" style={{ width: '100%' }}>
      <div className="flex flex-col items-center gap-0" style={{ height: 52 }}>
        {/* Vertical line */}
        <div style={{ width: 2, flex: 1, backgroundColor: color, borderRadius: 1 }} />
        {/* Arrowhead */}
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
          <path d="M7 10L0 0h14L7 10z" fill={color} />
        </svg>
      </div>
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────────── */
export default function RequisitionFlowPage({ reqId, onBack }) {
  const { user } = useAuth();
  const [req, setReq] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const viewingDeptId   = user?.deptId   ? Number(user.deptId)   : null;
  const viewingDeptName = user?.name || user?.departmentName || '';

  useEffect(() => {
    if (!reqId) return;
    setLoading(true);
    setError(null);
    reqAPI.getRequisition(reqId)
      .then(setReq)
      .catch(() => setError('Could not load this requisition. Please try again.'))
      .finally(() => setLoading(false));
  }, [reqId]);

  /* ── Build timeline ───────────────────────────────────────────────── */
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

  /* ── Is this node mine? ────────────────────────────────────────────── */
  const isMyNode = (node) => {
    if (node.type === 'approval') {
      if (!viewingDeptName) return false;
      const n = viewingDeptName.toLowerCase();
      const r = (node.stageRole || '').toLowerCase();
      if (/\bhr\b|human.?resource/.test(r))  return /\bhr\b|human.?resource/.test(n);
      if (/general.?manager|\bgm\b/.test(r)) return /general.?manager|\bgm\b/.test(n);
      if (/ceo|chairman/.test(r))            return /ceo|chairman/.test(n);
      return false;
    }
    if (!viewingDeptId) return false;
    return node.fromId === viewingDeptId || node.toId === viewingDeptId;
  };

  const effectiveAmount = req
    ? (req.iccOverrideAmount || req.auditAmount || req.amount || 0)
    : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border/40 px-4 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/60 hover:bg-muted text-foreground text-sm font-bold transition-all active:scale-95"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-black text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full tracking-widest uppercase">
              #{req?.id || reqId}
            </span>
            {req && <StatusPill finalApprovalStatus={req.finalApprovalStatus} status={req.status} />}
            <span className="text-[10px] text-muted-foreground/60 uppercase font-bold">{req?.type}</span>
          </div>
          <p className="text-sm font-black text-foreground truncate mt-0.5">{req?.title || 'Loading…'}</p>
        </div>

        {effectiveAmount > 0 && (
          <div className="text-right shrink-0">
            <p className="text-[9px] text-muted-foreground uppercase tracking-widest">Amount</p>
            <p className="text-sm font-black text-foreground">₦{Number(effectiveAmount).toLocaleString()}</p>
            {req?.amountDisbursed > 0 && (
              <p className="text-[10px] font-bold text-teal-600">₦{Number(req.amountDisbursed).toLocaleString()} paid</p>
            )}
          </div>
        )}
      </div>

      {/* ── Viewing-as banner ──────────────────────────────────────── */}
      {viewingDeptName && (
        <div className="px-4 py-2 bg-violet-50/60 border-b border-violet-100/60 text-center">
          <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest">
            Viewing as <span className="text-violet-800">{viewingDeptName}</span>
            {timeline.some(isMyNode) && <span className="ml-2 text-violet-500">— your steps are highlighted</span>}
          </p>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className="max-w-lg mx-auto px-4 py-8">

        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <p className="text-sm text-muted-foreground font-medium">Loading journey…</p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700">
            <AlertCircle size={18} className="shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {!loading && !error && timeline.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            <Clock size={40} className="mx-auto mb-4 opacity-20" />
            <p className="text-sm font-medium">No movement recorded yet.</p>
          </div>
        )}

        {!loading && !error && timeline.length > 0 && (
          <div className="flex flex-col items-center">
            {timeline.map((node, idx) => {
              const mine = isMyNode(node);
              const isLast = idx === timeline.length - 1;
              return (
                <div key={node.id} className="w-full flex flex-col items-center">
                  <FlowNode
                    node={node}
                    isMine={mine}
                    viewingDeptId={viewingDeptId}
                    isFirst={idx === 0}
                    isLast={isLast}
                  />
                  {!isLast && (
                    <FlowArrow fromAction={node.action} />
                  )}
                </div>
              );
            })}

            {/* ── Current state footer ──────────────────────────────── */}
            {req && (
              <>
                <FlowArrow fromAction="current" />
                <div className="w-full max-w-sm rounded-2xl border-2 border-dashed border-primary/30 p-4 text-center bg-primary/5">
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <p className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest">Current State</p>
                  </div>
                  <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
                    <StatusPill finalApprovalStatus={req.finalApprovalStatus} status={req.status} />
                    {(req.currentVettingDept?.name || req.currentVettingDeptId) && (
                      <span className="text-[11px] text-muted-foreground">
                        · with <span className="font-black text-foreground">{req.currentVettingDept?.name || `Dept #${req.currentVettingDeptId}`}</span>
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
