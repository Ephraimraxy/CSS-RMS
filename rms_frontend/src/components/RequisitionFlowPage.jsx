import { useState, useEffect } from 'react';
import { reqAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft, Send, ArrowRight, RotateCcw, CheckCircle2,
  AlertCircle, DollarSign, Clock, Eye
} from 'lucide-react';

/* ── Action metadata ─────────────────────────────────────────────── */
const ACTION_META = {
  created:                  { Icon: Send,         color: '#3B82F6', label: 'Created & Sent',      bg: '#EFF6FF', border: '#BFDBFE', dark: '#1D4ED8' },
  forwarded:                { Icon: ArrowRight,   color: '#10B981', label: 'Forwarded',            bg: '#F0FDF4', border: '#BBF7D0', dark: '#059669' },
  returned:                 { Icon: RotateCcw,    color: '#F59E0B', label: 'Returned',             bg: '#FFFBEB', border: '#FDE68A', dark: '#D97706' },
  rejected:                 { Icon: AlertCircle,  color: '#EF4444', label: 'Rejected',             bg: '#FEF2F2', border: '#FECACA', dark: '#DC2626' },
  vetting:                  { Icon: Eye,           color: '#8B5CF6', label: 'Vetting Action',       bg: '#F5F3FF', border: '#DDD6FE', dark: '#7C3AED' },
  paid:                     { Icon: DollarSign,   color: '#0D9488', label: 'Payment',              bg: '#F0FDFA', border: '#99F6E4', dark: '#0F766E' },
  stage_approved:           { Icon: CheckCircle2, color: '#16A34A', label: 'Stage Approved',       bg: '#F0FDF4', border: '#86EFAC', dark: '#15803D' },
  stage_rejected:           { Icon: AlertCircle,  color: '#DC2626', label: 'Stage Rejected',       bg: '#FEF2F2', border: '#FECACA', dark: '#B91C1C' },
  reapproved:               { Icon: CheckCircle2, color: '#059669', label: 'Re-Approved',          bg: '#ECFDF5', border: '#6EE7B7', dark: '#047857' },
  forwarded_for_reapproval: { Icon: RotateCcw,   color: '#EA580C', label: 'Sent for Re-Approval', bg: '#FFF7ED', border: '#FED7AA', dark: '#C2410C' },
};
const DEFAULT_META = { Icon: Clock, color: '#94A3B8', label: 'Action', bg: '#F8FAFC', border: '#E2E8F0', dark: '#64748B' };

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

/* ── Zigzag connector SVG ─────────────────────────────────────────── */
// fromSide: 'left' | 'right'  — which side the PREVIOUS node was on
function ZigzagConnector({ fromSide, actionColor }) {
  const color = actionColor || '#CBD5E1';
  // Going left→right: draw a curve from bottom-right of left card to top-left of right card
  // Going right→left: draw a curve from bottom-left of right card to top-right of left card
  const goingRight = fromSide === 'left';

  return (
    <div style={{ width: '100%', height: 72, position: 'relative', pointerEvents: 'none' }}>
      <svg
        width="100%" height="72"
        viewBox="0 0 400 72"
        preserveAspectRatio="none"
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {goingRight ? (
          // Left node → Right node: start from center-bottom (~35% from left), curve to center-top (~65% from left)
          <>
            <path
              d="M 140 0 C 140 36, 260 36, 260 72"
              stroke={color} strokeWidth="2" fill="none" strokeDasharray="none"
            />
            {/* Arrowhead at bottom right */}
            <polygon points="254,60 260,72 266,60" fill={color} />
          </>
        ) : (
          // Right node → Left node: start from center-bottom (~65% from left), curve to center-top (~35% from left)
          <>
            <path
              d="M 260 0 C 260 36, 140 36, 140 72"
              stroke={color} strokeWidth="2" fill="none"
            />
            {/* Arrowhead at bottom left */}
            <polygon points="134,60 140,72 146,60" fill={color} />
          </>
        )}
      </svg>
    </div>
  );
}

/* ── Flow node card ───────────────────────────────────────────────── */
function FlowNode({ node, isMine, side, viewingDeptId }) {
  const meta = resolveMeta(node.action, node.type === 'vetting', node.amount);
  const { Icon } = meta;
  const isLeft = side === 'left';

  return (
    <div style={{ display: 'flex', justifyContent: isLeft ? 'flex-start' : 'flex-end', width: '100%' }}>
      <div
        style={{
          width: '62%',
          minWidth: 220,
          maxWidth: 340,
          borderRadius: 16,
          border: `2px solid ${isMine ? '#7C3AED' : meta.border}`,
          backgroundColor: isMine ? '#F5F3FF' : meta.bg,
          boxShadow: isMine
            ? '0 0 0 3px #DDD6FE, 0 4px 16px rgba(124,58,237,0.12)'
            : '0 2px 8px rgba(0,0,0,0.06)',
          padding: '14px 16px',
          position: 'relative',
        }}
      >
        {/* YOUR DEPT badge */}
        {isMine && (
          <div style={{
            position: 'absolute',
            top: -13,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#7C3AED',
            color: '#fff',
            fontSize: 9,
            fontWeight: 900,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            padding: '2px 10px',
            borderRadius: 999,
          }}>
            YOUR DEPT
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 10,
              backgroundColor: meta.color + '22',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon size={14} style={{ color: meta.color }} />
            </div>
            <span style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.14em', color: meta.color }}>
              {meta.label}
            </span>
          </div>
          <span style={{ fontSize: 9, color: '#94A3B8', fontFamily: 'monospace', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {fmtDate(node.createdAt)}
          </span>
        </div>

        {/* Department names */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: isMine ? '#5B21B6' : '#1E293B' }}>
            {node.fromName}
          </span>
          {node.toName && (
            <>
              <ArrowRight size={11} style={{ color: '#94A3B8', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: isMine && node.toId === Number(viewingDeptId) ? '#5B21B6' : '#1E293B' }}>
                {node.toName}
              </span>
            </>
          )}
          {node.type === 'approval' && node.stageThreshold > 0 && (
            <span style={{ fontSize: 8, color: '#94A3B8', border: '1px solid #E2E8F0', borderRadius: 4, padding: '1px 6px' }}>
              ≥ ₦{Number(node.stageThreshold).toLocaleString()}
            </span>
          )}
        </div>

        {/* Amount */}
        {node.amount > 0 && (
          <p style={{ fontSize: 12, fontWeight: 900, color: '#0F766E', marginBottom: 4 }}>
            ₦{Number(node.amount).toLocaleString()} disbursed
          </p>
        )}

        {/* Note */}
        {node.note && (
          <p style={{
            fontSize: 10, color: '#64748B', fontStyle: 'italic', lineHeight: 1.4,
            borderLeft: `2px solid ${meta.border}`, paddingLeft: 8, marginBottom: 4,
          }}>
            "{node.note}"
          </p>
        )}

        {/* Actor */}
        {node.actor && (
          <p style={{ fontSize: 9, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            By {node.actor}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────── */
export default function RequisitionFlowPage({ reqId, onBack }) {
  const { user } = useAuth();
  const [req, setReq] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const viewingDeptId   = user?.deptId ? Number(user.deptId) : null;
  const viewingDeptName = user?.name || user?.departmentName || '';

  useEffect(() => {
    if (!reqId) return;
    setLoading(true); setError(null);
    reqAPI.getRequisition(reqId)
      .then(setReq)
      .catch(() => setError('Could not load this requisition.'))
      .finally(() => setLoading(false));
  }, [reqId]);

  /* ── Build timeline ─────────────────────────────────────────────── */
  const timeline = (() => {
    if (!req) return [];
    const items = [];
    (req.forwardEvents || []).forEach(e => {
      const fromId = e.fromDeptId ?? e.fromDepartment?.id;
      const toId   = e.toDeptId   ?? e.toDepartment?.id;
      items.push({
        id: `fw-${e.id}`, type: 'forward',
        action: e.action || 'forwarded',
        fromName: e.fromDepartment?.name || `Dept #${fromId}`,
        toName:   e.toDepartment?.name   || null,
        fromId: Number(fromId), toId: toId ? Number(toId) : null,
        note: e.note, actor: e.actorName, createdAt: e.createdAt, amount: null,
      });
    });
    (req.vettingEvents || []).forEach(e => {
      items.push({
        id: `ve-${e.id}`, type: 'vetting',
        action: e.action || 'vetting',
        fromName: e.deptName || `Dept #${e.deptId}`, toName: null,
        fromId: Number(e.deptId), toId: null,
        note: e.comment, actor: e.actorName, createdAt: e.createdAt,
        amount: e.amountDisbursed || null,
      });
    });
    (req.approvals || []).forEach(a => {
      items.push({
        id: `ap-${a.id}`, type: 'approval',
        action: a.action === 'approved' ? 'stage_approved' : 'stage_rejected',
        fromName: a.stage?.name || a.stage?.role || 'Approval Stage',
        stageRole: a.stage?.role || null,
        stageThreshold: a.stage?.threshold || null,
        toName: null, fromId: null, toId: null,
        note: a.remarks || null, actor: a.user?.name || null,
        createdAt: a.createdAt, amount: null,
      });
    });
    return items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  })();

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

  const effectiveAmount = req ? (req.iccOverrideAmount || req.auditAmount || req.amount || 0) : 0;

  return (
    <div className="min-h-screen bg-background">

      {/* ── Top bar ───────────────────────────────────────────────── */}
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

      {/* ── Viewing-as banner ─────────────────────────────────────── */}
      {viewingDeptName && (
        <div className="px-4 py-2 bg-violet-50/60 border-b border-violet-100/60 text-center">
          <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest">
            Viewing as <span className="text-violet-800">{viewingDeptName}</span>
            {timeline.some(isMyNode) && <span className="ml-2 text-violet-500">— your steps are highlighted</span>}
          </p>
        </div>
      )}

      {/* ── Flowchart body ────────────────────────────────────────── */}
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 20px 60px' }}>

        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <p className="text-sm text-muted-foreground">Loading journey…</p>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700">
            <AlertCircle size={18} />
            <p className="text-sm">{error}</p>
          </div>
        )}
        {!loading && !error && timeline.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            <Clock size={40} className="mx-auto mb-4 opacity-20" />
            <p className="text-sm">No movement recorded yet.</p>
          </div>
        )}

        {!loading && !error && timeline.length > 0 && (
          <div>
            {/* Step counter strip */}
            <div className="flex justify-center mb-8">
              <div className="flex items-center gap-1 bg-muted/40 border border-border/30 rounded-full px-4 py-1.5">
                {timeline.map((_, i) => (
                  <div
                    key={i}
                    style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#8B5CF6', opacity: (i + 1) / timeline.length }}
                  />
                ))}
                <span className="ml-2 text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                  {timeline.length} steps
                </span>
              </div>
            </div>

            {/* Zigzag nodes */}
            {timeline.map((node, idx) => {
              const mine   = isMyNode(node);
              const side   = idx % 2 === 0 ? 'left' : 'right';
              const isLast = idx === timeline.length - 1;
              const meta   = resolveMeta(node.action, node.type === 'vetting', node.amount);
              const prevMeta = idx > 0 ? resolveMeta(timeline[idx - 1].action, timeline[idx - 1].type === 'vetting', timeline[idx - 1].amount) : null;

              return (
                <div key={node.id}>
                  <FlowNode node={node} isMine={mine} side={side} viewingDeptId={viewingDeptId} />
                  {!isLast && (
                    <ZigzagConnector
                      fromSide={side}
                      actionColor={meta.color}
                    />
                  )}
                </div>
              );
            })}

            {/* Current state */}
            {req && (
              <>
                <ZigzagConnector
                  fromSide={timeline.length % 2 === 1 ? 'left' : 'right'}
                  actionColor="#94A3B8"
                />
                <div style={{ display: 'flex', justifyContent: timeline.length % 2 === 0 ? 'flex-start' : 'flex-end', width: '100%' }}>
                  <div style={{
                    width: '62%', minWidth: 220, maxWidth: 340,
                    borderRadius: 16,
                    border: '2px dashed #A78BFA',
                    backgroundColor: '#F5F3FF',
                    padding: '12px 16px',
                    textAlign: 'center',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#8B5CF6', animation: 'pulse 2s infinite' }} />
                      <span style={{ fontSize: 9, fontWeight: 900, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                        Current State
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <StatusPill finalApprovalStatus={req.finalApprovalStatus} status={req.status} />
                      {(req.currentVettingDept?.name || req.currentVettingDeptId) && (
                        <span style={{ fontSize: 10, color: '#6B7280' }}>
                          · with <strong style={{ color: '#1E293B' }}>{req.currentVettingDept?.name || `Dept #${req.currentVettingDeptId}`}</strong>
                        </span>
                      )}
                    </div>
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
