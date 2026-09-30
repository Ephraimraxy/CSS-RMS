import React, { useState, useEffect, useCallback } from 'react';
import { reqAPI } from '../lib/api';
import { iccFreeze, iccUnfreeze, iccComment } from '../lib/store';
import { ProcessingChain } from './RequisitionsPage';
import { toast } from 'react-hot-toast';
import {
  ScanEye, RefreshCcw, Lock, Unlock, MessageSquare, ChevronLeft,
  Loader2, Search, CheckCircle2, XCircle, FileText, Package,
  Banknote, ArrowRight, Shield, Eye, Clock, Gavel, Paperclip,
  AlertTriangle, Award, ShieldCheck
} from 'lucide-react';

const statusColor = (s) => {
  if (!s) return 'bg-muted text-muted-foreground';
  const l = s.toLowerCase();
  if (l === 'approved' || l === 'treated' || l === 'published') return 'bg-emerald-100 text-emerald-700';
  if (l === 'rejected' || l === 'frozen') return 'bg-red-100 text-red-700';
  if (l === 'pending') return 'bg-amber-100 text-amber-700';
  if (l === 'partial payment' || l === 'partial') return 'bg-orange-100 text-orange-700';
  if (l === 'vetting') return 'bg-purple-100 text-purple-700';
  if (l === 'draft') return 'bg-muted text-muted-foreground';
  return 'bg-sky-100 text-sky-700';
};

// Material requests only: the Requisition's `status` column never changes once a
// request enters the vetting/treatment flow (it stays "pending") — the real state
// lives in finalApprovalStatus / iccFrozen instead. Cash/fund requests are untouched —
// their status display already works correctly and must not be altered.
const effectiveStatusLabel = (detail) => {
  if (!/^material/i.test(detail?.type || '')) return detail?.status || '—';
  if (detail.iccFrozen) return 'Frozen';
  const fas = detail.finalApprovalStatus;
  if (fas === 'treated')   return 'Treated';
  if (fas === 'partial')   return 'Partial Payment';
  if (fas === 'published') return 'Published';
  if (fas === 'vetting')   return 'Vetting';
  if (fas === 'approved')  return 'Approved';
  return detail.status || '—';
};

const typeIcon = (type) => {
  const t = (type || '').toLowerCase();
  if (t.includes('memo')) return <FileText size={13} className="shrink-0" />;
  if (t.includes('material')) return <Package size={13} className="shrink-0" />;
  return <Banknote size={13} className="shrink-0" />;
};

const fmt  = (n) => n != null ? `₦${Number(n).toLocaleString()}` : '—';
const fmtDate = (d) => d ? new Date(d).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

// ── Itemized table renderer (shared by creator's table and audit-override table) ──
const ItemsTable = ({ items, total, comment, variant = 'default' }) => {
  const palette = variant === 'audit'
    ? { headerBg: 'bg-purple-100/60', headerText: 'text-purple-700', footerBg: 'bg-purple-50/80', footerBorder: 'border-purple-200', footerText: 'text-purple-800', borderColor: 'border-purple-200' }
    : variant === 'icc'
      ? { headerBg: 'bg-violet-100/60', headerText: 'text-violet-700', footerBg: 'bg-violet-50/80', footerBorder: 'border-violet-200', footerText: 'text-violet-800', borderColor: 'border-violet-200' }
    : variant === 'muted'
      ? { headerBg: 'bg-muted/40', headerText: 'text-muted-foreground', footerBg: 'bg-muted/30', footerBorder: 'border-border/40', footerText: 'text-muted-foreground', borderColor: 'border-border/40' }
      : { headerBg: 'bg-muted/60', headerText: 'text-muted-foreground', footerBg: 'bg-primary/5', footerBorder: 'border-primary/20', footerText: 'text-primary', borderColor: 'border-border/50' };
  return (
    <div className={`overflow-x-auto rounded-xl border ${palette.borderColor} shadow-sm`}>
      {comment && <p className="text-sm text-muted-foreground italic px-3 pt-2">{comment}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className={`${palette.headerBg} border-b ${palette.borderColor}`}>
            <th className={`text-left px-3 py-2.5 text-[10px] font-black ${palette.headerText} uppercase tracking-wider w-8`}>S/N</th>
            <th className={`text-left px-3 py-2.5 text-[10px] font-black ${palette.headerText} uppercase tracking-wider`}>Item Description</th>
            <th className={`text-center px-3 py-2.5 text-[10px] font-black ${palette.headerText} uppercase tracking-wider w-20`}>Qty</th>
            <th className={`text-right px-3 py-2.5 text-[10px] font-black ${palette.headerText} uppercase tracking-wider`}>Unit Price</th>
            <th className={`text-right px-3 py-2.5 text-[10px] font-black ${palette.headerText} uppercase tracking-wider`}>Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {(items || []).map((item, idx) => (
            <tr key={idx} className="bg-white hover:bg-muted/20 transition-colors">
              <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono">{idx + 1}</td>
              <td className="px-3 py-2.5 text-sm font-medium text-foreground">{item.description}</td>
              <td className="px-3 py-2.5 text-xs text-center font-semibold">{item.qty}</td>
              <td className="px-3 py-2.5 text-xs text-right font-mono text-muted-foreground">{fmt(item.amount)}</td>
              <td className="px-3 py-2.5 text-xs text-right font-mono font-bold text-foreground">{fmt(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={`${palette.footerBg} border-t-2 ${palette.footerBorder}`}>
            <td colSpan={4} className={`px-3 py-2.5 text-xs font-black text-right uppercase tracking-widest ${palette.footerText}`}>Grand Total</td>
            <td className={`px-3 py-2.5 text-sm font-black text-right font-mono ${palette.footerText}`}>{fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

// ── Current Status panel — same colored-box pattern used across the app ──────
const CurrentStatusPanel = ({ detail }) => {
  if (detail.iccFrozen) {
    return (
      <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-700">
        <Lock size={16} />
        <span className="text-xs font-bold">Frozen by ICC</span>
      </div>
    );
  }
  const fas = detail.finalApprovalStatus;
  if (fas === 'vetting') {
    return (
      <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center gap-2 text-purple-700">
        <Award size={16} />
        <span className="text-xs font-bold">Under Vetting</span>
      </div>
    );
  }
  if (fas === 'partial') {
    const paid = Number(detail.amountDisbursed || 0);
    const hasReqAmt = Number(detail.amount || 0) > 0;
    const effAmt = (detail.hasIccOverride && detail.iccOverrideAmount != null) ? Number(detail.iccOverrideAmount)
      : (detail.hasAuditOverride && detail.auditAmount != null) ? Number(detail.auditAmount) : Number(detail.amount || 0);
    return (
      <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 space-y-1.5">
        <div className="flex items-center gap-2 text-orange-700">
          <AlertTriangle size={16} />
          <span className="text-xs font-bold">Partial Payment — Balance Pending</span>
        </div>
        {hasReqAmt ? (
          <div className="text-[10px] text-orange-700/80 font-semibold pl-6">
            Paid: ₦{paid.toLocaleString()} of ₦{effAmt.toLocaleString()} {(detail.hasIccOverride || detail.hasAuditOverride) ? 'verified' : 'requested'}
            {' — '}Balance: ₦{(effAmt - paid).toLocaleString()}
          </div>
        ) : paid > 0 && (
          <div className="text-[10px] text-orange-700/80 font-semibold pl-6">Total paid so far — ₦{paid.toLocaleString()}</div>
        )}
      </div>
    );
  }
  if (fas === 'treated') {
    return (
      <div className="p-3 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center gap-2 text-teal-700">
        <CheckCircle2 size={16} />
        <span className="text-xs font-bold">Fully Treated</span>
      </div>
    );
  }
  if (fas === 'published') {
    return (
      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2 text-emerald-700">
        <ShieldCheck size={16} />
        <span className="text-xs font-bold">Published</span>
      </div>
    );
  }
  if (fas === 'approved') {
    return (
      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2 text-emerald-700">
        <ShieldCheck size={16} />
        <span className="text-xs font-bold">Finally Approved – Pending Vetting</span>
      </div>
    );
  }
  if (detail.status === 'rejected') {
    return (
      <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex items-center gap-2 text-destructive">
        <AlertTriangle size={16} />
        <span className="text-xs font-bold">Rejected</span>
      </div>
    );
  }
  if (detail.status === 'pending') {
    return (
      <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center gap-2 text-blue-700">
        <Clock size={16} />
        <span className="text-xs font-bold">{detail.targetDepartment?.name || 'Department'} Review</span>
      </div>
    );
  }
  return (
    <div className="p-3 rounded-xl bg-muted/40 border border-border/40 flex items-center gap-2 text-muted-foreground">
      <Clock size={16} />
      <span className="text-xs font-bold">{detail.status || 'Unknown'}</span>
    </div>
  );
};

// ── Vetting Chain entry — pill-badge style matching the main detail page ─────
// Takes the full VettingEvent — "treated" alone doesn't distinguish full vs partial;
// that's carried in treatmentType, which was previously ignored, mislabeling every
// partial payment as "Fully Treated".
const vettingBadge = (ve) => {
  const a = (ve.action || '').toLowerCase();
  if (a === 'treated') {
    if (ve.treatmentType === 'partial')  return { text: 'Partial Payment',     color: 'bg-orange-100 text-orange-700', icon: AlertTriangle, dot: 'bg-orange-500' };
    if (ve.treatmentType === 'adjusted') return { text: 'Treated (Adjusted)',  color: 'bg-teal-100 text-teal-700',     icon: CheckCircle2,  dot: 'bg-teal-500' };
    return { text: 'Fully Treated', color: 'bg-teal-100 text-teal-700', icon: CheckCircle2, dot: 'bg-teal-500' };
  }
  if (a === 'return')            return { text: 'Returned',       color: 'bg-amber-100 text-amber-700',   icon: XCircle,      dot: 'bg-amber-500' };
  if (a === 'forward')           return { text: 'Forwarded',      color: 'bg-blue-100 text-blue-700',     icon: CheckCircle2, dot: 'bg-blue-500' };
  if (a === 'sent_to_vetting')   return { text: 'Vetting Started', color: 'bg-indigo-100 text-indigo-700', icon: CheckCircle2, dot: 'bg-indigo-500' };
  if (a === 'icc_vet_forward')   return { text: 'Forwarded to ICC', color: 'bg-indigo-100 text-indigo-700', icon: CheckCircle2, dot: 'bg-indigo-500' };
  if (a === 'icc_vet_return')    return { text: 'ICC Vetting Complete', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2, dot: 'bg-emerald-500' };
  return { text: (ve.action || '?').toUpperCase(), color: 'bg-purple-100 text-purple-700', icon: Clock, dot: 'bg-purple-500' };
};

// ── Full detail view (replaces the list when a request is opened) ────────────
const RequestDetail = ({ reqSummary, onBack, onChanged }) => {
  const [detail, setDetail]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment]       = useState('');
  const [freezeNote, setFreezeNote] = useState('');
  const [posting, setPosting]       = useState(false);
  const [freezing, setFreezing]     = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const d = await reqAPI.getRequisition(reqSummary.id);
      setDetail(d);
    } catch {
      toast.error('Could not load request details.');
    } finally { setLoading(false); }
  }, [reqSummary.id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const frozen = !!detail?.iccFrozen;

  const handleComment = async () => {
    if (!comment.trim()) return;
    setPosting(true);
    try {
      await iccComment(reqSummary.id, comment.trim());
      toast.success('Comment posted.');
      setComment('');
      fetchDetail();
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.error || 'Could not post comment.'); }
    finally { setPosting(false); }
  };

  const handleFreeze = async () => {
    if (!freezeNote.trim()) { toast.error('A reason is required to freeze.'); return; }
    setFreezing(true);
    try {
      await iccFreeze(reqSummary.id, freezeNote.trim());
      toast.success('Request frozen — all actions are blocked.');
      setFreezeNote('');
      fetchDetail();
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.error || 'Could not freeze.'); }
    finally { setFreezing(false); }
  };

  const handleUnfreeze = async () => {
    setFreezing(true);
    try {
      await iccUnfreeze(reqSummary.id);
      toast.success('Freeze lifted.');
      fetchDetail();
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.error || 'Could not unfreeze.'); }
    finally { setFreezing(false); }
  };

  // Parse itemized content + audit override
  const parsedContent = (() => {
    if (!detail?.content) return null;
    try { return JSON.parse(detail.content); } catch { return null; }
  })();
  const hasAuditOverride = !!detail?.hasAuditOverride;
  const auditParsed = hasAuditOverride
    ? (() => { try { return JSON.parse(detail.auditContent); } catch { return null; } })()
    : null;
  const hasIccOverride = !!detail?.hasIccOverride;
  const iccParsed = hasIccOverride
    ? (() => { try { return JSON.parse(detail.iccOverrideContent); } catch { return null; } })()
    : null;

  const vettingOnly = (detail?.vettingEvents || []).filter(ve => !/^icc_(freeze|unfreeze|comment)$/i.test(ve.action || ''));
  const iccOnly      = (detail?.vettingEvents || []).filter(ve => /^icc_(freeze|unfreeze|comment)$/i.test(ve.action || ''));
  const forwardEvents = [...(detail?.forwardEvents || [])].reverse();

  return (
    <div className="space-y-5">
      <button onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft size={14} /> Back to all requests
      </button>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">Loading full request detail…</span>
        </div>
      ) : !detail ? (
        <p className="text-sm text-muted-foreground">Could not load this request.</p>
      ) : (
        <div className="bg-white rounded-2xl border border-border/50 overflow-hidden">
          {/* Header */}
          <div className="p-5 border-b border-border/40 flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-muted-foreground/50">{typeIcon(detail.type)}</div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-black text-foreground">{detail.title || detail.description || 'Untitled'}</h2>
                  {frozen && <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-red-100 text-red-600 flex items-center gap-1"><Lock size={9} /> Frozen</span>}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5">
                  <span className="text-[11px] text-muted-foreground font-medium">{detail.department?.name || reqSummary.department}</span>
                  {(detail.targetDepartment?.name) && <><ArrowRight size={10} className="text-muted-foreground/40" /><span className="text-[11px] text-muted-foreground">{detail.targetDepartment.name}</span></>}
                  <span className="text-[11px] text-muted-foreground">{fmtDate(detail.createdAt)}</span>
                  {detail.refCode && <span className="text-[11px] font-mono text-primary/70">{detail.refCode}</span>}
                </div>
              </div>
            </div>
            {(() => {
              const effAmt = hasIccOverride && detail.iccOverrideAmount != null ? detail.iccOverrideAmount
                : hasAuditOverride && detail.auditAmount != null ? detail.auditAmount : detail.amount;
              const label = effectiveStatusLabel(detail);
              return (
                <div className="text-right">
                  {Number(effAmt) > 0 && <p className="text-lg font-black text-foreground">{fmt(effAmt)}</p>}
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${statusColor(label)}`}>{label}</span>
                </div>
              );
            })()}
          </div>

          {/* Two-column body — left: content, right: status/chains, matching the main detail page pattern */}
          <div className="grid lg:grid-cols-3 gap-6 p-5">
            {/* Left column — content */}
            <div className="lg:col-span-2 space-y-6">
              {detail.description && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-foreground/70 uppercase tracking-[0.15em] flex items-center gap-1.5"><FileText size={11} /> Requisition Brief</p>
                  <p className="text-sm font-medium text-foreground leading-relaxed bg-muted/20 p-3.5 rounded-xl border border-border/40">{detail.description}</p>
                </div>
              )}

              {parsedContent?.itemized && Array.isArray(parsedContent.items) && parsedContent.items.length > 0 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Paperclip size={12} className="text-primary" />
                      <p className="text-[10px] font-black text-foreground/70 uppercase tracking-[0.15em]">{(hasAuditOverride || hasIccOverride) ? "Creator's Estimate (Original)" : 'Item Details'}</p>
                      {(hasAuditOverride || hasIccOverride) && <span className="px-2 py-0.5 rounded-full text-[8px] font-black bg-muted border border-border text-muted-foreground uppercase">For Reference</span>}
                    </div>
                    <ItemsTable items={parsedContent.items} total={parsedContent.total} comment={parsedContent.comment} variant={(hasAuditOverride || hasIccOverride) ? 'muted' : 'default'} />
                  </div>

                  {hasAuditOverride && auditParsed?.items?.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Gavel size={12} className="text-purple-600" />
                        <p className="text-[10px] font-black text-purple-800 uppercase tracking-[0.15em]">Audit Verified Amount</p>
                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase border ${hasIccOverride ? 'bg-muted border-border text-muted-foreground' : 'bg-purple-100 border-purple-300 text-purple-700'}`}>
                          {hasIccOverride ? 'Superseded by ICC' : 'Effective for Approval & Payment'}
                        </span>
                      </div>
                      {detail.auditDeptName && <p className="text-[10px] text-purple-600/80">Verified by: <span className="font-bold">{detail.auditDeptName}</span></p>}
                      <ItemsTable items={auditParsed.items} total={auditParsed.total} comment={auditParsed.comment} variant={hasIccOverride ? 'muted' : 'audit'} />
                    </div>
                  )}

                  {hasIccOverride && iccParsed?.items?.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Gavel size={12} className="text-violet-600" />
                        <p className="text-[10px] font-black text-violet-800 uppercase tracking-[0.15em]">ICC Verified Amount</p>
                        <span className="px-2 py-0.5 rounded-full text-[8px] font-black bg-violet-100 border border-violet-300 text-violet-700 uppercase">Effective for Approval &amp; Payment</span>
                      </div>
                      {detail.iccOverrideDeptName && <p className="text-[10px] text-violet-600/80">Verified by: <span className="font-bold">{detail.iccOverrideDeptName}</span></p>}
                      <ItemsTable items={iccParsed.items} total={iccParsed.total} comment={iccParsed.comment} variant="icc" />
                    </div>
                  )}
                </div>
              )}

              {parsedContent && !parsedContent.itemized && parsedContent.description && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-foreground/70 uppercase tracking-[0.15em]">Material Description</p>
                  <p className="text-sm text-foreground leading-relaxed bg-muted/20 p-3.5 rounded-xl border border-border/40 whitespace-pre-wrap">{parsedContent.description}</p>
                </div>
              )}

              {/* Approval Chain — Cash workflow approvals, when present */}
              {(detail.approvals || []).length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.1em] flex items-center gap-1.5"><Shield size={11} /> Approval Trail</p>
                  <div className="space-y-2">
                    {detail.approvals.map((ap, i) => {
                      const approved = /approv/i.test(ap.action);
                      const rejected = /reject/i.test(ap.action);
                      return (
                        <div key={i} className={`flex items-start gap-3 p-2.5 rounded-xl border text-xs ${approved ? 'border-emerald-200 bg-emerald-50/50' : rejected ? 'border-red-200 bg-red-50/50' : 'border-border/50 bg-muted/20'}`}>
                          <div className={`mt-0.5 shrink-0 ${approved ? 'text-emerald-500' : rejected ? 'text-red-500' : 'text-amber-500'}`}>
                            {approved ? <CheckCircle2 size={14} /> : rejected ? <XCircle size={14} /> : <Clock size={14} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-foreground">{ap.stage?.name || 'Stage'}</p>
                            <p className="text-muted-foreground text-[10px]">{ap.user?.name || '—'} · {fmtDate(ap.createdAt)}</p>
                            {ap.note && <p className="text-[10px] italic text-foreground/60 mt-0.5">"{ap.note}"</p>}
                          </div>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full shrink-0 ${approved ? 'bg-emerald-100 text-emerald-700' : rejected ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{ap.action}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ICC Actions */}
              <div className="space-y-2">
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.1em] flex items-center gap-1.5"><Lock size={11} /> ICC Actions</p>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div className={`p-3 rounded-xl border space-y-2 ${frozen ? 'border-red-200 bg-red-50' : 'border-border/50 bg-muted/10'}`}>
                    <p className="text-[10px] font-bold text-foreground/60">{frozen ? `Frozen — ${detail.iccFreezeNote || 'No reason given'}` : 'Freeze this request'}</p>
                    {frozen ? (
                      <button onClick={handleUnfreeze} disabled={freezing}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all disabled:opacity-50">
                        {freezing ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />} Lift Freeze
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        <input value={freezeNote} onChange={e => setFreezeNote(e.target.value)}
                          placeholder="Reason for freeze…"
                          className="flex-1 text-xs bg-white border border-border/50 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-red-200" />
                        <button onClick={handleFreeze} disabled={freezing || !freezeNote.trim()}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all disabled:opacity-50">
                          {freezing ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />} Freeze
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="p-3 rounded-xl border border-border/50 bg-muted/10 space-y-2">
                    <p className="text-[10px] font-bold text-foreground/60">Post ICC observation</p>
                    <div className="flex gap-2">
                      <input value={comment} onChange={e => setComment(e.target.value)}
                        placeholder="Leave an observation note…"
                        className="flex-1 text-xs bg-white border border-border/50 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20" />
                      <button onClick={handleComment} disabled={posting || !comment.trim()}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold transition-all disabled:opacity-50">
                        {posting ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />} Post
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right column — Current Status, Vetting Chain, ICC Observation Log, Processing Chain */}
            <div className="lg:col-span-1 space-y-5">
              <div className="space-y-2">
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.1em]">Current Status</p>
                <CurrentStatusPanel detail={detail} />
              </div>

              {vettingOnly.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.1em]">Vetting Chain</p>
                    <div className="w-5 h-5 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-600 text-[9px] font-bold">{vettingOnly.length}</div>
                  </div>
                  <div className="space-y-2">
                    {[...vettingOnly].reverse().map((ve, i) => {
                      const badge = vettingBadge(ve);
                      return (
                        <div key={i} className="flex gap-2.5 p-3 rounded-xl border border-border/30 bg-white shadow-sm">
                          <div className={`w-6 h-6 rounded-full ${badge.dot} flex items-center justify-center shrink-0 mt-0.5 shadow-sm`}>
                            <badge.icon size={11} className="text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap mb-1">
                              <span className="text-[11px] font-black text-foreground">{ve.deptName || '—'}</span>
                              <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full ${badge.color}`}>{badge.text}</span>
                            </div>
                            {ve.amountDisbursed != null && (
                              <p className="text-[10px] font-bold text-foreground/80">Amount this stage: ₦{Number(ve.amountDisbursed).toLocaleString()}</p>
                            )}
                            {ve.comment && <p className="text-[10px] text-muted-foreground leading-relaxed">"{ve.comment}"</p>}
                            <p className="text-[8px] text-muted-foreground/50 mt-1 font-mono">{fmtDate(ve.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {iccOnly.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.1em]">ICC Observation Log</p>
                    <div className="w-5 h-5 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-600 text-[9px] font-bold">{iccOnly.length}</div>
                  </div>
                  <div className="space-y-2">
                    {[...iccOnly].reverse().map((ve, i) => {
                      const isFreeze = ve.action === 'icc_freeze';
                      const isUnfreeze = ve.action === 'icc_unfreeze';
                      const badgeText = isFreeze ? '🔒 ICC Freeze' : isUnfreeze ? '🔓 ICC Unfrozen' : 'ICC Comment';
                      const badgeColor = isFreeze ? 'bg-red-100 text-red-700' : isUnfreeze ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700';
                      const iconColor = isFreeze ? 'bg-red-500' : isUnfreeze ? 'bg-emerald-500' : 'bg-indigo-500';
                      return (
                        <div key={i} className="flex gap-2.5 p-3 rounded-xl border border-indigo-200/60 bg-indigo-50/40 shadow-sm">
                          <div className={`w-6 h-6 rounded-full ${iconColor} flex items-center justify-center shrink-0 mt-0.5 shadow-sm`}>
                            <Eye size={11} className="text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap mb-1">
                              <span className="text-[11px] font-black text-foreground">{ve.deptName || 'ICC'}</span>
                              <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full ${badgeColor}`}>{badgeText}</span>
                            </div>
                            {ve.comment && <p className="text-[10px] text-muted-foreground leading-relaxed">"{ve.comment}"</p>}
                            <p className="text-[8px] text-muted-foreground/50 mt-1 font-mono">{fmtDate(ve.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {forwardEvents.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.1em]">Processing Chain</p>
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[9px] font-bold">{forwardEvents.length}</div>
                  </div>
                  <ProcessingChain events={forwardEvents} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── List row (summary only — click to open full detail) ──────────────────────
const RequestListRow = ({ req, onOpen }) => (
  <button onClick={() => onOpen(req)}
    className={`w-full flex items-start gap-3 p-4 text-left rounded-2xl border transition-all hover:bg-muted/20 ${req.iccFrozen ? 'border-red-300 bg-red-50/30' : 'border-border/60 bg-white'}`}>
    <div className={`mt-0.5 shrink-0 ${req.iccFrozen ? 'text-red-500' : 'text-muted-foreground/50'}`}>{typeIcon(req.type)}</div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold text-foreground truncate">{req.title || req.description || 'Untitled'}</span>
        <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground/70">{(req.type || '—').replace(/requisition|memorandum/i, m => m)}</span>
        {req.iccFrozen && <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-red-100 text-red-600 flex items-center gap-1"><Lock size={9} /> Frozen</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
        <span className="text-[10px] text-muted-foreground font-medium">{req.department}</span>
        {req.targetDepartmentName && <><ArrowRight size={9} className="text-muted-foreground/40" /><span className="text-[10px] text-muted-foreground">{req.targetDepartmentName}</span></>}
        <span className="text-[10px] text-muted-foreground">{fmtDate(req.createdAt)}</span>
        {req.refCode && <span className="text-[10px] font-mono text-primary/70">{req.refCode}</span>}
      </div>
    </div>
    <div className="flex items-center gap-2 shrink-0">
      {Number(req.amount) > 0 && <span className="text-xs font-bold text-foreground">{fmt(req.amount)}</span>}
      {(() => { const label = effectiveStatusLabel(req); return (
        <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${statusColor(label)}`}>{label}</span>
      ); })()}
    </div>
  </button>
);

// ── Main page ─────────────────────────────────────────────────────────────────
export default function IccOversightPage() {
  const [records, setRecords]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType]     = useState('all');
  const [showFrozenOnly, setShowFrozenOnly] = useState(false);
  const [openReq, setOpenReq]           = useState(null); // the single request currently being viewed

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch every record type explicitly — default scope can silently exclude some types
      const [cashMaterial, memos] = await Promise.all([
        reqAPI.getRequisitions({ scope: 'requisitions' }).catch(() => []),
        reqAPI.getRequisitions({ scope: 'memos' }).catch(() => []),
      ]);
      const toArr = (d) => Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : []);
      const raw = [...toArr(cashMaterial), ...toArr(memos)];
      const seen = new Set();
      const list = raw.filter(r => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      }).map(r => ({
        ...r,
        department:          r.department?.name || (typeof r.department === 'string' ? r.department : null) || r.departmentName || '—',
        targetDepartmentName: r.targetDepartment?.name || (typeof r.targetDepartment === 'string' ? r.targetDepartment : null) || r.targetDepartmentName || null,
      }));
      setRecords(list);
    } catch { toast.error('Could not load records.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('globalHardRefresh', handler);
    return () => window.removeEventListener('globalHardRefresh', handler);
  }, [load]);

  const filtered = records.filter(r => {
    if (showFrozenOnly && !r.iccFrozen) return false;
    if (filterStatus !== 'all' && r.status?.toLowerCase() !== filterStatus) return false;
    if (filterType !== 'all') {
      const t = (r.type || '').toLowerCase();
      if (filterType === 'cash' && !t.includes('cash')) return false;
      if (filterType === 'material' && !t.includes('material')) return false;
      if (filterType === 'memo' && !t.includes('memo')) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return (r.title || r.description || '').toLowerCase().includes(q)
          || (r.department || '').toLowerCase().includes(q)
          || (r.refCode || '').toLowerCase().includes(q);
    }
    return true;
  });

  const frozenCount = records.filter(r => r.iccFrozen).length;

  // ── Detail view ──
  if (openReq) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] p-6">
        <RequestDetail reqSummary={openReq} onBack={() => setOpenReq(null)} onChanged={load} />
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="min-h-screen bg-[#FAF9F6] p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-600/10 border border-indigo-200">
            <ScanEye size={20} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-black text-foreground">Oversight Console</h1>
            <p className="text-xs text-muted-foreground mt-0.5">ICC — Global observer. Click any request to view its full details &amp; trail.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {frozenCount > 0 && (
            <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full bg-red-100 text-red-600 flex items-center gap-1.5">
              <Lock size={10} /> {frozenCount} frozen
            </span>
          )}
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border/50 text-xs font-bold hover:bg-muted transition-all disabled:opacity-50">
            <RefreshCcw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',    value: records.length,                                                       color: 'text-foreground'  },
          { label: 'Pending',  value: records.filter(r => r.status === 'pending').length,                   color: 'text-amber-600'   },
          { label: 'Approved', value: records.filter(r => r.status === 'approved' || r.finalApprovalStatus === 'treated').length, color: 'text-emerald-600' },
          { label: 'Frozen',   value: frozenCount,                                                          color: 'text-red-600'     },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-border/50 p-4">
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{label}</p>
            <p className={`text-2xl font-black mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by title, dept, ref code…"
            className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-border/50 rounded-xl outline-none focus:ring-2 focus:ring-primary/20" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="text-xs bg-white border border-border/50 rounded-xl px-3 py-2 outline-none">
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="draft">Draft</option>
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="text-xs bg-white border border-border/50 rounded-xl px-3 py-2 outline-none">
          <option value="all">All Types</option>
          <option value="cash">Cash</option>
          <option value="material">Material</option>
          <option value="memo">Memo</option>
        </select>
        <button onClick={() => setShowFrozenOnly(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all ${showFrozenOnly ? 'bg-red-600 text-white border-red-600' : 'bg-white border-border/50 text-muted-foreground hover:border-red-300 hover:text-red-600'}`}>
          <Lock size={11} /> Frozen only
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm font-medium">Loading all records…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <ScanEye size={36} className="text-muted-foreground/30" />
          <p className="text-sm font-bold text-muted-foreground">No records match your filters</p>
          <p className="text-xs text-muted-foreground/70">Try adjusting filters or refresh to load latest data</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">
            {filtered.length} record{filtered.length !== 1 ? 's' : ''} — click one to open its full detail &amp; trail
          </p>
          {filtered.map(req => (
            <RequestListRow key={req.id || req.clientId} req={req} onOpen={setOpenReq} />
          ))}
        </div>
      )}
    </div>
  );
}
