import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Plus, Trash2, Shield, ArrowDown, Settings2, Info, FileText, ChevronRight, Save, Loader2, Monitor, Hash, ShieldCheck, Sparkles, Printer, Award, Phone, Send, CheckCircle2, Wifi, WifiOff, AlertCircle, RotateCcw, Mail, Eye, X, AlertTriangle, Zap, BadgeCheck, ArrowRight, Clock, PenTool, MessageSquare, Image, Upload } from 'lucide-react';

const WorkflowStage = ({ stage, onUpdate, onDelete, isFirst }) => {
  return (
    <div className="relative flex flex-col items-center w-full">
      {!isFirst && (
        <div className="h-8 w-px bg-border flex items-center justify-center">
           <ArrowDown size={14} className="text-muted-foreground" />
        </div>
      )}
      
      <div className="glass bg-white/60 w-full max-w-md p-5 rounded-2xl border border-border/50 relative group hover:border-primary/30 transition-all shadow-sm hover:shadow-md">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
             <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs shadow-sm">
                {stage.sequence}
             </div>
             <input 
                type="text" 
                value={stage.name}
                onChange={(e) => onUpdate({ ...stage, name: e.target.value })}
                className="bg-transparent border-none text-foreground font-bold text-sm focus:outline-none focus:ring-0 w-32"
                placeholder="Stage Name"
             />
          </div>
          <button onClick={onDelete} className="p-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all">
            <Trash2 size={16} />
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Authorized Role</label>
          <div className="flex items-center space-x-2 bg-white/80 rounded-lg px-3 py-2 border border-border/50 shadow-sm">
            <Shield size={12} className="text-muted-foreground" />
            <select
              value={stage.role}
              onChange={(e) => onUpdate({ ...stage, role: e.target.value })}
              className="bg-transparent border-none text-xs text-foreground focus:outline-none w-full cursor-pointer"
            >
              <option value="Admin" className="bg-background">Admin</option>
              <option value="Audit" className="bg-background">Audit</option>
              <option value="Procurement" className="bg-background">Procurement</option>
              <option value="Finance" className="bg-background">Finance</option>
              <option value="GM" className="bg-background">General Manager</option>
              <option value="Chairman" className="bg-background">Chairman</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

import { getWorkflows, updateWorkflows, getRequisitionTypes, addRequisitionType, deleteRequisitionType } from '../lib/store';
import { settingsAPI, adminAPI } from '../lib/api';
import { useAIFeatures } from '../context/AIFeaturesContext';
import { toast } from 'react-hot-toast';
import ConfirmModal from './ConfirmModal';

// ── Deleted Record Detail Modal ───────────────────────────────────────────────
const DeletedRecordModal = ({ rec, onClose }) => {
  const s = rec.snapshot || {};
  const fmtDate = (d) => d ? new Date(d).toLocaleString() : '—';
  const fmtMoney = (v) => v != null ? `₦${Number(v).toLocaleString()}` : null;
  const typeColor = s.type === 'Cash' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : s.type === 'Memo' ? 'text-amber-700 bg-amber-50 border-amber-200'
    : 'text-blue-700 bg-blue-50 border-blue-200';

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    const trail = (s.forwardEvents || []).map(e => `<tr><td>${new Date(e.createdAt).toLocaleString()}</td><td style="text-transform:uppercase;font-weight:700">${e.action}</td><td>${e.fromDepartment?.name || '—'}</td><td>${e.toDepartment?.name || 'N/A'}</td><td>${e.actorName || '—'}</td><td>${e.note || '—'}</td></tr>`).join('');
    const approvals = (s.approvals || []).map(a => `<tr><td>${a.stage?.name || '—'}</td><td style="color:${a.action==='approved'?'green':'red'};font-weight:700;text-transform:uppercase">${a.action}</td><td>${a.user?.name || '—'}</td><td>${a.remarks || '—'}</td><td>${new Date(a.createdAt).toLocaleString()}</td><td>${a.signature?.verificationCode || '—'}</td></tr>`).join('');
    const vetting = (s.vettingEvents || []).map(v => `<tr><td>${new Date(v.createdAt).toLocaleString()}</td><td>${v.deptName || '—'}</td><td style="font-weight:700;text-transform:uppercase">${v.action}</td><td>${v.actorName || '—'}</td><td>${v.comment || '—'}</td></tr>`).join('');
    const atts = (s.attachments || []).map(a => `<tr><td>${a.filename}</td><td>${a.fileType || '—'}</td><td>${a.stageName || '—'}</td><td>${a.size ? (a.size/1024).toFixed(1)+' KB' : '—'}</td><td>${new Date(a.createdAt).toLocaleString()}</td></tr>`).join('');
    win.document.write(`<!DOCTYPE html><html><head><title>Deleted Record #${rec.originalId}</title><style>body{font-family:Arial,sans-serif;padding:30px;color:#111;font-size:12px}h1{font-size:20px;font-weight:900;margin-bottom:4px}h2{font-size:13px;font-weight:800;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.12em;border-bottom:1px solid #ddd;padding-bottom:4px}.badge{display:inline-block;padding:2px 10px;border-radius:6px;font-size:10px;font-weight:700;text-transform:uppercase}.grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:12px}.label{font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:.1em}.val{font-size:12px;font-weight:600;color:#111}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#f5f5f5;padding:6px 8px;font-weight:700;text-align:left;font-size:9px;text-transform:uppercase;border-bottom:2px solid #ddd}td{padding:5px 8px;border-bottom:1px solid #eee}.del-box{background:#fff3f3;border:1px solid #fca5a5;border-radius:8px;padding:12px 16px;margin-top:24px}@media print{button{display:none}}</style></head><body><h1>Deleted Record #${rec.originalId}</h1><span class="badge" style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5">${s.type||'Record'}</span>&nbsp;&nbsp;<span style="font-size:11px;color:#666">Archived on ${fmtDate(rec.deletedAt)} by ${rec.deletedByName||'Unknown'}</span><h2>Record Details</h2><div class="grid"><div><p class="label">Title</p><p class="val">${s.title||'—'}</p></div><div><p class="label">Amount</p><p class="val">${fmtMoney(s.amount)||'Non-financial'}</p></div><div><p class="label">Origin Department</p><p class="val">${s.department?.name||'—'}</p></div><div><p class="label">Target Department</p><p class="val">${s.targetDepartment?.name||'—'}</p></div><div><p class="label">Status at Deletion</p><p class="val">${s.status||'—'} / ${s.finalApprovalStatus||'none'}</p></div><div><p class="label">Creator</p><p class="val">${s.creator?.name||'—'}</p></div></div>${s.description?`<p class="label">Description</p><pre style="font-size:12px;color:#333;border:1px solid #eee;border-radius:4px;padding:10px;background:#fafafa;white-space:pre-wrap">${s.description}</pre>`:''}${trail?`<h2>Processing Trail</h2><table><thead><tr><th>Date/Time</th><th>Action</th><th>From</th><th>To</th><th>Actor</th><th>Note</th></tr></thead><tbody>${trail}</tbody></table>`:''}${approvals?`<h2>Approvals</h2><table><thead><tr><th>Stage</th><th>Decision</th><th>Officer</th><th>Remarks</th><th>Date/Time</th><th>Sig. Code</th></tr></thead><tbody>${approvals}</tbody></table>`:''}${vetting?`<h2>Vetting Events</h2><table><thead><tr><th>Date/Time</th><th>Department</th><th>Action</th><th>Actor</th><th>Comment</th></tr></thead><tbody>${vetting}</tbody></table>`:''}${atts?`<h2>Attachments (metadata only)</h2><table><thead><tr><th>Filename</th><th>Type</th><th>Stage</th><th>Size</th><th>Uploaded</th></tr></thead><tbody>${atts}</tbody></table>`:''}<div class="del-box"><strong>⚠ Deletion Record</strong><br/>Deleted by <strong>${rec.deletedByName||'Unknown'}</strong> from <strong>${rec.departmentName||'—'}</strong> on ${fmtDate(rec.deletedAt)}. This is an archived copy stored only in the super admin bin.</div><script>window.onload=()=>window.print();</script></body></html>`);
    win.document.close();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-start justify-center overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-3xl border border-border/50 shadow-2xl w-full max-w-4xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-6 border-b border-border/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center">
              <FileText size={18} className="text-red-500" />
            </div>
            <div>
              <h2 className="text-base font-black text-foreground tracking-tight">Archived Record <span className="text-red-500">#{rec.originalId}</span></h2>
              <p className="text-[10px] text-muted-foreground/70 font-medium mt-0.5">Deleted by {rec.deletedByName || '—'} · {new Date(rec.deletedAt).toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-[10px] font-black uppercase tracking-widest hover:bg-primary/90 transition-all active:scale-95 shadow-md">
              <Printer size={13} />Print Record
            </button>
            <button onClick={onClose} className="p-2 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"><X size={18} /></button>
          </div>
        </div>
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh] custom-scrollbar">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 bg-muted/20 rounded-2xl border border-border/30">
            {[['Type', <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border ${typeColor}`}>{s.type||'—'}</span>],['Title', s.title||'—'],['Amount', fmtMoney(s.amount)||<span className="text-muted-foreground/50 text-xs italic font-normal">Non-financial</span>],['Origin Dept', s.department?.name||rec.departmentName||'—'],['Target Dept', s.targetDepartment?.name||'—'],['Urgency', s.urgency||'Normal'],['Status at Deletion', `${s.status||'—'} / ${s.finalApprovalStatus||'none'}`],['Creator', s.creator?.name||'—'],['Created', fmtDate(s.createdAt)]].map(([label, val], i) => (
              <div key={i}><p className="text-[9px] font-black text-muted-foreground/60 uppercase tracking-widest mb-1">{label}</p><p className="text-sm font-bold text-foreground leading-tight">{val}</p></div>
            ))}
          </div>
          {s.description && <div><p className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest mb-2">Description / Content</p><p className="text-sm text-foreground leading-relaxed bg-muted/20 border border-border/30 rounded-xl p-4 whitespace-pre-wrap">{s.description}</p></div>}
          {(s.forwardEvents||[]).length > 0 && <div><p className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest mb-3 flex items-center gap-2"><ArrowRight size={12}/> Processing Trail ({s.forwardEvents.length} events)</p><div className="space-y-2">{s.forwardEvents.map((e,i)=>(<div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-muted/20 border border-border/20"><div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[9px] font-black shrink-0 mt-0.5">{i+1}</div><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${e.action==='forwarded'?'bg-blue-50 border-blue-200 text-blue-700':e.action==='created'?'bg-emerald-50 border-emerald-200 text-emerald-700':'bg-amber-50 border-amber-200 text-amber-700'}`}>{e.action}</span><span className="text-[10px] font-bold text-foreground">{e.fromDepartment?.name||'—'}</span>{e.toDepartment?.name&&<><ArrowRight size={10} className="text-muted-foreground/40"/><span className="text-[10px] font-black text-primary">{e.toDepartment.name}</span></>}{e.actorName&&<span className="text-[9px] text-muted-foreground/70 ml-auto">by {e.actorName}</span>}</div>{e.note&&<p className="text-[10px] text-muted-foreground/80 mt-1 italic">"{e.note}"</p>}<p className="text-[9px] font-mono text-muted-foreground/50 mt-1">{fmtDate(e.createdAt)}</p></div></div>))}</div></div>}
          {(s.approvals||[]).length > 0 && <div><p className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest mb-3 flex items-center gap-2"><ShieldCheck size={12}/> Stage Approvals ({s.approvals.length})</p><div className="overflow-x-auto"><table className="w-full text-left border-separate border-spacing-y-1"><thead><tr className="text-[9px] font-black text-muted-foreground/60 uppercase tracking-widest"><th className="pb-2 px-3">Stage</th><th className="pb-2 px-3">Decision</th><th className="pb-2 px-3">Officer</th><th className="pb-2 px-3">Remarks</th><th className="pb-2 px-3">Date</th><th className="pb-2 px-3">Sig. Code</th></tr></thead><tbody>{s.approvals.map((a,i)=>(<tr key={i}><td className="py-2 px-3 bg-muted/20 border-y border-l border-border/20 rounded-l-lg text-[10px] font-bold text-foreground">{a.stage?.name||'—'}</td><td className="py-2 px-3 bg-muted/20 border-y border-border/20"><span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${a.action==='approved'?'bg-emerald-50 border-emerald-200 text-emerald-700':'bg-red-50 border-red-200 text-red-700'}`}>{a.action}</span></td><td className="py-2 px-3 bg-muted/20 border-y border-border/20 text-[10px] font-medium text-foreground">{a.user?.name||'—'}</td><td className="py-2 px-3 bg-muted/20 border-y border-border/20 text-[10px] text-muted-foreground max-w-[140px] truncate">{a.remarks||'—'}</td><td className="py-2 px-3 bg-muted/20 border-y border-border/20 text-[9px] font-mono text-muted-foreground/70">{fmtDate(a.createdAt)}</td><td className="py-2 px-3 bg-muted/20 border-y border-r border-border/20 rounded-r-lg text-[9px] font-mono text-primary/70">{a.signature?.verificationCode||'—'}</td></tr>))}</tbody></table></div></div>}
          {(s.vettingEvents||[]).length > 0 && <div><p className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest mb-3 flex items-center gap-2"><Clock size={12}/> Vetting Events ({s.vettingEvents.length})</p><div className="space-y-2">{s.vettingEvents.map((v,i)=>(<div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-purple-50/40 border border-purple-100/60"><div><div className="flex items-center gap-2 flex-wrap"><span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-lg bg-purple-100 border border-purple-200 text-purple-700">{v.action}</span><span className="text-[10px] font-bold text-foreground">{v.deptName||'—'}</span>{v.actorName&&<span className="text-[9px] text-muted-foreground/70 ml-auto">by {v.actorName}</span>}</div>{v.comment&&<p className="text-[10px] text-muted-foreground/80 mt-1 italic">"{v.comment}"</p>}<p className="text-[9px] font-mono text-muted-foreground/50 mt-1">{fmtDate(v.createdAt)}</p></div></div>))}</div></div>}
          {(s.attachments||[]).length > 0 && <div><p className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest mb-2 flex items-center gap-2"><BadgeCheck size={12}/> Attachments — metadata only ({s.attachments.length})</p><div className="space-y-1.5">{s.attachments.map((a,i)=>(<div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/20 border border-border/20"><FileText size={12} className="text-muted-foreground/50 shrink-0"/><span className="text-[11px] font-bold text-foreground flex-1 truncate">{a.filename}</span><span className="text-[9px] text-muted-foreground/60">{a.fileType||'—'}</span>{a.stageName&&<span className="text-[9px] px-2 py-0.5 rounded-lg bg-muted border border-border/40 text-muted-foreground">{a.stageName}</span>}{a.size&&<span className="text-[9px] font-mono text-muted-foreground/50">{(a.size/1024).toFixed(1)} KB</span>}</div>))}</div></div>}
          <div className="flex items-start gap-3 p-4 bg-red-50/60 border border-red-200/60 rounded-2xl">
            <Trash2 size={16} className="text-red-500 shrink-0 mt-0.5" />
            <div><p className="text-[11px] font-black text-red-700 uppercase tracking-widest">Archived by Department Deletion</p><p className="text-[10px] text-red-600/80 mt-0.5">Deleted by <strong>{rec.deletedByName||'—'}</strong> ({rec.departmentName||'—'}) on {fmtDate(rec.deletedAt)}. All active records and file data have been permanently removed. This snapshot exists only in the super admin bin.</p></div>
          </div>
        </div>
      </div>
    </div>
  );
};

const WorkflowBuilder = ({ onViewChange }) => {
  const { user } = useAuth();
  const [stages, setStages] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('features');
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [pendingStage, setPendingStage] = useState(null);
  const [pendingType, setPendingType] = useState(null);
  const [newTypeName, setNewTypeName] = useState('');

  // ── Reference code pattern ────────────────────────────────────────────────
  const [refPattern, setRefPattern] = useState({ orgPrefix: 'CSSG', typeCash: 'FR', typeMaterial: 'MR', typeMemo: 'MO' });
  const [savingRef, setSavingRef]   = useState(false);

  // ── Desktop client sync — a separate desktop attendance app (no RMS
  // login of its own) polls GET /api/sync/heartbeat and reads these same
  // SystemSetting keys to decide whether it stays active. Own load/save,
  // same pattern as refPattern above, since it's an unrelated concern
  // from the on/off Feature Controls grid below.
  const [syncSettings, setSyncSettings] = useState({
    enabled: true, expiresAt: '', message: '',
    latestVersion: '', downloadUrl: '', releaseNotes: '',
  });
  const [syncLoaded, setSyncLoaded] = useState(false);
  const [savingSync, setSavingSync] = useState(false);

  const loadSyncSettings = async () => {
    try {
      const [e, exp, msg, ver, url, notes] = await Promise.all([
        settingsAPI.get('desktop_sync_enabled').catch(() => ({ value: 'true' })),
        settingsAPI.get('desktop_sync_expires_at').catch(() => ({ value: '' })),
        settingsAPI.get('desktop_sync_message').catch(() => ({ value: '' })),
        settingsAPI.get('desktop_app_latest_version').catch(() => ({ value: '' })),
        settingsAPI.get('desktop_app_download_url').catch(() => ({ value: '' })),
        settingsAPI.get('desktop_app_release_notes').catch(() => ({ value: '' })),
      ]);
      setSyncSettings({
        enabled: (e?.value ?? 'true') !== 'false',
        expiresAt: exp?.value || '',
        message: msg?.value || '',
        latestVersion: ver?.value || '',
        downloadUrl: url?.value || '',
        releaseNotes: notes?.value || '',
      });
    } catch {}
    setSyncLoaded(true);
  };

  const saveSyncSettings = async () => {
    setSavingSync(true);
    try {
      await Promise.all([
        settingsAPI.set('desktop_sync_enabled', syncSettings.enabled ? 'true' : 'false'),
        settingsAPI.set('desktop_sync_expires_at', syncSettings.expiresAt || ''),
        settingsAPI.set('desktop_sync_message', syncSettings.message || ''),
        settingsAPI.set('desktop_app_latest_version', syncSettings.latestVersion || ''),
        settingsAPI.set('desktop_app_download_url', syncSettings.downloadUrl || ''),
        settingsAPI.set('desktop_app_release_notes', syncSettings.releaseNotes || ''),
      ]);
      toast.success('Desktop client sync settings saved.');
    } catch {
      toast.error('Could not save.');
    } finally { setSavingSync(false); }
  };

  // ── Feature flags ──────────────────────────────────────────────────────────
  const [studioEnabled, setStudioEnabled]               = useState(true);
  const [hrPortalEnabled, setHrPortalEnabled]           = useState(true);
  const [hrPortalAdminEnabled, setHrPortalAdminEnabled] = useState(true);
  const [storeRecordsEnabled, setStoreRecordsEnabled] = useState(true);
  const [loginStyle, setLoginStyle]                 = useState('standard');
  const [headsCanManageSubaccounts, setHeadsCanManageSubaccounts] = useState(true);
  const [headsCanSetSubPrivileges, setHeadsCanSetSubPrivileges]   = useState(true);
  const [iccOversightEnabled, setIccOversightEnabled]             = useState(true);
  const [deptCreationHeadDetailsEnabled, setDeptCreationHeadDetailsEnabled] = useState(true);
  const [accountIccBypassEnabled, setAccountIccBypassEnabled]     = useState(false);
  const [ceoIccBypassEnabled, setCeoIccBypassEnabled]             = useState(false);
  const [accountThreshEnabled, setAccountThreshEnabled]           = useState(false);
  const [accountThreshAmount, setAccountThreshAmount]             = useState('');
  const [ceoThreshEnabled, setCeoThreshEnabled]                   = useState(false);
  const [ceoThreshAmount, setCeoThreshAmount]                     = useState('');
  const [adminCreateFundEnabled, setAdminCreateFundEnabled]       = useState(false);
  const [adminCreateMaterialEnabled, setAdminCreateMaterialEnabled] = useState(false);
  const [adminCreateMemoEnabled, setAdminCreateMemoEnabled]       = useState(false);
  const [savingFeatures, setSavingFeatures]         = useState(false);
  const [settingsReady, setSettingsReady]           = useState(false);

  // ── Turnstile per-department ───────────────────────────────────────────────
  const [turnstileRequiredDepts, setTurnstileRequiredDepts] = useState([]);
  const [savingTurnstile, setSavingTurnstile]               = useState(false);

  // ── All departments (for chairman/print toggles) ───────────────────────────
  const [allDepts, setAllDepts] = useState([]);

  // ── Chairman / CEO routing access ─────────────────────────────────────────
  const [chairmanAllowedIds, setChairmanAllowedIds] = useState([]);
  const [savingChairman, setSavingChairman]         = useState(false);

  // ── AIGC feature toggle ────────────────────────────────────────────────────
  const { refreshAI } = useAIFeatures();
  const [aiToggle, setAiToggle]   = useState(true);
  const [savingAI, setSavingAI]   = useState(false);

  // ── AI usage caps ──────────────────────────────────────────────────────────
  const [aiCaps, setAiCaps] = useState({ hourly: '', daily: '', weekly: '', monthly: '' });
  const [aiUsageUsers, setAiUsageUsers] = useState([]);
  const [savingAiCaps, setSavingAiCaps] = useState(false);

  // ── SMS balance alert settings ─────────────────────────────────────────────
  const [smsAlertPhones, setSmsAlertPhones]             = useState([]);
  const [smsAlertPhoneInput, setSmsAlertPhoneInput]     = useState('');
  const [smsAlertEmails, setSmsAlertEmails]             = useState([]);
  const [smsAlertEmailInput, setSmsAlertEmailInput]     = useState('');
  const [smsAlertTermiiThreshold, setSmsAlertTermiiThreshold] = useState('1000');
  const [smsAlertTwilioThreshold, setSmsAlertTwilioThreshold] = useState('5');
  const [savingSmsAlerts, setSavingSmsAlerts]           = useState(false);

  // ── Print settings ─────────────────────────────────────────────────────────
  const [canPrintIds, setCanPrintIds]         = useState(null);
  const [showStampOnPdf, setShowStampOnPdf]   = useState(true);
  const [showSignatureOnPdf, setShowSignatureOnPdf] = useState(true);
  const [requireGovernanceSetup, setRequireGovernanceSetup] = useState(true);
  const [savingPrint, setSavingPrint]         = useState(false);

  // ── ICT support phone ──────────────────────────────────────────────────────
  const [ictPhone, setIctPhone]     = useState('');
  const [savingPhone, setSavingPhone] = useState(false);

  // ── Email notifications ────────────────────────────────────────────────────
  const [emailStatus, setEmailStatus]         = useState(null);
  const [emailTestAddr, setEmailTestAddr]     = useState('');
  const [emailTesting, setEmailTesting]       = useState(false);
  const [emailTestResult, setEmailTestResult] = useState(null);

  // ── Media / Image Library ──────────────────────────────────────────────────
  const [mediaImages, setMediaImages] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [deletingMediaId, setDeletingMediaId] = useState(null);
  const mediaFileRef = useRef(null);
  const MEDIA_SERVE = (key) => `${import.meta.env.VITE_API_URL || ''}/api/admin/media/serve?key=${encodeURIComponent(key)}`;

  const loadMedia = async () => {
    setMediaLoading(true);
    try { setMediaImages(await adminAPI.listMedia() || []); } catch { setMediaImages([]); }
    finally { setMediaLoading(false); }
  };

  const handleMediaUpload = async (file) => {
    if (!file) return;
    setMediaUploading(true);
    try {
      const item = await adminAPI.uploadMedia(file);
      setMediaImages(prev => [item, ...prev]);
      toast.success('Image uploaded!');
    } catch { toast.error('Upload failed.'); }
    finally { setMediaUploading(false); if (mediaFileRef.current) mediaFileRef.current.value = ''; }
  };

  const handleMediaDelete = async (id) => {
    setDeletingMediaId(id);
    try {
      await adminAPI.deleteMedia(id);
      setMediaImages(prev => prev.filter(i => i.id !== id));
      toast.success('Image removed.');
    } catch { toast.error('Delete failed.'); }
    finally { setDeletingMediaId(null); }
  };

  // Deleted Records Bin + Hard Reset state
  const [deletedRecords, setDeletedRecords] = useState([]);
  const [loadingBin, setLoadingBin] = useState(false);
  const [purgingId, setPurgingId] = useState(null);
  const [pendingPurgeId, setPendingPurgeId] = useState(null);
  const [viewingRecord, setViewingRecord] = useState(null);
  const [resetOptions, setResetOptions] = useState({
    requisitions: true, subAccounts: true, deptActivations: true,
    activityLogs: true, chatMessages: false, storeRecords: false, notifications: false,
  });
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetSummary, setResetSummary] = useState(null);

  const loadDeletedRecords = async () => {
    setLoadingBin(true);
    try {
      const res = await adminAPI.get('/deleted-records');
      setDeletedRecords(Array.isArray(res?.data) ? res.data : []);
    } catch { setDeletedRecords([]); } finally { setLoadingBin(false); }
  };

  const confirmPurgeRecord = (id) => setPendingPurgeId(id);

  const handlePurgeRecord = async (id) => {
    setPurgingId(id); setPendingPurgeId(null);
    try { await adminAPI.delete(`/deleted-records/${id}`); setDeletedRecords(p => p.filter(r => r.id !== id)); }
    catch (e) { alert(e?.response?.data?.error || 'Failed to purge record'); }
    finally { setPurgingId(null); }
  };

  const handleHardReset = async () => {
    if (resetConfirmText !== 'CONFIRM HARD RESET') return;
    setResetting(true); setResetSummary(null);
    try {
      const res = await adminAPI.hardReset({ confirmText: resetConfirmText, options: resetOptions });
      setResetSummary(res?.summary || null);
      setResetConfirmText('');
    } catch (e) { toast.error(e?.response?.data?.error || 'Reset failed'); }
    finally { setResetting(false); }
  };

  const loadData = async () => {
    const [workflowData, typeData] = await Promise.all([
      getWorkflows(),
      getRequisitionTypes()
    ]);
    setStages(workflowData);
    setTypes(typeData);
    setLoading(false);
  };

  const loadRefPattern = async () => {
    try {
      const data = await settingsAPI.getRefPattern();
      if (data) setRefPattern(data);
    } catch {}
  };

  const saveRefPattern = async () => {
    setSavingRef(true);
    try {
      await settingsAPI.setRefPattern(refPattern);
      toast.success('Reference code pattern saved.');
    } catch { toast.error('Failed to save reference pattern.'); }
    finally { setSavingRef(false); }
  };

  const loadFeatureFlags = async () => {
    try {
      const [
        studioRes, hrRes, hrAdminRes, loginRes, storeRes, headsManageRes, headsPrivRes, iccOversightRes, deptHeadDetailsRes,
        accountIccBypassRes, ceoIccBypassRes,
        accountThreshEnabledRes, accountThreshAmountRes, ceoThreshEnabledRes, ceoThreshAmountRes,
        adminCreateFundRes, adminCreateMaterialRes, adminCreateMemoRes,
      ] = await Promise.allSettled([
        settingsAPI.get('document_studio_enabled'),
        settingsAPI.get('hr_portal_enabled'),
        settingsAPI.get('hr_portal_admin_enabled'),
        settingsAPI.get('login_style'),
        settingsAPI.get('store_records_enabled'),
        settingsAPI.get('heads_can_manage_subaccounts'),
        settingsAPI.get('heads_can_set_subaccount_privileges'),
        settingsAPI.get('icc_oversight_enabled'),
        settingsAPI.get('dept_creation_head_details_enabled'),
        settingsAPI.get('icc_bypass_account_enabled'),
        settingsAPI.get('icc_bypass_ceo_enabled'),
        settingsAPI.get('icc_bypass_account_threshold_enabled'),
        settingsAPI.get('icc_bypass_account_threshold_amount'),
        settingsAPI.get('icc_bypass_ceo_threshold_enabled'),
        settingsAPI.get('icc_bypass_ceo_threshold_amount'),
        settingsAPI.get('admin_create_fund_enabled'),
        settingsAPI.get('admin_create_material_enabled'),
        settingsAPI.get('admin_create_memo_enabled'),
      ]);
      if (studioRes.status === 'fulfilled' && studioRes.value?.value !== undefined)
        setStudioEnabled(studioRes.value.value !== 'false');
      if (hrRes.status === 'fulfilled' && hrRes.value?.value !== undefined)
        setHrPortalEnabled(hrRes.value.value !== 'false');
      if (hrAdminRes.status === 'fulfilled' && hrAdminRes.value?.value !== undefined)
        setHrPortalAdminEnabled(hrAdminRes.value.value !== 'false');
      if (loginRes.status === 'fulfilled' && loginRes.value?.value)
        setLoginStyle(loginRes.value.value);
      if (storeRes.status === 'fulfilled' && storeRes.value?.value !== undefined)
        setStoreRecordsEnabled(storeRes.value.value !== 'false');
      if (headsManageRes.status === 'fulfilled' && headsManageRes.value?.value !== undefined)
        setHeadsCanManageSubaccounts(headsManageRes.value.value !== 'false');
      if (headsPrivRes.status === 'fulfilled' && headsPrivRes.value?.value !== undefined)
        setHeadsCanSetSubPrivileges(headsPrivRes.value.value !== 'false');
      if (iccOversightRes.status === 'fulfilled' && iccOversightRes.value?.value !== undefined)
        setIccOversightEnabled(iccOversightRes.value.value !== 'false');
      if (deptHeadDetailsRes.status === 'fulfilled' && deptHeadDetailsRes.value?.value !== undefined)
        setDeptCreationHeadDetailsEnabled(deptHeadDetailsRes.value.value !== 'false');
      if (accountIccBypassRes.status === 'fulfilled' && accountIccBypassRes.value?.value !== undefined)
        setAccountIccBypassEnabled(accountIccBypassRes.value.value === 'true');
      if (ceoIccBypassRes.status === 'fulfilled' && ceoIccBypassRes.value?.value !== undefined)
        setCeoIccBypassEnabled(ceoIccBypassRes.value.value === 'true');
      if (accountThreshEnabledRes.status === 'fulfilled' && accountThreshEnabledRes.value?.value !== undefined)
        setAccountThreshEnabled(accountThreshEnabledRes.value.value === 'true');
      if (accountThreshAmountRes.status === 'fulfilled' && accountThreshAmountRes.value?.value !== undefined)
        setAccountThreshAmount(accountThreshAmountRes.value.value);
      if (ceoThreshEnabledRes.status === 'fulfilled' && ceoThreshEnabledRes.value?.value !== undefined)
        setCeoThreshEnabled(ceoThreshEnabledRes.value.value === 'true');
      if (ceoThreshAmountRes.status === 'fulfilled' && ceoThreshAmountRes.value?.value !== undefined)
        setCeoThreshAmount(ceoThreshAmountRes.value.value);
      if (adminCreateFundRes.status === 'fulfilled' && adminCreateFundRes.value?.value !== undefined)
        setAdminCreateFundEnabled(adminCreateFundRes.value.value === 'true');
      if (adminCreateMaterialRes.status === 'fulfilled' && adminCreateMaterialRes.value?.value !== undefined)
        setAdminCreateMaterialEnabled(adminCreateMaterialRes.value.value === 'true');
      if (adminCreateMemoRes.status === 'fulfilled' && adminCreateMemoRes.value?.value !== undefined)
        setAdminCreateMemoEnabled(adminCreateMemoRes.value.value === 'true');
    } catch {}

    // Load Turnstile required depts separately (JSON array)
    try {
      const tsRes = await settingsAPI.get('turnstile_required_depts');
      if (tsRes?.value) setTurnstileRequiredDepts(JSON.parse(tsRes.value));
    } catch {}

    // Load AI caps + current usage
    try {
      const capsData = await adminAPI.getAiCaps();
      if (capsData?.caps) {
        setAiCaps({
          hourly:  capsData.caps.hourly  ?? '',
          daily:   capsData.caps.daily   ?? '',
          weekly:  capsData.caps.weekly  ?? '',
          monthly: capsData.caps.monthly ?? '',
        });
      }
      if (Array.isArray(capsData?.users)) setAiUsageUsers(capsData.users);
    } catch {}

    // Load SMS alert settings
    try {
      const [phoneRes, emailRes, tRes, wRes] = await Promise.allSettled([
        settingsAPI.get('admin_alert_phone'),
        settingsAPI.get('admin_alert_emails'),
        settingsAPI.get('sms_alert_termii_threshold'),
        settingsAPI.get('sms_alert_twilio_threshold'),
      ]);
      if (phoneRes.status === 'fulfilled' && phoneRes.value?.value) {
        try { const p = JSON.parse(phoneRes.value.value); setSmsAlertPhones(Array.isArray(p) ? p : [phoneRes.value.value]); }
        catch { setSmsAlertPhones([phoneRes.value.value]); }
      }
      if (emailRes.status === 'fulfilled' && emailRes.value?.value) {
        try { const e = JSON.parse(emailRes.value.value); setSmsAlertEmails(Array.isArray(e) ? e : []); }
        catch {}
      }
      if (tRes.status === 'fulfilled' && tRes.value?.value) setSmsAlertTermiiThreshold(tRes.value.value);
      if (wRes.status === 'fulfilled' && wRes.value?.value) setSmsAlertTwilioThreshold(wRes.value.value);
    } catch {}
  };

  const saveFeatureFlags = async () => {
    if (accountThreshEnabled && (accountThreshAmount === '' || isNaN(parseFloat(accountThreshAmount)))) {
      toast.error('Enter a valid threshold amount for Account, or turn off its threshold limit.');
      return;
    }
    if (ceoThreshEnabled && (ceoThreshAmount === '' || isNaN(parseFloat(ceoThreshAmount)))) {
      toast.error('Enter a valid threshold amount for CEO/Chairman, or turn off its threshold limit.');
      return;
    }
    setSavingFeatures(true);
    try {
      await Promise.all([
        settingsAPI.set('document_studio_enabled', String(studioEnabled)),
        settingsAPI.set('hr_portal_enabled', String(hrPortalEnabled)),
        settingsAPI.set('hr_portal_admin_enabled', String(hrPortalAdminEnabled)),
        settingsAPI.set('store_records_enabled', String(storeRecordsEnabled)),
        settingsAPI.set('login_style', loginStyle),
        settingsAPI.set('heads_can_manage_subaccounts', String(headsCanManageSubaccounts)),
        settingsAPI.set('heads_can_set_subaccount_privileges', String(headsCanSetSubPrivileges)),
        settingsAPI.set('icc_oversight_enabled', String(iccOversightEnabled)),
        settingsAPI.set('dept_creation_head_details_enabled', String(deptCreationHeadDetailsEnabled)),
        settingsAPI.set('icc_bypass_account_enabled', String(accountIccBypassEnabled)),
        settingsAPI.set('icc_bypass_ceo_enabled', String(ceoIccBypassEnabled)),
        settingsAPI.set('icc_bypass_account_threshold_enabled', String(accountThreshEnabled)),
        settingsAPI.set('icc_bypass_account_threshold_amount', String(parseFloat(accountThreshAmount) || 0)),
        settingsAPI.set('icc_bypass_ceo_threshold_enabled', String(ceoThreshEnabled)),
        settingsAPI.set('icc_bypass_ceo_threshold_amount', String(parseFloat(ceoThreshAmount) || 0)),
        settingsAPI.set('admin_create_fund_enabled', String(adminCreateFundEnabled)),
        settingsAPI.set('admin_create_material_enabled', String(adminCreateMaterialEnabled)),
        settingsAPI.set('admin_create_memo_enabled', String(adminCreateMemoEnabled)),
      ]);
      toast.success('Feature settings saved.');
      window.dispatchEvent(new CustomEvent('rms:flags:updated'));
    } catch {
      toast.error('Failed to save. Please try again.');
    } finally { setSavingFeatures(false); }
  };

  // ── Chairman/CEO routing ───────────────────────────────────────────────────
  const loadChairmanSetting = async () => {
    try {
      const res = await settingsAPI.get('chairman_ceo_allowed_depts');
      if (res?.value) setChairmanAllowedIds(JSON.parse(res.value));
    } catch {}
  };
  const saveChairmanSetting = async () => {
    setSavingChairman(true);
    try {
      await settingsAPI.set('chairman_ceo_allowed_depts', JSON.stringify(chairmanAllowedIds));
      toast.success('Chairman/CEO routing access saved.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save setting.');
    } finally { setSavingChairman(false); }
  };
  const toggleChairmanDept = (deptId) => {
    setChairmanAllowedIds(prev => prev.includes(deptId) ? prev.filter(id => id !== deptId) : [...prev, deptId]);
  };

  // ── AI features ────────────────────────────────────────────────────────────
  const loadAISetting = async () => {
    try {
      const res = await settingsAPI.get('ai_features_enabled');
      setAiToggle(res?.value !== 'false');
    } catch {}
  };
  const saveAISetting = async () => {
    setSavingAI(true);
    try {
      await settingsAPI.set('ai_features_enabled', aiToggle ? 'true' : 'false');
      await refreshAI();
      toast.success(`AI features ${aiToggle ? 'enabled' : 'disabled'} for all departments.`);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save AI setting.');
    } finally { setSavingAI(false); }
  };

  // ── AI usage caps ──────────────────────────────────────────────────────────
  const saveAiCaps = async () => {
    setSavingAiCaps(true);
    try {
      await adminAPI.saveAiCaps(aiCaps);
      const capsData = await adminAPI.getAiCaps();
      if (Array.isArray(capsData?.users)) setAiUsageUsers(capsData.users);
      toast.success('AI usage limits saved.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save AI limits.');
    } finally { setSavingAiCaps(false); }
  };

  // ── SMS alert settings ─────────────────────────────────────────────────────
  const saveSmsAlertSettings = async () => {
    setSavingSmsAlerts(true);
    try {
      await Promise.all([
        settingsAPI.set('admin_alert_phone', JSON.stringify(smsAlertPhones)),
        settingsAPI.set('admin_alert_emails', JSON.stringify(smsAlertEmails)),
        settingsAPI.set('sms_alert_termii_threshold', smsAlertTermiiThreshold || '1000'),
        settingsAPI.set('sms_alert_twilio_threshold', smsAlertTwilioThreshold || '5'),
      ]);
      toast.success('SMS alert settings saved.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save SMS alert settings.');
    } finally { setSavingSmsAlerts(false); }
  };

  const addSmsPhone = () => {
    const v = smsAlertPhoneInput.trim();
    if (v && !smsAlertPhones.includes(v)) setSmsAlertPhones(p => [...p, v]);
    setSmsAlertPhoneInput('');
  };
  const addSmsEmail = () => {
    const v = smsAlertEmailInput.trim().toLowerCase();
    if (v && !smsAlertEmails.includes(v)) setSmsAlertEmails(e => [...e, v]);
    setSmsAlertEmailInput('');
  };

  // ── Turnstile per-department ───────────────────────────────────────────────
  const toggleTurnstileDept = (deptName) => {
    setTurnstileRequiredDepts(prev =>
      prev.includes(deptName) ? prev.filter(n => n !== deptName) : [...prev, deptName]
    );
  };
  const saveTurnstileSetting = async () => {
    setSavingTurnstile(true);
    try {
      await settingsAPI.set('turnstile_required_depts', JSON.stringify(turnstileRequiredDepts));
      toast.success('Turnstile settings saved.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save Turnstile settings.');
    } finally { setSavingTurnstile(false); }
  };

  // ── Print settings ─────────────────────────────────────────────────────────
  const loadPrintSettings = async () => {
    try {
      const data = await adminAPI.getPrintSettings();
      setCanPrintIds((data?.departments || []).filter(d => d.canPrint).map(d => d.id));
      setShowStampOnPdf(data?.showStamp !== false);
      setShowSignatureOnPdf(data?.showSignature !== false);
      setRequireGovernanceSetup(data?.requireGovernance !== false);
    } catch { setCanPrintIds([]); }
  };
  const savePrintSettings = async () => {
    if (canPrintIds === null) return;
    setSavingPrint(true);
    try {
      await adminAPI.savePrintSettings(canPrintIds, showStampOnPdf, showSignatureOnPdf, requireGovernanceSetup);
      toast.success('Print settings saved.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save print settings.');
    } finally { setSavingPrint(false); }
  };
  const toggleCanPrintDept = (deptId) => {
    setCanPrintIds(prev => (prev || []).includes(deptId) ? prev.filter(id => id !== deptId) : [...(prev || []), deptId]);
  };

  // ── ICT phone ──────────────────────────────────────────────────────────────
  const loadIctPhone = async () => {
    try {
      const res = await settingsAPI.get('ict_support_phone');
      if (res?.value) setIctPhone(res.value);
    } catch {}
  };
  const saveIctPhone = async () => {
    setSavingPhone(true);
    try {
      await settingsAPI.set('ict_support_phone', ictPhone.trim());
      toast.success('Support phone number saved.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save phone number.');
    } finally { setSavingPhone(false); }
  };

  // ── Email status ───────────────────────────────────────────────────────────
  const loadEmailStatus = async () => {
    try {
      const res = await fetch('/api/email-status', { credentials: 'include' }).then(r => r.json());
      setEmailStatus(res);
    } catch { setEmailStatus({ configured: false, error: 'Could not fetch email status.' }); }
  };
  const sendTestEmail = async () => {
    if (!emailTestAddr.trim()) return;
    setEmailTesting(true);
    setEmailTestResult(null);
    try {
      const res = await fetch('/api/test-email', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: emailTestAddr.trim() })
      }).then(r => r.json());
      setEmailTestResult(res);
      if (res.success) toast.success('Test email sent!');
      else toast.error(res.message || res.error || 'Failed');
    } catch (err) {
      setEmailTestResult({ success: false, error: err.message });
      toast.error('Test failed: ' + err.message);
    } finally { setEmailTesting(false); }
  };

  useEffect(() => {
    (async () => {
      const { getDepartments } = await import('../lib/store');
      const [, depts] = await Promise.all([
        loadData(),
        getDepartments()
      ]);
      const deptsArr = Array.isArray(depts) ? depts : [];
      setAllDepts(deptsArr);
      await Promise.all([
        loadFeatureFlags(),
        loadRefPattern(),
        loadChairmanSetting(),
        loadAISetting(),
        loadPrintSettings(),
        loadIctPhone(),
        loadEmailStatus(),
        loadDeletedRecords(),
        loadSyncSettings(),
      ]);
      setSettingsReady(true);
    })();
  }, []);

  useEffect(() => {
    if (activeTab === 'images') loadMedia();
  }, [activeTab]);

  const [isProcessing, setIsProcessing] = useState(false);

  const addStage = async () => {
    setIsProcessing(true);
    await new Promise(r => setTimeout(r, 600));
    const newStage = {
      id: Date.now(),
      sequence: stages.length + 1,
      name: 'New Stage',
      role: 'Admin',
      threshold: 0
    };
    const updated = [...stages, newStage];
    setStages(updated);
    await updateWorkflows(updated);
    setIsProcessing(false);
    toast.success('New stage added to workflow');
  };

  const updateStage = async (updatedStage) => {
    const updated = stages.map(s => s.id === updatedStage.id ? updatedStage : s);
    setStages(updated);
    await updateWorkflows(updated);
  };

  const confirmDelete = async () => {
    setIsProcessing(true);
    await new Promise(r => setTimeout(r, 600));
    
    if (pendingStage) {
      const updated = stages.filter(s => s.id !== pendingStage.id).map((s, idx) => ({ ...s, sequence: idx + 1 }));
      setStages(updated);
      await updateWorkflows(updated);
      toast.error('Stage removed');
    } else if (pendingType) {
      await deleteRequisitionType(pendingType.id);
      setTypes(types.filter(t => t.id !== pendingType.id));
    }
    
    setIsProcessing(false);
    setIsDeleteModalOpen(false);
    setPendingStage(null);
    setPendingType(null);
  };

  const handleAddType = async (e) => {
    e.preventDefault();
    if (!newTypeName) return;
    setIsProcessing(true);
    const result = await addRequisitionType({ name: newTypeName });
    if (result) {
        setTypes([...types, result]);
        setNewTypeName('');
    }
    setIsProcessing(false);
  };

  if (loading) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center space-y-6">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center text-primary">
            <Settings2 size={24} className="animate-pulse" />
          </div>
        </div>
        <p className="text-sm font-bold text-primary tracking-widest uppercase animate-pulse">Syncing Approval Chain</p>
      </div>
    );
  }

  return (
    <>
    <div className="max-w-6xl mx-auto space-y-10 pb-20 animate-slide-up">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight flex items-center space-x-3">
              <Settings2 className="text-primary" />
              <span>System <span className="text-primary">Settings</span></span>
            </h1>
            <p className="text-muted-foreground text-sm mt-1 font-medium italic">
              Central configuration hub for workflow rules, access control and system behaviour.
            </p>
          </div>
        </div>

        {/* Scrollable tab bar */}
        <div className="overflow-x-auto pb-1 -mb-1">
          <div className="flex bg-muted/40 p-1.5 rounded-2xl border border-border/50 shadow-inner min-w-max gap-0.5">
            {[
              { id: 'features', label: 'Features' },
              { id: 'stages',   label: 'Workflow, Types & Ref Code' },
              { id: 'print',    label: 'Print, Stamp & Contact' },
              { id: 'images',   label: 'Images' },
              { id: 'bin',      label: 'Deleted Records & Danger Zone' },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] transition-all whitespace-nowrap ${activeTab === id ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-[0.98]' : 'text-muted-foreground hover:bg-muted/80'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'features' ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div>
              <h3 className="text-lg font-black text-foreground tracking-tight">Feature Controls</h3>
              <p className="text-sm text-muted-foreground mt-1 font-medium leading-relaxed">
                Enable or disable system features for all users. Changes take effect immediately.
              </p>
            </div>
            {!settingsReady && (
              <div className="flex items-center gap-3 py-6 text-muted-foreground text-sm">
                <Loader2 size={16} className="animate-spin shrink-0" />
                Loading settings…
              </div>
            )}

            {settingsReady && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {[
                { label: 'Document Studio', desc: 'Allows all users to access the Document Studio for printing and PDF generation. When disabled the Studio tab is hidden from the sidebar.', value: studioEnabled, set: setStudioEnabled },
                { label: 'HR Portal (Departments)', desc: 'Grants the HR department and HR-role users access to the HR management portal. When disabled, the HR Portal button is hidden from department sidebars — Super Admin access is controlled separately below.', value: hrPortalEnabled, set: setHrPortalEnabled },
                { label: 'HR Portal (Super Admin)', desc: 'Grants the Super Admin account access to the HR management portal. Toggle this independently — disabling it hides HR Portal from the admin sidebar while departments can still have it enabled, and vice versa.', value: hrPortalAdminEnabled, set: setHrPortalAdminEnabled },
                { label: 'Store Records', desc: 'Gives the Store department and all its sub-accounts access to the stock ledger (store records) module. When disabled the Store Records button is hidden from the sidebar.', value: storeRecordsEnabled, set: setStoreRecordsEnabled },
                { label: 'ICC Oversight Console', desc: 'Shows the "Oversight" button in ICC\'s sidebar, giving them the global observer console (view all requests, freeze/unfreeze, comment). When disabled, the button is hidden from ICC\'s sidebar.', value: iccOversightEnabled, set: setIccOversightEnabled },
                { label: 'Heads Can Create/Manage Sub-Accounts', desc: 'Lets department heads create new units and act on existing ones (rename, reset code, enable/disable, delete). When disabled, heads can still see their sub-account list but lose all action buttons — only Super Admin can manage units.', value: headsCanManageSubaccounts, set: setHeadsCanManageSubaccounts },
                { label: 'Heads Can Set Sub-Account Privileges', desc: 'Lets department heads configure Cash/Memo/Material privileges, creation/approval limits, and direct routing for their sub-accounts. When disabled, the Privilege Settings section is hidden from heads — only Super Admin can configure it.', value: headsCanSetSubPrivileges, set: setHeadsCanSetSubPrivileges },
                { label: 'Department Creation Includes Head Details', desc: 'When enabled, Super Admin fills in the head official\'s details (Staff ID, name, email, phone) together with the department at creation. When disabled, the head official fields are hidden — Super Admin creates a bare department (name + access code only) and assigns a head later via Edit.', value: deptCreationHeadDetailsEnabled, set: setDeptCreationHeadDetailsEnabled },
                { label: 'Super Admin Can Create Fund Requests', desc: 'Super Admin\'s Requisitions page hides the "Fund Request" creation button by default, since Admin oversees the registry rather than originating requests. Enable to let Super Admin create Fund Requests directly.', value: adminCreateFundEnabled, set: setAdminCreateFundEnabled },
                { label: 'Super Admin Can Create Material Requests', desc: 'Same restriction as Fund Requests, applied to Material Requests. Enable to let Super Admin create Material Requests directly.', value: adminCreateMaterialEnabled, set: setAdminCreateMaterialEnabled },
                { label: 'Super Admin Can Create Memos', desc: 'Super Admin\'s Memo Exchange page hides the "Generate Memo" button by default. Enable to let Super Admin create memos directly.', value: adminCreateMemoEnabled, set: setAdminCreateMemoEnabled },
              ].map(({ label, desc, value, set }) => (
                <div key={label} className="flex items-center justify-between gap-4 p-5 rounded-2xl border-2 border-border/50 bg-white/80 hover:border-primary/30 transition-all">
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-sm font-black text-foreground">{label}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
                  </div>
                  <button
                    onClick={() => set(v => !v)}
                    className={`relative shrink-0 w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none ${value ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-300 ${value ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>
              ))}

              {/* ICC Vets Protocol bypass cards — master toggle + optional amount threshold */}
              {[
                {
                  key: 'account', label: 'Account Can Treat Without ICC Vetting',
                  desc: 'ICC Vets Protocol: by default, Account must forward Cash/Material requests to ICC for vetting before they can treat (disburse).',
                  bypassValue: accountIccBypassEnabled, setBypass: setAccountIccBypassEnabled,
                  threshEnabled: accountThreshEnabled, setThreshEnabled: setAccountThreshEnabled,
                  threshAmount: accountThreshAmount, setThreshAmount: setAccountThreshAmount,
                },
                {
                  key: 'ceo', label: 'CEO/Chairman Can Treat Without ICC Vetting',
                  desc: 'ICC Vets Protocol: by default, the CEO/Chairman department must wait for ICC to vet Cash/Material requests before treating them, same as Account.',
                  bypassValue: ceoIccBypassEnabled, setBypass: setCeoIccBypassEnabled,
                  threshEnabled: ceoThreshEnabled, setThreshEnabled: setCeoThreshEnabled,
                  threshAmount: ceoThreshAmount, setThreshAmount: setCeoThreshAmount,
                },
              ].map(({ key, label, desc, bypassValue, setBypass, threshEnabled, setThreshEnabled, threshAmount, setThreshAmount }) => (
                <div key={key} className="p-5 rounded-2xl border-2 border-border/50 bg-white/80 hover:border-primary/30 transition-all space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-sm font-black text-foreground">{label}</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {desc} {bypassValue ? 'Currently free to treat without ICC.' : 'Enable to let them treat freely without waiting for ICC.'}
                      </p>
                    </div>
                    <button
                      onClick={() => setBypass(v => !v)}
                      className={`relative shrink-0 w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none ${bypassValue ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-300 ${bypassValue ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {bypassValue && (
                    <div className="border-t border-border/30 pt-4 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-0.5 min-w-0">
                          <p className="text-xs font-bold text-foreground">Limit Bypass to an Amount Threshold</p>
                          <p className="text-[10px] text-muted-foreground leading-relaxed">
                            {threshEnabled
                              ? 'Only requests at or below the amount below skip ICC — anything above still goes through the full process, including ICC.'
                              : 'Off — every amount is free to treat without ICC while the toggle above is on.'}
                          </p>
                        </div>
                        <button
                          onClick={() => setThreshEnabled(v => !v)}
                          className={`relative shrink-0 w-10 h-5 rounded-full transition-colors duration-300 focus:outline-none ${threshEnabled ? 'bg-amber-500' : 'bg-muted-foreground/30'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-300 ${threshEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      </div>
                      {threshEnabled && (
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Max Amount Treatable Without ICC (₦)</label>
                          <input
                            type="number" min="0" step="0.01"
                            value={threshAmount}
                            onChange={e => setThreshAmount(e.target.value)}
                            placeholder="e.g. 500000"
                            className="w-full bg-muted/30 border border-border/50 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-300"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Desktop Client Sync — spans both columns. Controls the separate
                  desktop attendance app (no RMS login of its own), which polls
                  GET /api/sync/heartbeat to decide whether it stays active. */}
              {syncLoaded && (
                <div className="lg:col-span-2 p-5 rounded-2xl border-2 border-border/50 bg-white/80 hover:border-primary/30 transition-all space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-sm font-black text-foreground">Desktop Client Sync</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Controls whether the desktop attendance client stays active. Changes take
                        effect the next time it checks in (usually within 20-30 seconds).
                      </p>
                    </div>
                    <button
                      onClick={() => setSyncSettings(s => ({ ...s, enabled: !s.enabled }))}
                      className={`relative shrink-0 w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none ${syncSettings.enabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-300 ${syncSettings.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <div className="border-t border-border/30 pt-4 space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        Auto-Expire (optional)
                      </label>
                      <input
                        type="datetime-local"
                        value={syncSettings.expiresAt ? syncSettings.expiresAt.slice(0, 16) : ''}
                        onChange={(e) => setSyncSettings(s => ({
                          ...s,
                          expiresAt: e.target.value ? new Date(e.target.value).toISOString() : '',
                        }))}
                        className="w-full bg-muted/30 border border-border/50 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        Message Shown When Inactive
                      </label>
                      <textarea
                        value={syncSettings.message}
                        onChange={(e) => setSyncSettings(s => ({ ...s, message: e.target.value }))}
                        placeholder="e.g. This software is currently inactive. Contact your administrator."
                        rows={2}
                        className="w-full bg-muted/30 border border-border/50 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                  </div>

                  <div className="border-t border-border/30 pt-4 space-y-3">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      Update Notice (optional)
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed -mt-2">
                      When set, installs newer than this show a dismissible "Update available" banner
                      with a Download link — never a forced or silent update. Leave Latest Version blank
                      to turn this off.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                          Latest Version
                        </label>
                        <input
                          type="text"
                          value={syncSettings.latestVersion}
                          onChange={(e) => setSyncSettings(s => ({ ...s, latestVersion: e.target.value }))}
                          placeholder="e.g. 1.1.0"
                          className="w-full bg-muted/30 border border-border/50 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                          Download URL
                        </label>
                        <input
                          type="text"
                          value={syncSettings.downloadUrl}
                          onChange={(e) => setSyncSettings(s => ({ ...s, downloadUrl: e.target.value }))}
                          placeholder="https://.../CSSQuickTimeSetup.exe"
                          className="w-full bg-muted/30 border border-border/50 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        Release Notes
                      </label>
                      <textarea
                        value={syncSettings.releaseNotes}
                        onChange={(e) => setSyncSettings(s => ({ ...s, releaseNotes: e.target.value }))}
                        placeholder="What changed in this version"
                        rows={2}
                        className="w-full bg-muted/30 border border-border/50 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <button
                      onClick={saveSyncSettings}
                      disabled={savingSync}
                      className="px-5 py-2 text-xs font-black uppercase tracking-widest rounded-xl bg-primary text-primary-foreground disabled:opacity-50 transition-all"
                    >
                      {savingSync ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}

              {/* Login Screen Style — spans both columns */}
              <div className="lg:col-span-2 p-5 rounded-2xl border-2 border-border/50 bg-white/80 hover:border-primary/30 transition-all space-y-4">
                <div className="flex items-center gap-3">
                  <Monitor size={18} className="text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-black text-foreground">Login Screen Style</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Choose the login screen displayed to all users. Premium uses a cinematic video background.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { value: 'standard', label: 'Standard', desc: 'Clean gradient panel, no video' },
                    { value: 'premium', label: 'Premium', desc: 'Cinematic video background' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setLoginStyle(opt.value)}
                      className={`flex flex-col items-start gap-1 p-4 rounded-xl border-2 text-left transition-all ${loginStyle === opt.value ? 'border-primary bg-primary/5' : 'border-border/50 bg-white hover:border-primary/30'}`}
                    >
                      <div className="flex items-center gap-2 w-full">
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${loginStyle === opt.value ? 'border-primary' : 'border-border'}`}>
                          {loginStyle === opt.value && <div className="w-2 h-2 rounded-full bg-primary" />}
                        </div>
                        <span className={`text-xs font-black uppercase tracking-widest ${loginStyle === opt.value ? 'text-primary' : 'text-foreground'}`}>{opt.label}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground pl-6 leading-relaxed">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

            </div>}

            {/* Compact status summary — wraps as pills instead of a tall vertical list */}
            {settingsReady && <div className="flex flex-wrap gap-2">
              {[
                { label: 'Document Studio', value: studioEnabled },
                { label: 'HR Portal (Depts)', value: hrPortalEnabled },
                { label: 'HR Portal (Admin)', value: hrPortalAdminEnabled },
                { label: 'Store Records', value: storeRecordsEnabled },
                { label: 'ICC Oversight', value: iccOversightEnabled },
                { label: 'Heads Manage Sub-Accounts', value: headsCanManageSubaccounts },
                { label: 'Heads Set Privileges', value: headsCanSetSubPrivileges },
                { label: 'Dept Creation Includes Head Details', value: deptCreationHeadDetailsEnabled },
                { label: 'Account ICC Bypass', value: accountIccBypassEnabled },
                { label: 'CEO/Chairman ICC Bypass', value: ceoIccBypassEnabled },
                { label: 'Admin Create Fund', value: adminCreateFundEnabled },
                { label: 'Admin Create Material', value: adminCreateMaterialEnabled },
                { label: 'Admin Create Memo', value: adminCreateMemoEnabled },
              ].map(({ label, value }) => (
                <span key={label} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold border ${value ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${value ? 'bg-emerald-500' : 'bg-red-400'}`} />
                  {label}: {value ? 'On' : 'Off'}
                </span>
              ))}
              {accountIccBypassEnabled && accountThreshEnabled && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold border bg-amber-50 border-amber-200 text-amber-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Account Limit: ₦{Number(accountThreshAmount || 0).toLocaleString()}
                </span>
              )}
              {ceoIccBypassEnabled && ceoThreshEnabled && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold border bg-amber-50 border-amber-200 text-amber-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  CEO/Chairman Limit: ₦{Number(ceoThreshAmount || 0).toLocaleString()}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold border bg-blue-50 border-blue-200 text-blue-700">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                Login Screen: <span className="capitalize">{loginStyle}</span>
              </span>
            </div>}

            <div className="flex lg:justify-end">
              <button
                onClick={saveFeatureFlags}
                disabled={savingFeatures}
                className="w-full lg:w-auto flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-black py-3.5 px-8 rounded-2xl transition-all shadow-lg shadow-primary/20 text-xs uppercase tracking-widest disabled:opacity-50 active:scale-[0.98]"
              >
                {savingFeatures ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {savingFeatures ? 'Saving…' : 'Save Feature Settings'}
              </button>
            </div>

            {/* Cloudflare Turnstile — per-department human verification */}
            <div className="glass bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center shrink-0">
                    <ShieldCheck size={18} className="text-orange-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Cloudflare Turnstile</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Select departments that must pass human verification before logging in.</p>
                  </div>
                </div>
                <button
                  onClick={saveTurnstileSetting}
                  disabled={savingTurnstile}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 shadow-md shadow-orange-200 active:scale-[0.98]"
                >
                  {savingTurnstile ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              </div>
              {allDepts.length === 0 ? (
                <p className="text-xs text-muted-foreground italic text-center py-4">No departments found.</p>
              ) : (
                <div className="max-h-[360px] overflow-y-auto custom-scrollbar pr-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {allDepts.filter(d => !d.isSubAccount && d.type !== 'Sub-Account').map(dept => {
                    const required = turnstileRequiredDepts.includes(dept.name);
                    return (
                      <button
                        key={dept.id}
                        onClick={() => toggleTurnstileDept(dept.name)}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${required ? 'bg-orange-50 border-orange-300 text-orange-800' : 'bg-white border-border/40 text-muted-foreground hover:border-orange-200'}`}
                      >
                        <div className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${required ? 'bg-orange-500 border-orange-500' : 'border-border'}`}>
                          {required && <CheckCircle2 size={10} className="text-white" />}
                        </div>
                        <span className="text-[11px] font-bold truncate">{dept.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {turnstileRequiredDepts.length > 0 && (
                <p className="text-[10px] text-orange-600 font-semibold mt-3">
                  {turnstileRequiredDepts.length} department{turnstileRequiredDepts.length > 1 ? 's' : ''} require Turnstile verification.
                  {!import.meta.env.VITE_TURNSTILE_SITE_KEY && ' ⚠ Set VITE_TURNSTILE_SITE_KEY in Railway for the widget to appear on the login page.'}
                </p>
              )}
            </div>

            {/* AIGC Features — own save action (immediate org-wide effect) */}
            <div className="glass bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center shrink-0">
                    <Sparkles size={18} className="text-purple-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">AIGC Features</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Control organisation-wide AI tools.</p>
                  </div>
                </div>
                <button
                  onClick={saveAISetting}
                  disabled={savingAI}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 shadow-md shadow-purple-200 active:scale-[0.98]"
                >
                  {savingAI ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              </div>
              <div className="flex items-center justify-between p-5 rounded-2xl border border-border/40 bg-white shadow-inner">
                <div className="space-y-1">
                  <p className="text-xs font-black text-foreground uppercase tracking-tight">
                    {aiToggle ? 'Neural Engines Active' : 'Neural Engines Suspended'}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    {aiToggle
                      ? 'AI Refinement and Voice Dictation are enabled across the entire hierarchy.'
                      : 'Organisation-wide AI capabilities have been restricted.'}
                  </p>
                </div>
                <button
                  onClick={() => setAiToggle(v => !v)}
                  className={`relative shrink-0 w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none shadow-inner ${aiToggle ? 'bg-purple-600' : 'bg-muted-foreground/30'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-lg transition-transform duration-300 ${aiToggle ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>

            {/* AI Usage Limits — per-user hourly / daily / weekly / monthly caps */}
            <div className="glass bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
                    <Zap size={18} className="text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">AI Usage Limits</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Per-user call caps across hourly / daily / weekly / monthly windows. Leave blank for unlimited.</p>
                  </div>
                </div>
                <button
                  onClick={saveAiCaps}
                  disabled={savingAiCaps}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 shadow-md shadow-blue-200 active:scale-[0.98]"
                >
                  {savingAiCaps ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              </div>

              {/* Cap inputs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                {[
                  { label: 'Hourly cap', key: 'hourly',  placeholder: '∞' },
                  { label: 'Daily cap',  key: 'daily',   placeholder: '∞' },
                  { label: 'Weekly cap', key: 'weekly',  placeholder: '∞' },
                  { label: 'Monthly cap',key: 'monthly', placeholder: '∞' },
                ].map(({ label, key, placeholder }) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-black text-muted-foreground/60 uppercase tracking-[0.15em]">{label}</label>
                    <input
                      type="number"
                      min="0"
                      placeholder={placeholder}
                      value={aiCaps[key] ?? ''}
                      onChange={e => setAiCaps(prev => ({ ...prev, [key]: e.target.value }))}
                      className="w-full bg-white border border-border/50 rounded-xl px-3 py-2 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-blue-300 shadow-inner"
                    />
                  </div>
                ))}
              </div>

              {/* Live usage table */}
              {aiUsageUsers.length > 0 && (
                <div className="border border-border/40 rounded-2xl overflow-hidden">
                  <div className="bg-blue-50/60 px-4 py-2.5 border-b border-border/30">
                    <p className="text-[9px] font-black text-blue-700 uppercase tracking-widest">Current session usage (resets on server restart)</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-border/30">
                          <th className="text-left px-4 py-2 font-black text-muted-foreground/60 uppercase tracking-wide text-[9px]">User</th>
                          <th className="text-center px-3 py-2 font-black text-muted-foreground/60 uppercase tracking-wide text-[9px]">Hourly</th>
                          <th className="text-center px-3 py-2 font-black text-muted-foreground/60 uppercase tracking-wide text-[9px]">Daily</th>
                          <th className="text-center px-3 py-2 font-black text-muted-foreground/60 uppercase tracking-wide text-[9px]">Weekly</th>
                          <th className="text-center px-3 py-2 font-black text-muted-foreground/60 uppercase tracking-wide text-[9px]">Monthly</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiUsageUsers.map(u => {
                          const capOf = p => Number(aiCaps[p]) || 0;
                          const overOf = (p) => capOf(p) > 0 && u.usage[p] >= capOf(p);
                          return (
                            <tr key={u.userId} className="border-b border-border/20 last:border-0 hover:bg-blue-50/30 transition-colors">
                              <td className="px-4 py-2 font-bold text-foreground">{u.name}</td>
                              {['hourly','daily','weekly','monthly'].map(p => (
                                <td key={p} className="px-3 py-2 text-center">
                                  <span className={`px-2 py-0.5 rounded-lg font-black text-[10px] ${overOf(p) ? 'bg-red-100 text-red-600 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-100'}`}>
                                    {u.usage[p]}{capOf(p) > 0 ? `/${capOf(p)}` : ''}
                                  </span>
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {aiUsageUsers.length === 0 && (
                <p className="text-[11px] text-muted-foreground/50 text-center py-3">No AI calls recorded yet in this server session.</p>
              )}
            </div>

            {/* SMS Balance Alerts — multi-phone + multi-email + thresholds */}
            <div className="glass bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                    <AlertTriangle size={18} className="text-red-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">SMS Balance Alerts</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Receive SMS + email alerts every 2 hours when SMS provider balance falls below threshold.</p>
                  </div>
                </div>
                <button
                  onClick={saveSmsAlertSettings}
                  disabled={savingSmsAlerts}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 shadow-md shadow-red-200 active:scale-[0.98]"
                >
                  {savingSmsAlerts ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              </div>

              <div className="space-y-4">
                {/* Multi-phone tag input */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted-foreground/60 uppercase tracking-[0.15em]">Alert phone numbers</label>
                  {smsAlertPhones.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {smsAlertPhones.map(p => (
                        <span key={p} className="flex items-center gap-1 bg-red-50 border border-red-200 text-red-700 text-[11px] font-bold px-2 py-0.5 rounded-full">
                          {p}
                          <button onClick={() => setSmsAlertPhones(prev => prev.filter(x => x !== p))} className="text-red-400 hover:text-red-600 ml-0.5 leading-none">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <div className="flex flex-1 items-center gap-2 bg-white border border-border/50 rounded-xl px-3 py-2 shadow-inner">
                      <Phone size={13} className="text-muted-foreground shrink-0" />
                      <input
                        type="tel"
                        placeholder="e.g. 08012345678 — press Enter to add"
                        value={smsAlertPhoneInput}
                        onChange={e => setSmsAlertPhoneInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSmsPhone(); } }}
                        className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none font-medium"
                      />
                    </div>
                    <button onClick={addSmsPhone} className="px-3 py-2 rounded-xl bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold transition-colors">Add</button>
                  </div>
                  <p className="text-[9px] text-muted-foreground/50 leading-tight pl-1">Nigerian format (080…) or E.164 (+234…). SMS alerts go to all numbers listed.</p>
                </div>

                {/* Multi-email tag input */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted-foreground/60 uppercase tracking-[0.15em]">Additional alert email addresses</label>
                  {smsAlertEmails.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {smsAlertEmails.map(e => (
                        <span key={e} className="flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-bold px-2 py-0.5 rounded-full">
                          {e}
                          <button onClick={() => setSmsAlertEmails(prev => prev.filter(x => x !== e))} className="text-blue-400 hover:text-blue-600 ml-0.5 leading-none">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <div className="flex flex-1 items-center gap-2 bg-white border border-border/50 rounded-xl px-3 py-2 shadow-inner">
                      <Mail size={13} className="text-muted-foreground shrink-0" />
                      <input
                        type="email"
                        placeholder="email@example.com — press Enter to add"
                        value={smsAlertEmailInput}
                        onChange={e => setSmsAlertEmailInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSmsEmail(); } }}
                        className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none font-medium"
                      />
                    </div>
                    <button onClick={addSmsEmail} className="px-3 py-2 rounded-xl bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-bold transition-colors">Add</button>
                  </div>
                  <p className="text-[9px] text-muted-foreground/50 leading-tight pl-1">These are added on top of SUPER_ADMIN_EMAIL. Email alerts go to all addresses.</p>
                </div>

                {/* Threshold inputs */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-black text-muted-foreground/60 uppercase tracking-[0.15em]">Termii alert threshold (₦)</label>
                    <input
                      type="number" min="0" placeholder="1000"
                      value={smsAlertTermiiThreshold}
                      onChange={e => setSmsAlertTermiiThreshold(e.target.value)}
                      className="w-full bg-white border border-border/50 rounded-xl px-3 py-2 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-red-300 shadow-inner"
                    />
                    <p className="text-[9px] text-muted-foreground/50 pl-1">Alert when balance drops below this amount</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-black text-muted-foreground/60 uppercase tracking-[0.15em]">Twilio alert threshold ($)</label>
                    <input
                      type="number" min="0" step="0.01" placeholder="5"
                      value={smsAlertTwilioThreshold}
                      onChange={e => setSmsAlertTwilioThreshold(e.target.value)}
                      className="w-full bg-white border border-border/50 rounded-xl px-3 py-2 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-red-300 shadow-inner"
                    />
                    <p className="text-[9px] text-muted-foreground/50 pl-1">Alert when balance drops below this amount</p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50/70 border border-amber-200/60">
                  <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-700 leading-relaxed">Alerts send every <strong>2 hours</strong> while balance stays below threshold. Email goes to <strong>SUPER_ADMIN_EMAIL</strong> + any addresses added above. SMS goes to all phone numbers listed.</p>
                </div>
              </div>
            </div>

            {/* Chairman / CEO Routing Access — own save action */}
            <div className="glass bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                    <ShieldCheck size={18} className="text-amber-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Chairman / CEO Routing Access</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Control which departments can route requests directly to Chairman / CEO.</p>
                  </div>
                </div>
                <button
                  onClick={saveChairmanSetting}
                  disabled={savingChairman}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 shadow-md shadow-amber-200 active:scale-[0.98]"
                >
                  {savingChairman ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              </div>
              <div className="max-h-[420px] overflow-y-auto custom-scrollbar pr-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {allDepts.filter(d => !/ceo|chairman/i.test(d.name)).map(dept => {
                  const allowed = chairmanAllowedIds.includes(dept.id);
                  return (
                    <button
                      key={dept.id}
                      onClick={() => toggleChairmanDept(dept.id)}
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${allowed ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white border-border/40 text-muted-foreground hover:border-amber-200'}`}
                    >
                      <div className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${allowed ? 'bg-amber-500 border-amber-500' : 'border-border'}`}>
                        {allowed && <CheckCircle2 size={10} className="text-white" />}
                      </div>
                      <span className="text-[11px] font-bold truncate">{dept.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : activeTab === 'stages' ? (
          <div className="space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div>
              <p className="text-[10px] font-black text-muted-foreground/50 uppercase tracking-[0.25em] mb-3">Approval Workflow</p>
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex justify-end">
              <button 
                onClick={addStage}
                disabled={isProcessing}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3 px-6 rounded-xl transition-all shadow-lg shadow-primary/20 flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                   <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin"></div>
                ) : (
                   <Plus size={18} />
                )}
                <span>{isProcessing ? 'Adding...' : 'Add Stage'}</span>
              </button>
            </div>
            
            <div className="flex flex-col items-center space-y-0">
              {stages.map((stage, idx) => (
                <WorkflowStage 
                  key={stage.id} 
                  stage={stage} 
                  onUpdate={updateStage}
                  onDelete={() => { setPendingStage(stage); setIsDeleteModalOpen(true); }}
                  isFirst={idx === 0}
                />
              ))}

              <div className="flex flex-col items-center mt-4">
                 <div className="h-8 w-px bg-border"></div>
                 <div className="glass p-4 rounded-2xl border border-emerald-500/20 bg-emerald-50 text-emerald-600 font-bold text-xs uppercase tracking-[0.2em] shadow-sm">
                    Finance Processing (Final)
                 </div>
              </div>
            </div>
          </div>
            </div>
            <div>
              <p className="text-[10px] font-black text-muted-foreground/50 uppercase tracking-[0.25em] mb-3">Unit Types</p>
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
             <div className="glass bg-white/60 p-8 rounded-[2.5rem] border border-border/50 shadow-xl overflow-hidden relative">
                <div className="flex items-center justify-between mb-8 pb-6 border-b border-border/40">
                    <h3 className="text-xl font-bold text-foreground">Manage Requisition Types</h3>
                    <form onSubmit={handleAddType} className="flex items-center space-x-3">
                        <input 
                            type="text" 
                            value={newTypeName}
                            onChange={(e) => setNewTypeName(e.target.value)}
                            placeholder="New Type (e.g. Petty Cash)"
                            className="bg-muted/30 border border-border/50 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none w-64"
                        />
                        <button type="submit" disabled={isProcessing} className="bg-primary p-3 rounded-xl text-primary-foreground hover:scale-105 transition-all shadow-lg shadow-primary/20 active:scale-95">
                           <Plus size={20} />
                        </button>
                    </form>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {types.map(type => (
                        <div key={type.id} className="p-5 rounded-2xl border border-border/40 bg-white/40 group hover:border-primary/20 transition-all flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                                   <FileText size={20} />
                                </div>
                                <span className="font-bold text-foreground">{type.name}</span>
                            </div>
                            <button 
                                onClick={() => { setPendingType(type); setIsDeleteModalOpen(true); }}
                                className="p-2 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/5 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                </div>
             </div>
          </div>
            </div>
            <div>
              <p className="text-[10px] font-black text-muted-foreground/50 uppercase tracking-[0.25em] mb-3">Reference Code Pattern</p>
          <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="glass bg-white/60 p-8 rounded-[2.5rem] border border-border/50 shadow-xl space-y-6">
              <div className="flex items-start gap-3">
                <Hash size={22} className="text-primary mt-0.5 shrink-0" />
                <div>
                  <h3 className="text-lg font-black text-foreground tracking-tight">Reference Code Pattern</h3>
                  <p className="text-sm text-muted-foreground mt-1 font-medium leading-relaxed">
                    Configure the parts used to build auto-generated reference numbers on every new request.
                    Changes apply to all new requests going forward.
                  </p>
                </div>
              </div>

              {/* Live preview */}
              <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 text-center">
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1">Preview</p>
                <p className="text-base font-mono font-black text-primary tracking-wider">
                  {refPattern.orgPrefix || 'CSSG'}/{'{DEPT}'}/{refPattern.typeCash || 'FR'}/24032026/01
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">Fund · {refPattern.orgPrefix || 'CSSG'}/{'{DEPT}'}/{refPattern.typeMaterial || 'MR'}/24032026/01 · Material · {refPattern.orgPrefix || 'CSSG'}/{'{DEPT}'}/{refPattern.typeMemo || 'MO'}/24032026/01 · Memo</p>
              </div>

              <div className="space-y-4">
                {/* Org Prefix */}
                <div className="p-5 rounded-2xl border-2 border-border/50 bg-white/80 space-y-3">
                  <div>
                    <p className="text-sm font-black text-foreground">Organisation Prefix</p>
                    <p className="text-[11px] text-muted-foreground">The company/group code at the start of every reference. E.g. <span className="font-mono font-bold">CSSG</span> for CSS Group.</p>
                  </div>
                  <input
                    value={refPattern.orgPrefix}
                    onChange={e => setRefPattern(p => ({ ...p, orgPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) }))}
                    className="w-full text-sm font-mono font-bold border border-border/50 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 uppercase bg-white"
                    placeholder="CSSG"
                    maxLength={8}
                  />
                </div>

                {/* Type codes */}
                <div className="p-5 rounded-2xl border-2 border-border/50 bg-white/80 space-y-4">
                  <div>
                    <p className="text-sm font-black text-foreground">Request Type Codes</p>
                    <p className="text-[11px] text-muted-foreground">Short code inserted in the reference to identify the request type.</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Fund Request</label>
                      <input
                        value={refPattern.typeCash}
                        onChange={e => setRefPattern(p => ({ ...p, typeCash: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) }))}
                        className="w-full text-sm font-mono font-bold border border-border/50 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 uppercase bg-white"
                        placeholder="FR"
                        maxLength={4}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Material Request</label>
                      <input
                        value={refPattern.typeMaterial}
                        onChange={e => setRefPattern(p => ({ ...p, typeMaterial: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) }))}
                        className="w-full text-sm font-mono font-bold border border-border/50 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 uppercase bg-white"
                        placeholder="MR"
                        maxLength={4}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Memo</label>
                      <input
                        value={refPattern.typeMemo}
                        onChange={e => setRefPattern(p => ({ ...p, typeMemo: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) }))}
                        className="w-full text-sm font-mono font-bold border border-border/50 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 uppercase bg-white"
                        placeholder="MO"
                        maxLength={4}
                      />
                    </div>
                  </div>
                </div>

                {/* Pattern explanation */}
                <div className="p-4 rounded-2xl bg-muted/40 border border-border/30 space-y-2">
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Pattern Breakdown</p>
                  <div className="grid grid-cols-5 gap-1 text-center text-[9px]">
                    {[
                      { part: refPattern.orgPrefix || 'CSSG', label: 'Org Prefix' },
                      { part: '{DEPT}',     label: 'Dept Code' },
                      { part: refPattern.typeCash || 'FR',   label: 'Type Code' },
                      { part: 'DDMMYYYY',  label: 'Date' },
                      { part: '01',        label: 'Daily Seq.' },
                    ].map((item, i) => (
                      <div key={i} className="space-y-1">
                        <div className="font-mono font-black text-primary text-[10px] bg-primary/10 rounded-lg py-1.5">{item.part}</div>
                        <div className="text-muted-foreground">{item.label}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    <strong>{'{DEPT}'}</strong> is taken from each department's <em>code</em> field. If a dept has no code set, it is auto-abbreviated from the department name.
                    The daily sequence resets to 01 each day.
                  </p>
                </div>
              </div>

              <button
                onClick={saveRefPattern}
                disabled={savingRef}
                className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-black py-3.5 rounded-2xl transition-all shadow-lg shadow-primary/20 text-xs uppercase tracking-widest disabled:opacity-50 active:scale-[0.98]"
              >
                {savingRef ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {savingRef ? 'Saving…' : 'Save Reference Pattern'}
              </button>
            </div>
          </div>
            </div>
          </div>
        ) : activeTab === 'print' ? (
          <div className="space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div>
              <p className="text-[10px] font-black text-muted-foreground/50 uppercase tracking-[0.25em] mb-3">Print Settings</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {/* Print Record Access */}
            <div className="glass bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center shrink-0">
                    <Printer size={18} className="text-sky-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Print Record Access</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Choose which departments can see the Print Record button.</p>
                  </div>
                </div>
                <button
                  onClick={savePrintSettings}
                  disabled={savingPrint || canPrintIds === null}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 shadow-md shadow-sky-200 active:scale-[0.98]"
                >
                  {savingPrint ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              </div>
              {canPrintIds === null ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={18} className="animate-spin text-muted-foreground/40" />
                </div>
              ) : (
                <div className="flex-1 max-h-[320px] overflow-y-auto custom-scrollbar pr-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {allDepts.map(dept => {
                    const allowed = canPrintIds.includes(dept.id);
                    return (
                      <button
                        key={dept.id}
                        onClick={() => toggleCanPrintDept(dept.id)}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${allowed ? 'bg-sky-50 border-sky-300 text-sky-800' : 'bg-white border-border/40 text-muted-foreground hover:border-sky-200'}`}
                      >
                        <div className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${allowed ? 'bg-sky-500 border-sky-500' : 'border-border'}`}>
                          {allowed && <CheckCircle2 size={10} className="text-white" />}
                        </div>
                        <span className="text-[11px] font-bold truncate">{dept.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Seal Stamp on PDF */}
            <div className="glass bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center shrink-0">
                    <Award size={18} className="text-teal-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Seal Stamp on PDF</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Show or hide the CSS Farms circular seal on all print records.</p>
                  </div>
                </div>
                <button
                  onClick={savePrintSettings}
                  disabled={savingPrint || canPrintIds === null}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 shadow-md shadow-teal-200 active:scale-[0.98]"
                >
                  {savingPrint ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              </div>
              <div className="flex-1 flex flex-col justify-center space-y-6">
                <div className="flex items-center justify-between p-5 rounded-2xl border border-border/40 bg-white shadow-inner">
                  <div className="space-y-1">
                    <p className="text-xs font-black text-foreground uppercase tracking-tight">
                      {showStampOnPdf ? 'Seal Stamp Visible' : 'Seal Stamp Hidden'}
                    </p>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {showStampOnPdf
                        ? 'The CSS Farms circular seal appears on all generated print record PDFs.'
                        : 'The CSS Farms seal is hidden from all print record PDFs organisation-wide.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowStampOnPdf(v => !v)}
                    className={`relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none shadow-inner ${showStampOnPdf ? 'bg-teal-500' : 'bg-muted-foreground/30'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-lg transition-transform duration-300 ${showStampOnPdf ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>
                <div className="p-4 bg-muted/20 rounded-xl border border-border/10 flex items-start gap-3">
                  <Info size={14} className="text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground/80 font-medium italic">
                    This setting takes effect on all print records generated after saving. Existing saved PDFs are not affected.
                  </p>
                </div>
              </div>
            </div>
            {/* Signature on PDF */}
            <div className="glass bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0">
                    <PenTool size={16} className="text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Signature on PDF</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Show or hide the department head's biological signature on all print records.</p>
                  </div>
                </div>
                <button
                  onClick={savePrintSettings}
                  disabled={savingPrint || canPrintIds === null}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 shadow-md shadow-indigo-200 active:scale-[0.98]"
                >
                  {savingPrint ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              </div>
              <div className="flex-1 flex flex-col justify-center space-y-6">
                <div className="flex items-center justify-between p-5 rounded-2xl border border-border/40 bg-white shadow-inner">
                  <div className="space-y-1">
                    <p className="text-xs font-black text-foreground uppercase tracking-tight">
                      {showSignatureOnPdf ? 'Signature Visible' : 'Signature Hidden'}
                    </p>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {showSignatureOnPdf
                        ? 'Department head signatures appear on all generated print record PDFs.'
                        : 'Signatures are hidden from all print record PDFs organisation-wide.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowSignatureOnPdf(v => !v)}
                    className={`relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none shadow-inner ${showSignatureOnPdf ? 'bg-indigo-500' : 'bg-muted-foreground/30'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-lg transition-transform duration-300 ${showSignatureOnPdf ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>
                <div className="p-4 bg-muted/20 rounded-xl border border-border/10 flex items-start gap-3">
                  <Info size={14} className="text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground/80 font-medium italic">
                    This controls whether the head official's wet signature image is embedded in the PDF processing trail. The name and title are also hidden when disabled.
                  </p>
                </div>
              </div>
            </div>

            {/* Governance Setup Requirement */}
            <div className="glass bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                    <ShieldCheck size={16} className="text-amber-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Governance Setup Requirement</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Require departments to register their head official profile and signature before initiating requisitions.</p>
                  </div>
                </div>
                <button
                  onClick={savePrintSettings}
                  disabled={savingPrint || canPrintIds === null}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 shadow-md shadow-amber-200 active:scale-[0.98]"
                >
                  {savingPrint ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              </div>
              <div className="flex-1 flex flex-col justify-center space-y-6">
                <div className="flex items-center justify-between p-5 rounded-2xl border border-border/40 bg-white shadow-inner">
                  <div className="space-y-1">
                    <p className="text-xs font-black text-foreground uppercase tracking-tight">
                      {requireGovernanceSetup ? 'Setup Required' : 'Setup Optional'}
                    </p>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {requireGovernanceSetup
                        ? 'Departments see a mandatory "Governance Setup Required" banner and cannot initiate requests until their head official is registered.'
                        : 'Departments can initiate requisitions without completing governance setup.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setRequireGovernanceSetup(v => !v)}
                    className={`relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none shadow-inner ${requireGovernanceSetup ? 'bg-amber-500' : 'bg-muted-foreground/30'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-lg transition-transform duration-300 ${requireGovernanceSetup ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>
                <div className="p-4 bg-muted/20 rounded-xl border border-border/10 flex items-start gap-3">
                  <Info size={14} className="text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground/80 font-medium italic">
                    When disabled, the "Governance Setup Required" banner is hidden from all department dashboards organisation-wide, regardless of each department's completion status.
                  </p>
                </div>
              </div>
            </div>
          </div>

            </div>
            <div>
              <p className="text-[10px] font-black text-muted-foreground/50 uppercase tracking-[0.25em] mb-3">Contact & Email</p>
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {/* ICT Support Phone */}
            <div className="glass bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
                    <Phone size={18} className="text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Support Contact Phone</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Shown on the login forgot-code screen. Users tap to call ICT directly.</p>
                  </div>
                </div>
                <button
                  onClick={saveIctPhone}
                  disabled={savingPhone || !ictPhone.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50 shrink-0"
                >
                  {savingPhone ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  Save
                </button>
              </div>
              <input
                type="tel"
                value={ictPhone}
                onChange={(e) => setIctPhone(e.target.value)}
                placeholder="e.g. +2348061629865"
                className="w-full bg-muted/20 border border-border/50 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-200 outline-none"
              />
              <p className="text-[10px] text-muted-foreground/70 mt-2 italic">
                Include country code for tap-to-call to work on mobile devices.
              </p>
            </div>

            {/* Email Notifications */}
            <div className="glass bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-5">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${emailStatus?.configured ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                  {emailStatus?.configured ? <Wifi size={16} className="text-emerald-600" /> : <WifiOff size={16} className="text-red-500" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Email Notifications</h3>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">Configure outgoing email so departments receive notifications</p>
                </div>
                <button onClick={loadEmailStatus} className="ml-auto p-2 rounded-xl border border-border/40 text-muted-foreground hover:bg-muted/60 transition-all">
                  <RotateCcw size={12} />
                </button>
              </div>
              {emailStatus ? (
                <div className="space-y-4">
                  <div className={`p-3 rounded-xl border text-xs flex items-start gap-3 ${emailStatus.configured ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    {emailStatus.configured ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertCircle size={14} className="shrink-0 mt-0.5" />}
                    <div>
                      {emailStatus.configured ? (
                        <>
                          <p className="font-bold">Email ready via Resend{emailStatus.fromAddress ? ` · ${emailStatus.fromAddress}` : ''}</p>
                          {emailStatus.error && <p className="mt-1 text-amber-700">⚠ {emailStatus.error}</p>}
                        </>
                      ) : (
                        <>
                          <p className="font-bold">Email is NOT configured — notifications will not be sent</p>
                          {emailStatus.error && <p className="mt-1 opacity-80">{emailStatus.error}</p>}
                          <div className="mt-2 space-y-1 opacity-90">
                            <p className="font-semibold">Add to Railway Variables:</p>
                            <code className="block bg-red-100 px-2 py-1 rounded text-[10px] font-mono">RESEND_API_KEY = re_xxxxxxxxxxxx</code>
                            <code className="block bg-red-100 px-2 py-1 rounded text-[10px] font-mono">RESEND_FROM_EMAIL = info@yourdomain.com</code>
                            <p className="text-[10px] mt-1">Get a free key at <strong>resend.com</strong> (3000 emails/month free)</p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Send Test Email</p>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={emailTestAddr}
                        onChange={e => setEmailTestAddr(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && sendTestEmail()}
                        placeholder="recipient@example.com"
                        className="flex-1 text-sm border border-border/50 rounded-xl px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <button
                        onClick={sendTestEmail}
                        disabled={emailTesting || !emailTestAddr.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all"
                      >
                        {emailTesting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        Send
                      </button>
                    </div>
                    {emailTestResult && (
                      <div className={`p-2.5 rounded-xl text-xs border ${emailTestResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                        {emailTestResult.success ? `✓ ${emailTestResult.message}` : `✗ ${emailTestResult.message || emailTestResult.error}`}
                        {emailTestResult.hint && <p className="mt-1 opacity-80 text-[10px]">{emailTestResult.hint}</p>}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-muted-foreground/40" /></div>
              )}
            </div>
          </div>

            </div>
          </div>
        ) : activeTab === 'images' ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="glass bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center shrink-0">
                    <Image size={18} className="text-violet-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Image Library</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Upload images here, then pick them from any image field — no URL copying needed.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={loadMedia} disabled={mediaLoading} className="p-2 rounded-xl border border-border/40 text-muted-foreground hover:bg-muted/60 transition-all">
                    <RotateCcw size={13} className={mediaLoading ? 'animate-spin' : ''} />
                  </button>
                  <button
                    onClick={() => mediaFileRef.current?.click()}
                    disabled={mediaUploading}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 shadow-md shadow-violet-200"
                  >
                    {mediaUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    {mediaUploading ? 'Uploading…' : 'Upload Image'}
                  </button>
                  <input ref={mediaFileRef} type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) handleMediaUpload(e.target.files[0]); }} />
                </div>
              </div>

              {mediaLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={20} className="animate-spin text-muted-foreground/40" />
                </div>
              ) : mediaImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-muted/30 border border-border/30 flex items-center justify-center">
                    <Image size={24} className="text-muted-foreground/30" />
                  </div>
                  <p className="text-sm font-bold text-muted-foreground">No images uploaded yet</p>
                  <p className="text-[11px] text-muted-foreground/60 text-center max-w-xs">
                    Click "Upload Image" to add images to the library. They'll appear as a visual picker wherever an image field exists.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {mediaImages.map(img => (
                    <div key={img.id} className="group relative rounded-2xl overflow-hidden border border-border/40 bg-muted/20 aspect-square">
                      <img src={MEDIA_SERVE(img.key)} alt={img.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex flex-col justify-between p-2 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={() => handleMediaDelete(img.id)}
                          disabled={deletingMediaId === img.id}
                          className="self-end w-6 h-6 rounded-lg bg-red-500 text-white flex items-center justify-center shadow hover:bg-red-600 transition-all"
                        >
                          {deletingMediaId === img.id ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
                        </button>
                        <div className="space-y-0.5">
                          <p className="text-[9px] font-bold text-white truncate">{img.name}</p>
                          <button
                            onClick={() => { navigator.clipboard.writeText(MEDIA_SERVE(img.key)); toast.success('URL copied!'); }}
                            className="text-[8px] font-black text-white/80 hover:text-white uppercase tracking-widest underline"
                          >
                            Copy URL
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'bin' ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="glass bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                    <Trash2 size={16} className="text-red-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Deleted Records Bin</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Records archived when departments were deleted. Purge to remove permanently.</p>
                  </div>
                </div>
                <button onClick={loadDeletedRecords} disabled={loadingBin} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border/40 text-muted-foreground hover:bg-muted/60 text-[10px] font-bold transition-all">
                  {loadingBin ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                  Refresh
                </button>
              </div>
              {loadingBin ? (
                <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-muted-foreground/40" /></div>
              ) : deletedRecords.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground/50 text-sm">No deleted records in bin.</div>
              ) : (
                <div className="space-y-2.5">
                  {deletedRecords.map(rec => (
                    <div key={rec.id} className="flex items-center gap-4 p-4 rounded-2xl bg-muted/20 border border-border/30 hover:bg-muted/30 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-black text-foreground">#{rec.originalId}</span>
                          <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-lg bg-red-50 border border-red-200 text-red-700">{rec.snapshot?.type || 'Record'}</span>
                          <span className="text-[11px] font-semibold text-foreground truncate max-w-[200px]">{rec.snapshot?.title || '—'}</span>
                        </div>
                        <p className="text-[9px] text-muted-foreground/60 mt-1">From <strong>{rec.departmentName || '—'}</strong> · deleted by {rec.deletedByName || '—'} · {new Date(rec.deletedAt).toLocaleDateString()}</p>
                      </div>
                      <button onClick={() => setViewingRecord(rec)} className="p-2 rounded-xl border border-border/40 text-muted-foreground hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-all" title="View details">
                        <Eye size={13} />
                      </button>
                      {pendingPurgeId === rec.id ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-red-600 font-bold">Purge permanently?</span>
                          <button onClick={() => handlePurgeRecord(rec.id)} className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-[9px] font-black uppercase hover:bg-red-700 transition-all">Yes</button>
                          <button onClick={() => setPendingPurgeId(null)} className="px-2.5 py-1 rounded-lg border border-border/40 text-muted-foreground text-[9px] font-bold hover:bg-muted/60 transition-all">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => confirmPurgeRecord(rec.id)} disabled={purgingId === rec.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-50 border border-red-200 text-red-600 text-[9px] font-black uppercase hover:bg-red-100 transition-all disabled:opacity-50">
                          {purgingId === rec.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                          Purge
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="glass bg-white/70 rounded-3xl border border-red-200/60 p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                  <Zap size={16} className="text-red-500" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-red-700">Danger Zone — Hard Reset</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Selectively wipe data categories. This cannot be undone.</p>
                </div>
              </div>

              <div className="p-4 bg-red-50/60 border border-red-200/60 rounded-2xl mb-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-red-700 leading-relaxed">
                    A Hard Reset permanently deletes the selected data categories from the live database. There is no undo. Department structure, user accounts, and system settings are <strong>never</strong> affected.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                {[
                  { key: 'requisitions', label: 'All Requisitions', desc: 'Clears every request, approval, attachment, and audit record' },
                  { key: 'subAccounts', label: 'Sub-Accounts', desc: 'Removes staff sub-account users (keeps head accounts)' },
                  { key: 'deptActivations', label: 'Dept Activations', desc: 'Resets all department activation timestamps' },
                  { key: 'activityLogs', label: 'Activity Logs', desc: 'Wipes the full audit trail / activity history' },
                  { key: 'chatMessages', label: 'Chat Messages', desc: 'Deletes all inter-department chat history' },
                  { key: 'storeRecords', label: 'Store Records', desc: 'Clears store inventory and transaction records' },
                  { key: 'notifications', label: 'Notifications', desc: 'Removes all unread and read notifications' },
                ].map(({ key, label, desc }) => (
                  <label key={key} className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${resetOptions[key] ? 'bg-red-50/60 border-red-200 text-red-800' : 'bg-muted/20 border-border/30 text-muted-foreground'}`}>
                    <input type="checkbox" checked={resetOptions[key]} onChange={e => setResetOptions(p => ({ ...p, [key]: e.target.checked }))} className="mt-0.5 accent-red-600" />
                    <div>
                      <p className="text-[11px] font-black">{label}</p>
                      <p className="text-[9px] mt-0.5 opacity-70">{desc}</p>
                    </div>
                  </label>
                ))}
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-black text-foreground uppercase tracking-widest">Type <span className="text-red-600 font-mono">CONFIRM HARD RESET</span> to proceed</p>
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={e => setResetConfirmText(e.target.value)}
                  placeholder="CONFIRM HARD RESET"
                  className="w-full bg-muted/20 border border-border/50 rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-red-200 outline-none"
                />
                <button
                  onClick={handleHardReset}
                  disabled={resetting || resetConfirmText !== 'CONFIRM HARD RESET' || !Object.values(resetOptions).some(Boolean)}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-50 shadow-md"
                >
                  {resetting ? <><Loader2 size={13} className="animate-spin" />Running reset…</> : <><Zap size={13} />Execute Hard Reset</>}
                </button>
              </div>

              {resetSummary && (
                <div className="mt-5 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
                  <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-2">Reset Complete</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(resetSummary).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between text-[10px]">
                        <span className="text-muted-foreground capitalize">{k.replace(/([A-Z])/g, ' $1')}</span>
                        <span className="font-black text-emerald-700">{v} removed</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

        ) : null}
      </div>

      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        size="lg"
        isProcessing={isProcessing}
        title={pendingStage ? "Delete Workflow Stage" : "Delete Requisition Type"}
        message={pendingStage
          ? `Are you sure you want to delete the "${pendingStage?.name}" stage? This will re-sequence the approval chain.`
          : `Are you sure you want to delete the "${pendingType?.name}" requisition type? This cannot be undone.`
        }
      />

      {viewingRecord && (
        <DeletedRecordModal rec={viewingRecord} onClose={() => setViewingRecord(null)} />
      )}
    </>
  );
};

export default WorkflowBuilder;
