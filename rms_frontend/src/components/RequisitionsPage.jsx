import React, { useState, useEffect } from 'react';
import CashRequestForm from './CashRequestForm';
import ApprovalTimeline from './ApprovalTimeline';
import ApprovalActionPanel from './ApprovalActionPanel';
import ConfirmModal from './ConfirmModal';
import VoiceDictation from './VoiceDictation';
import { useAuth } from '../context/AuthContext';
import { getOperationalRequisitions, getRequisitionDetail, updateRequisitionStatus, downloadSignedPdf, downloadDynamicPdf, getDepartments, forwardRequisition, finalApproveRequisition, sendToVettingRequisition, reapproveRequisition, forwardForReapproval, vettingActionRequisition, uploadAttachments, isMemoRecord, kivRequisition, unKivRequisition, saveAuditOverride, clearAuditOverride, iccComment, iccFreeze, iccUnfreeze, iccVetForward, iccVetReturn, convertRequisitionToCash } from '../lib/store'; // kivRequisition/unKivRequisition reused in IccObserverPanel
import { aiAPI, settingsAPI, printSettingsAPI } from '../lib/api';
import { loadCachedFlag } from '../lib/featureFlag';
import { getEffectiveAmount, getLiveTrailDepartment, normalizeReq } from '../lib/requisitionDisplay';
import { useAIFeatures } from '../context/AIFeaturesContext';
import { toast } from 'react-hot-toast';
import {
  Search, Plus, Eye, EyeOff, FileText, X,
  ChevronRight, Paperclip, ShieldCheck, Clock,
  ArrowRightCircle, CornerDownLeft, Loader2, Send, Trash2, Printer,
  Building2, ArrowRight, ArrowLeft, History, Download, AlertTriangle,
  ExternalLink, ArrowDownToLine, MessageSquare, RotateCcw, Forward as ForwardIcon,
  CheckCircle2, Award, ChevronDown, ChevronUp, Gavel, Zap, Trash, BookMarked, Users,
  Lock, Unlock, ShieldAlert, MessageCircle, Check, Shield
} from 'lucide-react';
import { reqAPI, forwardAPI } from '../lib/api';

// Highlights the first occurrence of `query` inside `text` with a yellow mark
const Highlight = ({ text, query }) => {
  const str = String(text ?? '');
  if (!query) return <>{str}</>;
  const idx = str.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{str}</>;
  return (
    <>
      {str.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded-sm px-0.5 not-italic">{str.slice(idx, idx + query.length)}</mark>
      {str.slice(idx + query.length)}
    </>
  );
};

const statusColors = {
  pending:    'bg-amber-50 border-amber-200 text-amber-700',
  approved:   'bg-emerald-50 border-emerald-200 text-emerald-700',
  rejected:   'bg-red-50 border-red-200 text-red-700',
  draft:      'bg-muted border-border text-muted-foreground',
  // Final states
  vetting:    'bg-blue-50 border-blue-200 text-blue-700',
  treated:    'bg-indigo-50 border-indigo-200 text-indigo-700',
  partial:    'bg-orange-50 border-orange-200 text-orange-700',
  published:  'bg-emerald-50 border-emerald-200 text-emerald-700',
  kiv:        'bg-violet-50 border-violet-200 text-violet-700',
};

const urgencyColors = {
  normal:   'text-muted-foreground',
  urgent:   'text-amber-600 font-bold',
  critical: 'text-red-600 font-bold',
};

function buildTimeline(approvals = [], currentStage = null, reqStatus = '') {
  const completed = approvals.map(a => ({
    id:      `approval-${a.id}`,
    label:   a.stage?.name || 'Stage',
    role:    `${a.user?.name || 'Approver'} (${a.stage?.role || ''})`,
    status:  a.action,
    date:    new Date(a.createdAt).toLocaleString(),
    comment: a.remarks || null,
  }));
  if (reqStatus === 'pending' && currentStage) {
    completed.push({
      id:      `pending-${currentStage.id}`,
      label:   currentStage.name,
      role:    currentStage.role,
      status:  'pending',
      date:    null,
      comment: null,
    });
  }
  return completed;
}

// ── Processing Chain Timeline (for inter-department forward/return) ──────
export const ProcessingChain = ({ events = [] }) => {
  if (!events.length) return null;

  const actionConfig = {
    created:   { icon: Send,           color: 'bg-primary',     label: 'Sent' },
    forwarded: { icon: ArrowRightCircle, color: 'bg-blue-500',   label: 'Forwarded' },
    returned:  { icon: RotateCcw,      color: 'bg-amber-500',   label: 'Returned' },
  };

  return (
    <div className="space-y-0">
      {events.map((evt, idx) => {
        const cfg = actionConfig[evt.action] || actionConfig.created;
        const Icon = cfg.icon;
        const isLast = idx === events.length - 1;
        return (
          <div key={evt.id} className="relative pl-8 pb-5 last:pb-0">
            {!isLast && (
              <div className={`absolute left-[11px] top-6 bottom-0 w-[2px] ${evt.action === 'returned' ? 'bg-amber-300/50' : 'bg-primary/30'}`} />
            )}
            <div className={`absolute left-0 top-0 w-6 h-6 rounded-full ${cfg.color} flex items-center justify-center z-10 shadow-sm`}>
              <Icon size={12} className="text-white" />
            </div>
            <div className={`p-3 rounded-xl border ${evt.action === 'returned' ? 'bg-amber-50/50 border-amber-200/60' : 'bg-white/70 border-border/50'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[10px] font-black uppercase tracking-widest ${evt.action === 'returned' ? 'text-amber-700' : 'text-primary'}`}>
                  {cfg.label}
                </span>
                <span className="text-[9px] text-muted-foreground font-mono">{new Date(evt.createdAt).toLocaleString()}</span>
              </div>
              <div className="text-[11px] text-muted-foreground font-medium">
                {evt.fromDepartment?.name && <span>{evt.fromDepartment.name}</span>}
                {evt.toDepartment?.name && <span> → <strong className="text-foreground">{evt.toDepartment.name}</strong></span>}
              </div>
              {evt.actorName && <div className="text-[10px] text-muted-foreground/70 mt-0.5">By: {evt.actorName}</div>}
              {evt.note && (
                <div className="flex items-start gap-1.5 mt-2 p-2 bg-muted/40 rounded-lg text-[11px] text-foreground/80 italic">
                  <MessageSquare size={10} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <p className="leading-relaxed">{evt.note}</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};


// ── File Preview Modal (3-stage pipeline) ────────────────────────────────
// Stage 1: detect type from extension
// Stage 2: fetch with auth → Blob → blobUrl (uniform regardless of source)
// Stage 3: route to purpose-built renderer; always has a download fallback
const FilePreviewModal = ({ attachment, onClose, initialBlobUrl = null }) => {
  const [status,      setStatus]      = useState('loading'); // 'loading'|'ready'|'error'
  const [errorMsg,    setErrorMsg]    = useState('');
  const [blobUrl,     setBlobUrl]     = useState(null);   // pdf / image / video / audio
  const [textContent, setTextContent] = useState(null);   // text / pptx fallback
  const [sheetData,   setSheetData]   = useState(null);   // xlsx / csv: [[cell,...],...]
  const [sheetNames,  setSheetNames]  = useState([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [docxBlob,    setDocxBlob]    = useState(null);   // docx: raw Blob for renderAsync
  const docxRef = React.useRef(null);

  if (!attachment) return null;

  const serverUrl   = attachment?.id ? `/api/attachments/${attachment.id}/preview` : null;
  // Downloads use fetch+blob (no token in URL)
  const triggerSecureDownload = async (attachId, filename) => {
    try {
      const res = await fetch(`/api/attachments/${attachId}/download`, { credentials: 'include' });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a);
      a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch { toast.error('Download failed. Please try again.'); }
  };
  const name        = attachment?.filename || 'Document Preview';
  const ext         = initialBlobUrl ? 'pdf' : (name.split('.').pop().toLowerCase());
  const isMobile    = window.innerWidth < 768;

  // ── Stage 1: classify by extension ──────────────────────────────────────
  const fileType = (() => {
    if (ext === 'pdf')                                                      return 'pdf';
    if (['docx', 'doc'].includes(ext))                                      return 'docx';
    if (['xlsx', 'xls'].includes(ext))                                      return 'xlsx';
    if (ext === 'csv')                                                      return 'csv';
    if (['pptx', 'ppt'].includes(ext))                                      return 'pptx';
    if (['jpg','jpeg','png','gif','webp','svg','bmp','ico'].includes(ext))   return 'image';
    if (['mp4','mov','webm','mkv','avi','flv'].includes(ext))               return 'video';
    if (['mp3','wav','m4a','aac','ogg','flac','wma'].includes(ext))         return 'audio';
    if (['txt','log','md','json','xml','html','htm','css','js','ts','yaml','yml','ini','env'].includes(ext)) return 'text';
    return 'unknown';
  })();

  // ── Stage 2: fetch → Blob + Stage 3 setup ───────────────────────────────
  React.useEffect(() => {
    if (initialBlobUrl) {
      setBlobUrl(initialBlobUrl);
      setStatus('ready');
      return;
    }

    let activeBlobUrl = null;
    setStatus('loading');
    setBlobUrl(null); setTextContent(null); setSheetData(null); setDocxBlob(null);

    const processFile = async () => {
      try {
        // Cookie-authenticated fetch (server proxies — never redirects to R2)
        const res = await fetch(serverUrl, { credentials: 'include' });
        if (!res.ok) throw new Error(`Server returned ${res.status}: ${res.statusText}`);
        const blob = await res.blob();

        if (fileType === 'docx') {
          // docx-preview needs the raw Blob; renderAsync is called in a separate effect
          setDocxBlob(blob);
          setStatus('ready');
          return;
        }

        if (fileType === 'xlsx' || fileType === 'csv') {
          const { read, utils } = await import('xlsx');
          const buf = await blob.arrayBuffer();
          const wb  = read(new Uint8Array(buf), { type: 'array' });
          const allSheets = wb.SheetNames.map(sName => ({
            name: sName,
            rows: utils.sheet_to_json(wb.Sheets[sName], { header: 1, defval: '' })
          }));
          setSheetNames(allSheets.map(s => s.name));
          setSheetData(allSheets.map(s => s.rows));
          setActiveSheet(0);
          setStatus('ready');
          return;
        }

        if (fileType === 'text') {
          const text = await blob.text();
          setTextContent(text);
          setStatus('ready');
          return;
        }

        if (fileType === 'pptx') {
          // No client-side PPTX renderer — offer download; show size info
          setStatus('ready');
          return;
        }

        // pdf / image / video / audio: create a blob:// URL
        const url = URL.createObjectURL(blob);
        activeBlobUrl = url;
        setBlobUrl(url);
        setStatus('ready');

      } catch (err) {
        setErrorMsg(err.message || 'Failed to load file');
        setStatus('error');
      }
    };

    processFile();

    return () => { if (activeBlobUrl && !initialBlobUrl) URL.revokeObjectURL(activeBlobUrl); };
  }, [attachment?.id, initialBlobUrl]);

  // ── DOCX renderer: fires after docxBlob is set and the div ref is mounted ──
  React.useEffect(() => {
    if (!docxBlob || !docxRef.current) return;
    import('docx-preview').then(({ renderAsync }) => {
      renderAsync(docxBlob, docxRef.current, null, {
        className: 'docx-preview-content',
        inWrapper: false,
        ignoreWidth: true,
        ignoreHeight: true,
        breakPages: true,
        useBase64URL: true,
      }).catch(err => {
        setErrorMsg(err.message || 'DOCX render failed');
        setStatus('error');
      });
    });
  }, [docxBlob]);

  // ── Helpers ─────────────────────────────────────────────────────────────
  const openInNewTab = () => {
    const url = blobUrl || `${serverUrl}?token=${token}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // ── Shared loading spinner ───────────────────────────────────────────────
  const LoadingView = () => (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
      <Loader2 size={32} className="animate-spin text-primary" />
      <p className="text-sm font-medium">Loading preview…</p>
    </div>
  );

  // ── Error / download fallback ────────────────────────────────────────────
  const FallbackView = ({ label = 'No preview available', hint = 'Download the file to open it.' }) => (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center">
        <FileText size={36} className="text-muted-foreground/40" />
      </div>
      <div className="space-y-1 max-w-xs">
        <p className="text-sm font-bold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{hint}</p>
        {status === 'error' && errorMsg && (
          <p className="text-[10px] text-destructive font-mono mt-1 break-all">{errorMsg}</p>
        )}
      </div>
      <button onClick={() => triggerSecureDownload(attachment.id, name)}
        className="flex items-center justify-center gap-2 px-6 py-3 bg-primary text-white rounded-xl font-bold text-sm hover:bg-primary/90 transition-all shadow-md">
        <ArrowDownToLine size={16} /> Download File
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white w-full sm:rounded-2xl sm:max-w-4xl sm:mx-4 shadow-2xl flex flex-col overflow-hidden"
        style={{ height: isMobile ? '95dvh' : '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="p-3 sm:p-4 border-b border-border/50 flex items-center justify-between shrink-0 bg-white">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <FileText size={15} className="text-primary shrink-0" />
            <span className="text-xs sm:text-sm font-bold text-foreground truncate">{name}</span>
            {attachment?.size && (
              <span className="text-[9px] text-muted-foreground shrink-0">
                {(attachment.size / 1024).toFixed(0)} KB
              </span>
            )}
            <span className="text-[9px] font-mono uppercase text-primary/60 bg-primary/5 px-1.5 py-0.5 rounded shrink-0">{ext}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <button onClick={openInNewTab} title="Open in new tab"
              className="p-2 hover:bg-muted rounded-lg text-primary transition-colors">
              <ExternalLink size={15} />
            </button>
            {attachment?.id && (
              <button onClick={() => triggerSecureDownload(attachment.id, name)} title="Download"
                className="p-2 hover:bg-muted rounded-lg text-primary transition-colors">
                <ArrowDownToLine size={15} />
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg text-muted-foreground">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ── Stage 3: Renderer ── */}
        <div className="flex-1 overflow-auto bg-muted/10 flex flex-col min-h-0">

          {/* Loading */}
          {status === 'loading' && <LoadingView />}

          {/* Error */}
          {status === 'error' && <FallbackView label="Preview failed" hint="Something went wrong while loading this file." />}

          {/* ── PDF ── */}
          {status === 'ready' && fileType === 'pdf' && blobUrl && (
            isMobile ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center">
                <div className="w-20 h-20 rounded-3xl bg-red-50 border border-red-200 flex items-center justify-center">
                  <FileText size={36} className="text-red-500" />
                </div>
                <p className="text-sm font-bold text-foreground">PDF Document</p>
                <p className="text-xs text-muted-foreground">Tap below to view or download.</p>
                <div className="flex flex-col gap-3 w-full max-w-xs">
                  <button onClick={openInNewTab}
                    className="flex items-center justify-center gap-2 px-5 py-3 bg-primary text-white rounded-xl font-bold text-sm hover:bg-primary/90 shadow-md">
                    <ExternalLink size={16} /> Open PDF
                  </button>
                  <button onClick={() => triggerSecureDownload(attachment.id, name)}
                    className="flex items-center justify-center gap-2 px-5 py-3 bg-white border border-border text-foreground rounded-xl font-bold text-sm hover:bg-muted">
                    <ArrowDownToLine size={16} /> Download
                  </button>
                </div>
              </div>
            ) : (
              <iframe src={blobUrl} className="w-full flex-1 border-0" title={name} style={{ minHeight: '500px' }} />
            )
          )}

          {/* ── Image ── */}
          {status === 'ready' && fileType === 'image' && blobUrl && (
            <div className="flex-1 flex items-center justify-center p-4">
              <img src={blobUrl} alt={name}
                className="max-w-full max-h-full rounded-lg shadow-md object-contain"
                style={{ maxHeight: 'calc(90vh - 80px)' }} />
            </div>
          )}

          {/* ── Video ── */}
          {status === 'ready' && fileType === 'video' && blobUrl && (
            <div className="flex-1 flex items-center justify-center p-4 bg-black">
              <video src={blobUrl} controls className="max-w-full max-h-full rounded-lg shadow-xl"
                style={{ maxHeight: 'calc(90vh - 80px)' }}
                onLoadedMetadata={() => {}} />
            </div>
          )}

          {/* ── Audio ── */}
          {status === 'ready' && fileType === 'audio' && blobUrl && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
              <div className="w-24 h-24 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <FileText size={40} className="text-primary" />
              </div>
              <p className="text-sm font-bold text-foreground">{name}</p>
              <audio src={blobUrl} controls className="w-full max-w-md rounded-xl shadow-md"
                onLoadedMetadata={() => {}} />
            </div>
          )}

          {/* ── DOCX ── */}
          {status === 'ready' && fileType === 'docx' && (
            <div className="flex-1 overflow-auto p-4 sm:p-6 bg-white">
              <div
                ref={docxRef}
                className="mx-auto max-w-3xl bg-white shadow-sm border border-border/20 rounded-xl p-6 min-h-32"
                style={{ fontFamily: 'serif' }}
              />
              {!docxBlob && <LoadingView />}
            </div>
          )}

          {/* ── XLSX / CSV ── */}
          {status === 'ready' && (fileType === 'xlsx' || fileType === 'csv') && sheetData && (
            <div className="flex-1 flex flex-col min-h-0">
              {sheetNames.length > 1 && (
                <div className="flex gap-1 px-3 pt-3 shrink-0 overflow-x-auto">
                  {sheetNames.map((sn, i) => (
                    <button key={i} onClick={() => setActiveSheet(i)}
                      className={`px-3 py-1.5 rounded-t-lg text-[11px] font-bold border-b-2 transition-all whitespace-nowrap ${
                        activeSheet === i ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}>{sn}</button>
                  ))}
                </div>
              )}
              <div className="flex-1 overflow-auto p-3">
                <table className="w-full text-[11px] border-collapse bg-white rounded-xl overflow-hidden shadow-sm">
                  <tbody>
                    {(sheetData[activeSheet] || []).map((row, ri) => (
                      <tr key={ri} className={ri === 0 ? 'bg-primary/5 font-bold' : ri % 2 === 0 ? 'bg-muted/20' : 'bg-white'}>
                        {(Array.isArray(row) ? row : []).map((cell, ci) => (
                          ri === 0
                            ? <th key={ci} className="px-2 py-1.5 text-left border border-border/30 text-foreground font-black">{String(cell ?? '')}</th>
                            : <td key={ci} className="px-2 py-1.5 border border-border/20 text-foreground/80 max-w-[200px] truncate">{String(cell ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(!sheetData[activeSheet] || sheetData[activeSheet].length === 0) && (
                  <p className="text-center text-xs text-muted-foreground py-8">No data in this sheet</p>
                )}
              </div>
            </div>
          )}

          {/* ── Plain text / JSON / XML / code ── */}
          {status === 'ready' && fileType === 'text' && textContent !== null && (
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-xs font-mono text-foreground leading-relaxed whitespace-pre-wrap break-words bg-white border border-border/30 rounded-xl p-4 shadow-inner min-h-full">
                {textContent}
              </pre>
            </div>
          )}

          {/* ── PPTX / unknown — download fallback ── */}
          {status === 'ready' && (fileType === 'pptx' || fileType === 'unknown') && (
            <FallbackView
              label={fileType === 'pptx' ? 'PowerPoint Presentation' : 'Preview not available'}
              hint={fileType === 'pptx'
                ? 'PPTX files cannot be rendered in the browser. Download to open in PowerPoint.'
                : 'This file type cannot be previewed. Download it to open.'}
            />
          )}

        </div>
      </div>
    </div>
  );
};

// ── Print Stage Selector Modal ────────────────────────────────────────────
const PrintStageModal = ({ req, detail, onClose }) => {
  const [selectedStage, setSelectedStage] = useState('all');
  const [generating, setGenerating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [stagePreviewFile, setStagePreviewFile] = useState(null);

  const attachments = detail?.attachments || [];

  // Build printable stages from forward events and approvals
  const stages = [];
  if (detail?.forwardEvents?.length) {
    detail.forwardEvents.forEach(evt => {
      stages.push({
        id: `fwd-${evt.id}`,
        label: `${evt.action === 'created' ? 'Created' : evt.action === 'forwarded' ? 'Forwarded' : 'Returned'}: ${evt.fromDepartment?.name || 'Dept'} → ${evt.toDepartment?.name || 'Sender'}`,
        date: new Date(evt.createdAt).toLocaleString(),
        rawDate: evt.createdAt,
        type: 'forward'
      });
    });
  }
  if (detail?.approvals?.length) {
    detail.approvals.forEach(a => {
      stages.push({
        id: `app-${a.id}`,
        label: `${a.stage?.name || 'Approval'}: ${a.action} by ${a.user?.name || 'User'}`,
        date: new Date(a.createdAt).toLocaleString(),
        rawDate: a.createdAt,
        type: 'approval'
      });
    });
  }

  // Compute which attachments belong to each scope
  const getRelevantAttachments = (stageId) => {
    if (stageId === 'all') return attachments;
    // Filter by stageKey match first (tagged uploads)
    const byKey = attachments.filter(a => a.stageKey === stageId);
    if (byKey.length > 0) return byKey;
    // Fallback: attachments uploaded up to this stage's timestamp
    const stage = stages.find(s => s.id === stageId);
    if (!stage) return attachments;
    const cutoff = new Date(stage.rawDate).getTime();
    return attachments.filter(a => new Date(a.createdAt).getTime() <= cutoff);
  };

  const relevantAttachments = getRelevantAttachments(selectedStage);

  // Trigger browser download for a single attachment
  const triggerAttachmentDownload = async (a) => {
    try {
      const res = await fetch(`/api/attachments/${a.id}/download`, { credentials: 'include' });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = a.filename; document.body.appendChild(link);
      link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch { toast.error('Download failed.'); }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    const toastId = toast.loading('Generating report package...');
    try {
      const stageParam = selectedStage === 'all' ? null : selectedStage;
      await downloadDynamicPdf(req.id, stageParam);

      // Download relevant attachments alongside the PDF
      if (relevantAttachments.length > 0) {
        // Stagger downloads slightly to avoid browser blocking
        for (let i = 0; i < relevantAttachments.length; i++) {
          await new Promise(r => setTimeout(r, i * 300));
          triggerAttachmentDownload(relevantAttachments[i]);
        }
        toast.success(`Report + ${relevantAttachments.length} attachment(s) downloaded.`, { id: toastId });
      } else {
        toast.success('Report downloaded successfully!', { id: toastId });
      }
      onClose();
    } catch (err) {
      toast.error('Failed to generate report.', { id: toastId });
    } finally { setGenerating(false); }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    const toastId = toast.loading('Syncing level data for preview...');
    try {
      const stageParam = selectedStage === 'all' ? null : selectedStage;
      const blob = await reqAPI.getDynamicPdf(req.id, stageParam);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      toast.success('Report levels synchronized!', { id: toastId });
    } catch (err) {
      toast.error('Preview failed. Server busy.', { id: toastId });
    } finally { setPreviewing(false); }
  };

  return (
    <>
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Printer size={18} className="text-primary" />
              <h3 className="text-sm font-black uppercase tracking-widest text-foreground">Generate Report</h3>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground"><X size={16} /></button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">Select a scope — the PDF and any matching attachments will download together.</p>
        </div>
        <div className="p-5 max-h-[50vh] overflow-y-auto space-y-2">
          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${selectedStage === 'all' ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-primary/30'}`}>
            <input type="radio" name="stage" value="all" checked={selectedStage === 'all'} onChange={() => setSelectedStage('all')} className="text-primary" />
            <div className="flex-1">
              <span className="text-xs font-bold text-foreground">Full Report (All Stages)</span>
              <p className="text-[10px] text-muted-foreground">Complete document including all actions and signatures</p>
            </div>
            {attachments.length > 0 && (
              <span className="text-[9px] font-black text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
                +{attachments.length} file{attachments.length > 1 ? 's' : ''}
              </span>
            )}
          </label>
          {stages.map(s => {
            const stageFiles = getRelevantAttachments(s.id);
            return (
              <label key={s.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${selectedStage === s.id ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-primary/30'}`}>
                <input type="radio" name="stage" value={s.id} checked={selectedStage === s.id} onChange={() => setSelectedStage(s.id)} className="text-primary" />
                <div className="flex-1">
                  <span className="text-xs font-bold text-foreground">{s.label}</span>
                  <p className="text-[10px] text-muted-foreground">{s.date}</p>
                </div>
                {stageFiles.length > 0 && (
                  <span className="text-[9px] font-black text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
                    +{stageFiles.length} file{stageFiles.length > 1 ? 's' : ''}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {relevantAttachments.length > 0 && (
          <div className="px-5 pb-3">
            <div className="bg-muted/30 rounded-xl p-3 space-y-1.5 max-h-32 overflow-y-auto">
              <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-2">Attachments included in this download</p>
              {relevantAttachments.map(a => (
                <div key={a.id} className="flex items-center gap-2 text-[10px]">
                  <FileText size={10} className="text-primary shrink-0" />
                  <span className="flex-1 truncate text-foreground font-medium">{a.filename}</span>
                  {a.uploaderDept && <span className="text-muted-foreground/60 shrink-0 font-bold">{a.uploaderDept}</span>}
                  <button
                    onClick={() => setStagePreviewFile(a)}
                    title="Preview"
                    className="p-0.5 text-muted-foreground hover:text-primary rounded transition-colors shrink-0"
                  >
                    <Eye size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="p-5 border-t border-border/50 bg-muted/10 grid grid-cols-2 gap-3">
          <button
            onClick={handlePreview}
            disabled={generating || previewing}
            className="flex items-center justify-center gap-2 bg-white border border-border/60 hover:bg-muted text-foreground font-bold py-3 rounded-xl transition-all disabled:opacity-50 text-[10px] uppercase tracking-[0.2em] shadow-sm animate-pulse-slow"
          >
            {previewing ? <Loader2 size={16} className="animate-spin text-primary" /> : <Eye size={16} className="text-primary" />}
            {previewing ? 'Syncing...' : 'Preview Report'}
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating || previewing}
            className="flex items-center justify-center gap-2 bg-foreground hover:bg-foreground/90 text-background font-bold py-3 rounded-xl transition-all disabled:opacity-50 text-[10px] uppercase tracking-[0.2em] shadow-lg shadow-black/10"
          >
            {generating ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Download
          </button>
        </div>
      </div>
      {previewUrl && (
        <FilePreviewModal
          attachment={{ filename: `Report_Level_${selectedStage}.pdf` }}
          initialBlobUrl={previewUrl}
          onClose={() => {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
          }}
        />
      )}
    </div>
    {stagePreviewFile && <FilePreviewModal attachment={stagePreviewFile} onClose={() => setStagePreviewFile(null)} />}
    </>
  );
};

// ── Tag Observer Modal ─────────────────────────────────────────────────────────
const TagModal = ({ reqId, departments, onClose, onTagged }) => {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [existing, setExisting] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    reqAPI.getRequisitionTags(reqId).then(tags => {
      setExisting(tags.map(t => t.deptId));
    }).catch(() => {});
  }, [reqId]);

  const filtered = departments.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) &&
    !existing.includes(d.id)
  );

  const toggle = (id) => setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const handleSubmit = async () => {
    if (!selected.length) return;
    setSubmitting(true);
    try {
      await reqAPI.tagRequisitionDepts(reqId, selected);
      toast.success(`${selected.length} department(s) tagged as observers.`);
      onTagged?.();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not tag departments.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
        <div className="p-5 border-b border-border/50 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-0.5">CC / Tag Observer</p>
            <h3 className="text-lg font-black text-foreground">Select Departments</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Tagged departments can view and print this requisition as read-only observers.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-muted transition-all"><X size={18} /></button>
        </div>
        <div className="p-4 border-b border-border/30">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search departments..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-border/50 text-sm bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {existing.length > 0 && (
            <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-2">
              Already Tagged ({existing.length}): {departments.filter(d => existing.includes(d.id)).map(d => d.name).join(', ')}
            </p>
          )}
          {filtered.length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-4">No departments found.</p>
          )}
          {filtered.map(d => (
            <label key={d.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${selected.includes(d.id) ? 'border-primary bg-primary/5' : 'border-border/40 hover:border-primary/30 hover:bg-muted/20'}`}>
              <input
                type="checkbox"
                checked={selected.includes(d.id)}
                onChange={() => toggle(d.id)}
                className="text-primary w-4 h-4 rounded"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground truncate">{d.name}</p>
                {d.type && <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{d.type}</p>}
              </div>
            </label>
          ))}
        </div>
        <div className="p-4 border-t border-border/30 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{selected.length} selected</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border/50 text-sm font-bold hover:bg-muted transition-all">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={!selected.length || submitting}
              className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-40 flex items-center gap-2"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
              Tag & Notify
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Creator Clarification Panel (shown when requisition is returned to creator) ──
const CreatorCommentPanel = ({ req, departments, onDone }) => {
  const [comment, setComment] = useState('');
  const [acting, setActing]   = useState(false);

  // All departments that can receive a re-forward (exclude self, Chairman, GM — keep HR and peers)
  const forwardableDepts = departments.filter(d =>
    d.id !== req.departmentId &&
    !/ceo|chairman|general\s*manager|\bgm\b/i.test(d.name)
  );

  // Auto-select the single option, or default to HR if present
  const defaultTarget = forwardableDepts.length === 1
    ? forwardableDepts[0]
    : forwardableDepts.find(d => /\bhr\b|human\s*resource/i.test(d.name));

  const [targetId, setTargetId] = useState(defaultTarget ? String(defaultTarget.id) : '');

  const handleSubmit = async () => {
    if (!comment.trim()) { toast.error('Please enter a clarification comment before re-forwarding.'); return; }
    if (!targetId) { toast.error('Please select the department to forward to.'); return; }
    setActing(true);
    try {
      // Single forward call — the note carries the clarification; no redundant creator-comment trip
      await forwardAPI.forward(req.id, {
        targetDepartmentId: parseInt(targetId),
        note: comment,
        returnToSender: false
      });
      toast.success('Clarification submitted and requisition re-forwarded.');
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || `Re-forward failed (${err?.response?.status ?? 'network'}).`);
    } finally { setActing(false); }
  };

  return (
    <div className="space-y-3 border border-amber-200 rounded-2xl p-4 bg-amber-50/60 shadow-sm relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
      <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest pl-1">Add Clarification &amp; Re-forward</p>
      <p className="text-xs text-amber-700 pl-1">Your requisition fields are locked. Add a clarification note and re-forward for processing.</p>
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Enter your clarification or response to the return reason..."
        className="w-full bg-white border border-amber-200 rounded-xl p-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-300 min-h-[80px] resize-none shadow-inner"
      />
      <div className="space-y-1.5">
        <label className="text-[10px] font-black text-amber-800 uppercase tracking-widest">Forward to</label>
        <select
          value={targetId}
          onChange={e => setTargetId(e.target.value)}
          className="w-full bg-white border border-amber-200 rounded-xl p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-300 appearance-none shadow-sm"
        >
          {!targetId && <option value="">— Select department —</option>}
          {forwardableDepts.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      <button
        onClick={handleSubmit}
        disabled={!comment.trim() || !targetId || acting}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm transition-all disabled:opacity-50 shadow-md"
      >
        {acting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        Submit Clarification &amp; Re-forward
      </button>
    </div>
  );
};

// ── Respond Panel (for target dept to forward or return) ──────────────────
const RespondPanel = ({ req, detail, departments, onDone }) => {
  const [mode, setMode]         = useState(null); // 'forward' | null
  const [fwdListOpen, setFwdListOpen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [note, setNote]         = useState('');
  const [acting, setActing]     = useState(false);
  const [refining, setRefining] = useState(false);
  const [kivActing, setKivActing] = useState(false);
  const [showKivForm, setShowKivForm] = useState(false);
  const [kivInput, setKivInput] = useState('');

  const { user: currentUser } = useAuth();
  const { aiEnabled } = useAIFeatures();

  // ── Forward target resolution ────────────────────────────────────────────────
  // Work out who "Return to Sender" will actually send to by reading the
  // forwardEvents chain — it's whoever LAST sent the document to the current holder,
  // NOT necessarily the original creator. This prevents ISAC → ISAC loops.
  const forwardEvents = detail?.forwardEvents || [];
  const currentDeptId = detail?.targetDepartmentId;
  const lastInbound = [...forwardEvents]
    .reverse()
    .find(e => e.toDeptId === currentDeptId && e.fromDeptId !== currentDeptId);
  const returnTarget = lastInbound
    ? departments.find(d => d.id === lastInbound.fromDeptId)
    : departments.find(d => d.id === req.departmentId);
  const returnLabel = returnTarget ? `Return to ${returnTarget.name}` : 'Return to Sender';

  // Forward is open to ALL departments except:
  //   1. The current holder (you can't forward to yourself)
  //   2. The immediate sender (Return already handles going back to them)
  // Role-based restrictions only apply at creation time, not during forwarding.
  const forwardDepts = departments.filter(d => {
    if (d.id === detail?.targetDepartmentId) return false; // current holder
    if (lastInbound && d.id === lastInbound.fromDeptId) return false; // immediate sender (use Return)
    return true;
  });
  const selectedForwardDept = forwardDepts.find(d => String(d.id) === String(targetId));
  const openForwardSelector = () => { setMode('forward'); setFwdListOpen(true); };

  const handleRefineNote = async () => {
    if (note.trim().length < 5) return;
    setRefining(true);
    try {
      const res = await aiAPI.refineDraft(note, 'review');
      if (res.blocked) {
        toast.error(res.validationMessage || 'Your note was not recognised as a valid response. Please write a clear, professional review.', { duration: 6000 });
        return;
      }
      setNote(res.refinedDescription || note);
      toast.success(res.actionReason ? `AI refined — ${res.actionReason}` : 'Note professionally refined by AI.', { duration: 5000 });
    } catch (err) {
      const msg = err?.response?.data?.validationMessage || err?.response?.data?.error || 'AI refinement failed. Please try again.';
      toast.error(msg, { duration: 5000 });
    } finally { setRefining(false); }
  };

  const submit = async (actionMode) => {
    if (actionMode === 'forward' && !targetId) {
      setMode('forward'); // Open forward selector
      return;
    }
    if (actionMode === 'return' && !note.trim()) {
      toast.error('Please add a review or note explaining why you are returning this.');
      return;
    }
    
    setActing(true);
    try {
      const result = await forwardRequisition(req.id, {
        targetDepartmentId: actionMode === 'forward' ? parseInt(targetId) : null,
        note,
        returnToSender: actionMode === 'return'
      });
      if (result !== null) {
        toast.success(actionMode === 'return' ? `Requisition returned to ${returnTarget?.name || 'sender'}.` : 'Requisition forwarded successfully.');
      }
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'This action could not be completed. Please try again.');
    } finally { setActing(false); }
  };

  const handleKiv = async () => {
    if (!kivInput.trim()) { toast.error('Please state a reason for placing this request on hold.'); return; }
    setKivActing(true);
    try {
      await kivRequisition(req.id, kivInput.trim());
      toast.success('Request placed on hold (KIV).');
      setShowKivForm(false);
      setKivInput('');
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not place on hold.');
    } finally { setKivActing(false); }
  };

  const handleUnKiv = async () => {
    setKivActing(true);
    try {
      await unKivRequisition(req.id);
      toast.success('Hold removed — request is active again.');
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not remove hold.');
    } finally { setKivActing(false); }
  };

  return (
    <div className="space-y-3 border border-border/50 rounded-2xl p-4 bg-white/60 shadow-sm relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-primary/30" />
      <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest pl-1">
        Add Review / Comment
      </p>
      
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Enter your official response, review, or note here (required for returning)..."
        disabled={refining}
        className="w-full bg-white border border-border rounded-xl p-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[80px] resize-none shadow-inner disabled:opacity-60"
      />
      {aiEnabled && (
        <div className="flex items-center justify-between pb-1 pt-1 border-b border-border/40">
          <VoiceDictation
            disabled={refining}
            onTranscript={(text) => setNote(prev => prev + (prev ? ' ' : '') + text)}
          />
          {note.trim().length >= 5 && (
            <button
              type="button"
              onClick={handleRefineNote}
              disabled={refining}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
            >
              {refining ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />}
              {refining ? 'Refining…' : 'AI Refine'}
            </button>
          )}
        </div>
      )}

      {mode === 'forward' && (
        <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl space-y-2 animate-in fade-in slide-in-from-top-2">
          <label className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center justify-between">
            <span>Select Target Department</span>
            <button onClick={() => setMode(null)} className="text-muted-foreground hover:text-foreground px-2 py-0.5 rounded hover:bg-black/5">Cancel</button>
          </label>
          <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setFwdListOpen(o => !o)}
              className="w-full flex items-center justify-between gap-3 px-3 py-3 text-left text-sm font-bold text-foreground bg-white"
            >
              <span className={selectedForwardDept ? 'text-foreground' : 'text-muted-foreground'}>
                {selectedForwardDept?.name || 'Choose department to forward to'}
              </span>
              {fwdListOpen ? <ChevronDown size={16} className="text-primary shrink-0 rotate-180 transition-transform" /> : <ChevronDown size={16} className="text-primary shrink-0 transition-transform" />}
            </button>
            {fwdListOpen && (
              <div className="max-h-64 overflow-y-auto custom-scrollbar border-t border-border/60 bg-white animate-in fade-in slide-in-from-top-1 duration-150">
                {forwardDepts.length === 0 ? (
                  <div className="px-3 py-4 text-xs font-bold text-muted-foreground text-center">
                    No departments available for forwarding.
                  </div>
                ) : (
                  forwardDepts.map(d => {
                    const active = String(d.id) === String(targetId);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => { setTargetId(String(d.id)); setFwdListOpen(false); }}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-bold transition-colors ${
                          active ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-primary/5'
                        }`}
                      >
                        <span>{d.name}</span>
                        {active ? <CheckCircle2 size={15} className="text-primary shrink-0" /> : <ChevronRight size={15} className="text-muted-foreground/40 shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
          <select
            hidden
            aria-hidden="true"
            value={targetId}
            onChange={e => setTargetId(e.target.value)}
            className="w-full bg-white border border-border rounded-xl p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none shadow-sm"
          >
            <option value="">— Select department to forward to —</option>
            {forwardDepts.map(d => (
             <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <button
            onClick={() => submit('forward')}
            disabled={!targetId || acting}
            className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3 rounded-xl transition-all disabled:opacity-50 text-sm shadow-md"
          >
            {acting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Confirm Forward
          </button>
        </div>
      )}

      {mode !== 'forward' && (
        <div className={`grid gap-2 pt-1 ${detail?.finalApprovalStatus && detail.finalApprovalStatus !== 'none' ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <button
            onClick={openForwardSelector}
            className="flex flex-col items-center justify-center gap-1 p-3 rounded-xl border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary font-bold text-sm transition-all shadow-sm"
          >
            <div className="flex items-center gap-1">
              <ArrowRightCircle size={18} />
              <ChevronDown size={15} />
            </div>
            <span>Forward...</span>
          </button>

          {/* Return button disappears after final approval */}
          {(!detail?.finalApprovalStatus || detail.finalApprovalStatus === 'none') && (
            <button
              onClick={() => submit('return')}
              disabled={acting}
              className="flex flex-col items-center justify-center gap-1 p-3 rounded-xl border-2 border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold text-sm transition-all disabled:opacity-50 shadow-sm"
            >
              {acting ? <Loader2 size={18} className="animate-spin" /> : <CornerDownLeft size={18} />}
              <span>{returnLabel}</span>
            </button>
          )}
        </div>
      )}
      {!showKivForm ? (
        <button onClick={() => setShowKivForm(true)} disabled={kivActing}
          className="w-full flex items-center justify-center gap-1.5 mt-1 py-2 rounded-xl border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 text-[10px] font-black transition-all disabled:opacity-50">
          {kivActing ? <Loader2 size={12} className="animate-spin" /> : <BookMarked size={12} />}
          Hold (KIV)
        </button>
      ) : (
        <div className="mt-1 space-y-2 p-3 rounded-xl bg-violet-50 border border-violet-200 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <p className="text-[10px] font-black text-violet-800 uppercase tracking-wide flex items-center gap-1.5">
            <BookMarked size={10} /> Hold Reason <span className="text-rose-600">*</span>
          </p>
          <textarea
            value={kivInput}
            onChange={e => setKivInput(e.target.value)}
            rows={2}
            placeholder="State the reason for placing this request on hold (required)…"
            className="w-full text-xs border border-violet-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none bg-white"
          />
          <div className="flex gap-2">
            <button onClick={handleKiv} disabled={kivActing || !kivInput.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold transition-all disabled:opacity-50">
              {kivActing ? <Loader2 size={12} className="animate-spin" /> : <BookMarked size={12} />}
              {kivActing ? 'Placing hold…' : 'Confirm Hold'}
            </button>
            <button onClick={() => { setShowKivForm(false); setKivInput(''); }}
              className="px-3 py-2 rounded-xl border border-violet-200 text-violet-700 text-xs font-bold hover:bg-violet-100 transition-all">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Final Approve Panel ───────────────────────────────────────────────────────
const DEFAULT_THRESHOLDS = { hr_ceiling: 50000, chairman_min: 100000 };

const FinalApprovePanel = ({ req, detail, user, departments, onApproved, onApproveCheck, onAuditGate }) => {
  const [note, setNote]               = useState('');
  const [acting, setActing]           = useState(false);
  const [treating, setTreating]       = useState(false);
  const [showModal, setShowModal]     = useState(false);
  const [thresholds, setThresholds]   = useState(DEFAULT_THRESHOLDS);
  const [approveChecked, setApproveChecked] = useState(false);
  const [approveFile, setApproveFile] = useState(null);
  const [vetDeptId, setVetDeptId]     = useState('');
  const [kivActing, setKivActing]     = useState(false);
  const [showKivFormFA, setShowKivFormFA] = useState(false);
  const [kivInputFA, setKivInputFA]       = useState('');
  const fileRef = React.useRef(null);

  useEffect(() => {
    settingsAPI.get('approval_thresholds').then(res => {
      if (res?.value) {
        try { setThresholds({ ...DEFAULT_THRESHOLDS, ...JSON.parse(res.value) }); } catch {}
      }
    }).catch(() => {});
  }, []);

  const deptName = user?.name || '';
  // Effective amount — ICC override takes priority over Audit override (ICC acts post-approval)
  const effectiveAmount = (detail?.hasIccOverride && detail?.iccOverrideAmount != null)
    ? parseFloat(detail.iccOverrideAmount)
    : (detail?.hasAuditOverride && detail?.auditAmount != null)
    ? parseFloat(detail.auditAmount)
    : parseFloat(req.amount || 0);
  const amount = effectiveAmount;

  // For privileged sub-accounts use parent dept name for authority checks
  // approvalLimit (separate from privilegeAmount) controls what amount they can APPROVE
  const approvalLimit = user?.approvalLimit != null ? parseFloat(user.approvalLimit) : null;
  const isPrivSub = user?.isSubAccount && user?.parentDeptId && approvalLimit != null;
  const parentDept = isPrivSub ? departments.find(d => d.id === parseInt(user.parentDeptId)) : null;
  const checkDeptName = (isPrivSub && parentDept) ? parentDept.name : deptName;

  const isChairman = /ceo|chairman/i.test(checkDeptName);
  const isGM       = /general\s*manager|\bgm\b/i.test(checkDeptName);
  const isHR       = /\bhr\b|human\s*resource/i.test(checkDeptName);

  if (/^memo/i.test(req.type || '')) return null;

  // isAtMyDesk: request is at my dept, OR I'm a privileged sub-account of the dept holding it
  const parentDeptId = user?.parentDeptId ? parseInt(user.parentDeptId) : null;
  const isMaterial = /^material/i.test(req.type || '');
  const isCash = !isMaterial && !/^memo/i.test(req.type || '');
  // Approval authority check uses approvalLimit (not privilegeAmount which governs creation)
  const subHasTypePriv = isMaterial
    ? !!(user?.materialPrivilege)
    : (isCash ? (approvalLimit != null && effectiveAmount <= approvalLimit) : false);

  const isAtMyDesk = detail?.targetDepartmentId === user?.deptId
    || (isPrivSub && parentDeptId && detail?.targetDepartmentId === parentDeptId && subHasTypePriv);
  if (!isAtMyDesk) return null;

  const { hr_ceiling, chairman_min } = thresholds;
  const fmt = (n) => `₦${Number(n).toLocaleString()}`;
  // isMaterial already declared above

  // Hierarchical authority: Chairman > GM > HR
  // Chairman approves any amount; GM covers HR + GM bands; HR covers HR band only
  let authorityLabel = null;
  if (isMaterial) {
    if (isChairman)      authorityLabel = 'Chairman / CEO Authority';
    else if (isGM)       authorityLabel = 'GM Authority';
    else if (isHR)       authorityLabel = 'HR Authority';
  } else {
    if (isChairman)
      authorityLabel = `Chairman / CEO (All Amounts)`;
    else if (isGM && amount < chairman_min)
      authorityLabel = `GM Authority (< ${fmt(chairman_min)})`;
    else if (isHR && amount <= hr_ceiling)
      authorityLabel = `HR Authority (≤ ${fmt(hr_ceiling)})`;
  }

  if (!authorityLabel) return null;

  const finalStatus = detail?.finalApprovalStatus;

  const handleKiv = async () => {
    if (!kivInputFA.trim()) { toast.error('Please state a reason for placing this request on hold.'); return; }
    setKivActing(true);
    try {
      await kivRequisition(req.id, kivInputFA.trim());
      toast.success('Request placed on hold (KIV).');
      setShowKivFormFA(false);
      setKivInputFA('');
      onApproved();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not place on hold.');
    } finally { setKivActing(false); }
  };

  const handleUnKiv = async () => {
    setKivActing(true);
    try {
      await unKivRequisition(req.id);
      toast.success('Hold removed — request is active again.');
      onApproved();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not remove hold.');
    } finally { setKivActing(false); }
  };

  const handleSelfTreat = async () => {
    setTreating(true);
    try {
      const result = await vettingActionRequisition(req.id, { action: 'treated' });
      if (result !== null) toast.success('Requisition marked as treated!');
      onApproved();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not mark as treated.');
    } finally { setTreating(false); }
  };

  // ── Already approved: show signed badge + Send to Vet (+ Chairman self-treat) ─
  if (finalStatus && finalStatus !== 'none') {
    const returnEvt  = detail?.vettingEvents?.slice().reverse().find(e => e.action === 'return');
    const isVettingReturned = finalStatus === 'approved'
      && !detail?.currentVettingDeptId
      && !!returnEvt;
    const returnWasVetted = !!returnEvt?.vetted;

    return (
      <>
        <div className={`space-y-3 border rounded-2xl p-4 shadow-sm relative overflow-hidden ${isVettingReturned ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/60'}`}>
          <div className={`absolute top-0 left-0 w-1 h-full ${isVettingReturned ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          <div className="flex items-center gap-2 pl-1 flex-wrap">
            {isVettingReturned
              ? <RotateCcw size={14} className="text-amber-600" />
              : <CheckCircle2 size={14} className="text-emerald-600" />}
            <p className={`text-[10px] font-black uppercase tracking-widest ${isVettingReturned ? 'text-amber-800' : 'text-emerald-800'}`}>
              {isVettingReturned ? 'Returned from Vetting' : 'Signed & Approved'}
            </p>
            <span className={`ml-auto px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${isVettingReturned ? 'bg-amber-100 border border-amber-300 text-amber-700' : 'bg-emerald-100 border border-emerald-300 text-emerald-700'}`}>{authorityLabel}</span>
            {/* Vetted status pill — shown to GM/recipient when vetting dept returns the doc */}
            {isVettingReturned && (
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${returnWasVetted ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-600'}`}>
                {returnWasVetted ? '✓ Vetted' : '✗ Not Vetted'}
              </span>
            )}
          </div>
          <p className={`text-[11px] leading-relaxed pl-1 ${isVettingReturned ? 'text-amber-700/80' : 'text-emerald-700/80'}`}>
            {isVettingReturned
              ? `Vetting returned this document${returnWasVetted ? ' (document was vetted)' : ' (document was not vetted)'}. Use the action panel below to forward it for treatment.`
              : 'Your approval has been recorded and the document is on its way to vetting.'}
          </p>
          {isChairman && finalStatus === 'approved' && (
            <button
              onClick={handleSelfTreat}
              disabled={treating}
              className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-xl transition-all disabled:opacity-50 text-sm shadow-md shadow-purple-500/20 w-full"
            >
              {treating ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              Mark Treated
            </button>
          )}
        </div>
      </>
    );
  }

  // ── Post-approval destination: Account only (ICC removed, Audit is pre-approval reviewer) ──
  const vettingDepts = departments.filter(d => /\baccount\b/i.test(d.name || ''));

  // ── Audit must review and return before approval is unlocked (all request types) ──
  const auditDeptForGate = departments.find(d => /\baudit\b/i.test(d.name));
  const auditHasReturned = !!auditDeptForGate && (
    (detail?.forwardEvents || []).some(e => e.action === 'returned' && e.fromDeptId === auditDeptForGate.id) ||
    !!detail?.hasAuditOverride  // Audit saved a price override = they reviewed the request
  );
  const needsAuditPreReview = !auditHasReturned;

  // ── Not yet approved: checkbox-driven sign + vetting in one action ───────────
  const handleApprove = async () => {
    if (!isMaterial && !vetDeptId) { toast.error('Please select a vetting department before approving.'); return; }
    setActing(true);
    try {
      const approveResult = await finalApproveRequisition(req.id, note);

      // Upload approval attachment to enclosures if provided
      if (approveFile && req.id) {
        try {
          await uploadAttachments(req.id, [approveFile], {
            uploaderDept: user?.name,
            stageName: 'Final Approval',
          });
        } catch {
          toast('Approved but attachment failed to upload — you can attach it from the document later.', { icon: '📎' });
        }
      }

      if (isMaterial) {
        // Material requests go directly to target dept — no vetting chain needed
        if (approveResult === null) toast('Approval queued — will process when reconnected.');
        else toast.success('Approved — target department can now issue the items.');
      } else if (approveResult === null) {
        await sendToVettingRequisition(req.id, parseInt(vetDeptId));
        toast('Approval & vetting queued — will process when reconnected.');
      } else {
        await sendToVettingRequisition(req.id, parseInt(vetDeptId));
        toast.success('Approved, signed & sent to vetting in one step.');
      }
      onApproved();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Approval failed. Please try again.');
    } finally { setActing(false); }
  };

  // ── Audit pre-review gate — signal parent to show top banner, render only KIV here ──
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (onAuditGate) onAuditGate(needsAuditPreReview ? { authorityLabel } : null);
    return () => { if (onAuditGate) onAuditGate(null); };
  // authorityLabel is a string derived from amount/thresholds; safe to include
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAuditPreReview, authorityLabel]);

  if (needsAuditPreReview) {
    return (
      <div className="space-y-2">
        {!showKivFormFA ? (
          <button onClick={() => setShowKivFormFA(true)} disabled={kivActing}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 text-[10px] font-black transition-all disabled:opacity-50">
            {kivActing ? <Loader2 size={12} className="animate-spin" /> : <BookMarked size={12} />}
            Hold (KIV)
          </button>
        ) : (
          <div className="space-y-2 p-3 rounded-xl bg-violet-50 border border-violet-200 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <p className="text-[10px] font-black text-violet-800 uppercase tracking-wide flex items-center gap-1.5">
              <BookMarked size={10} /> Hold Reason <span className="text-rose-600">*</span>
            </p>
            <textarea value={kivInputFA} onChange={e => setKivInputFA(e.target.value)} rows={2}
              placeholder="State the reason for placing this request on hold (required)…"
              className="w-full text-xs border border-violet-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none bg-white"
            />
            <div className="flex gap-2">
              <button onClick={handleKiv} disabled={kivActing || !kivInputFA.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold transition-all disabled:opacity-50">
                {kivActing ? <Loader2 size={12} className="animate-spin" /> : <BookMarked size={12} />}
                {kivActing ? 'Placing hold…' : 'Confirm Hold'}
              </button>
              <button onClick={() => { setShowKivFormFA(false); setKivInputFA(''); }}
                className="px-3 py-2 rounded-xl border border-violet-200 text-violet-700 text-xs font-bold hover:bg-violet-100 transition-all">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 border border-emerald-200 rounded-2xl p-4 bg-emerald-50/60 shadow-sm relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
      <div className="flex items-center gap-2 pl-1">
        <Gavel size={14} className="text-emerald-700" />
        <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">Final Approval</p>
        <span className="ml-auto px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-[9px] font-black text-emerald-700 uppercase">{authorityLabel}</span>
      </div>

      {auditHasReturned && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-50 border border-teal-200 text-[11px] text-teal-700 font-semibold">
          <CheckCircle2 size={12} className="text-teal-600 shrink-0" />
          Audit review complete — you may now approve this request.
        </div>
      )}

      {/* Approve & Sign checkbox */}
      <label className="flex items-center gap-3 p-3 rounded-xl border-2 border-emerald-300 bg-white cursor-pointer hover:bg-emerald-50 transition-colors select-none">
        <input
          type="checkbox"
          checked={approveChecked}
          onChange={e => { setApproveChecked(e.target.checked); onApproveCheck?.(e.target.checked); }}
          className="w-4 h-4 accent-emerald-600 cursor-pointer"
        />
        <div>
          <p className="text-sm font-black text-emerald-800">Approve &amp; Sign</p>
          <p className="text-[10px] text-emerald-600/80">Check to confirm your final approval of this requisition</p>
        </div>
      </label>

      {/* Expanded form — only visible when checked */}
      {approveChecked && (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional remarks or approval note…"
            className="w-full bg-white border border-emerald-200 rounded-xl p-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-300 min-h-[60px] resize-none shadow-inner"
          />

          {/* Cash: select Account for treatment. Material: target dept acts directly */}
          {isMaterial ? (
            <p className="text-[11px] font-semibold px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
              After approval, the target department will be able to issue the items directly — no vetting step required.
            </p>
          ) : (
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest pl-1">
                Send to Account for Treatment — Required *
              </label>
              <select
                value={vetDeptId}
                onChange={e => setVetDeptId(e.target.value)}
                className="w-full bg-white border border-emerald-300 rounded-xl p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-300 appearance-none shadow-sm"
              >
                <option value="">— Select Account department —</option>
                {vettingDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                {vettingDepts.length === 0 && <option disabled>No Account department found</option>}
              </select>
              <p className="text-[11px] font-semibold px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                After approval, the request goes directly to Account for payment treatment.
              </p>
            </div>
          )}

          {/* Optional file attachment */}
          <div>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={e => setApproveFile(e.target.files?.[0] || null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-200 bg-white hover:bg-emerald-50 text-emerald-700 text-xs font-bold transition-colors"
            >
              <Paperclip size={13} />
              {approveFile ? approveFile.name : 'Attach supporting document (optional)'}
            </button>
            {approveFile && (
              <button
                type="button"
                onClick={() => setApproveFile(null)}
                className="mt-1 ml-1 text-[10px] text-rose-500 hover:underline"
              >
                Remove
              </button>
            )}
          </div>

          <button
            onClick={handleApprove}
            disabled={acting || !vetDeptId}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all disabled:opacity-50 text-sm shadow-md shadow-emerald-500/20"
          >
            {acting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {acting ? 'Processing…' : 'Final Approve & Send to Account'}
          </button>
        </div>
      )}
      {(detail?.isKIV ?? req.isKIV) ? (
        <div className="flex items-center gap-2 mt-1 px-3 py-2 rounded-xl bg-violet-50 border border-violet-200">
          <BookMarked size={13} className="text-violet-600 shrink-0" />
          <span className="flex-1 text-[11px] font-bold text-violet-700">
            On Hold (KIV){(detail?.kivNote || req.kivNote) ? ` — ${detail?.kivNote || req.kivNote}` : ''}
          </span>
          <button onClick={handleUnKiv} disabled={kivActing}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-black transition-all disabled:opacity-50">
            {kivActing ? <Loader2 size={10} className="animate-spin" /> : <BookMarked size={10} />}
            Resume
          </button>
        </div>
      ) : (
        <button onClick={handleKiv} disabled={kivActing}
          className="w-full flex items-center justify-center gap-1.5 mt-1 py-2 rounded-xl border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 text-[10px] font-black transition-all disabled:opacity-50">
          {kivActing ? <Loader2 size={12} className="animate-spin" /> : <BookMarked size={12} />}
          Hold (KIV)
        </button>
      )}
    </div>
  );
};

// ── Vetting Selection Modal ────────────────────────────────────────────────────
const VettingSelectionModal = ({ reqId, user, departments, onClose, onDone }) => {
  const [selectedId, setSelectedId] = useState('');
  const [acting, setActing]         = useState(false);

  const isGMOrAbove = /general\s*manager|\bgm\b|ceo|chairman/i.test(user?.department || '');

  const vettingDepts = departments.filter(d => /\baccount\b/i.test(d.name || ''));

  const selectedDept    = vettingDepts.find(d => String(d.id) === String(selectedId));
  const isAccountDirect = selectedDept && /\baccount\b/i.test(selectedDept.name);
  const isAuditDirect   = false; // Audit no longer in post-approval vetting
  const pathHint = !selectedId ? null
    : isAccountDirect
      ? 'Direct to Account — no further forwarding needed'
      : isAuditDirect
        ? 'ICC skipped — flow will be: Audit → Account'
        : 'Full chain — flow will be: ICC → Audit → Account'; // ICC = Internal Control & Compliance

  const handleSend = async () => {
    if (!selectedId) { toast.error('Please select a department.'); return; }
    setActing(true);
    try {
      const result = await sendToVettingRequisition(reqId, parseInt(selectedId));
      if (result !== null) toast.success('Requisition sent to vetting!');
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to send to vetting.');
    } finally { setActing(false); }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5 animate-in fade-in zoom-in-95 duration-300">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center">
            <Award size={20} className="text-emerald-600" />
          </div>
          <div>
            <h3 className="text-base font-black text-foreground">Send to Vetting</h3>
            <p className="text-xs text-muted-foreground">{isGMOrAbove ? 'Choose start point — or route directly to Account' : 'Choose where vetting starts (ICC or Audit directly)'}</p>
          </div>
          <button onClick={onClose} className="ml-auto p-2 rounded-xl hover:bg-muted transition-colors">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
            First Vetting Department
          </label>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="w-full bg-white border border-border rounded-xl p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none shadow-sm"
          >
            <option value="">— Select department —</option>
            {vettingDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            {vettingDepts.length === 0 && <option disabled>No vetting departments found</option>}
          </select>
          {pathHint && (
            <p className={`text-[11px] font-semibold px-3 py-2 rounded-lg ${
              isAccountDirect ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : isAuditDirect ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}>
              {pathHint}
            </p>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted transition-all">
            Skip for Now
          </button>
          <button
            onClick={handleSend}
            disabled={!selectedId || acting}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-all disabled:opacity-50 shadow-md shadow-emerald-500/20"
          >
            {acting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            Send to Vetting
          </button>
        </div>
      </div>
    </div>
  );
};

// ── ICC Observer Panel ────────────────────────────────────────────────────────
// Shown to ICC on every request EXCEPT ones ICC itself created.
// Allows: leave a comment (non-blocking) OR freeze the request (blocks all actions).
const IccObserverPanel = ({ req, detail, onDone, expanded = true, onToggleExpand = null }) => {
  const [comment, setComment] = useState('');
  const [freezeNote, setFreezeNote] = useState('');
  const [showFreezeForm, setShowFreezeForm] = useState(false);
  const [posting, setPosting] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [unfreezing, setUnfreezing] = useState(false);
  const [kivActing, setKivActing] = useState(false);

  const frozen = !!detail?.iccFrozen;
  const onKiv = !!(detail?.isKIV ?? req?.isKIV);

  const handleComment = async () => {
    if (!comment.trim()) { toast.error('Please enter a comment.'); return; }
    setPosting(true);
    try {
      await iccComment(req.id, comment.trim());
      toast.success('ICC comment posted — visible to all involved parties.');
      setComment('');
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not post comment.');
    } finally { setPosting(false); }
  };

  const handleFreeze = async () => {
    if (!freezeNote.trim()) { toast.error('A reason is required to freeze this request.'); return; }
    setFreezing(true);
    try {
      await iccFreeze(req.id, freezeNote.trim());
      toast.success('Request frozen. All actions are now blocked until ICC lifts the freeze.');
      setFreezeNote('');
      setShowFreezeForm(false);
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not freeze request.');
    } finally { setFreezing(false); }
  };

  const handleUnfreeze = async () => {
    setUnfreezing(true);
    try {
      await iccUnfreeze(req.id);
      toast.success('Freeze lifted. Processing may resume.');
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not unfreeze request.');
    } finally { setUnfreezing(false); }
  };

  return (
    <div className={`animate-in fade-in slide-in-from-bottom-5 duration-500 border rounded-2xl shadow-sm relative overflow-hidden ${frozen ? 'border-red-300 bg-red-50/50' : 'border-indigo-200 bg-indigo-50/40'}`}>
      <div className={`absolute top-0 left-0 w-1 h-full ${frozen ? 'bg-red-500' : 'bg-indigo-500'}`} />
      <div className="p-4 pl-5">
        {/* Header */}
        <div
          className={`flex items-center justify-between mb-3 ${onToggleExpand ? 'cursor-pointer' : ''}`}
          onClick={onToggleExpand || undefined}
        >
          <div className="flex items-center gap-2">
            <ShieldAlert size={14} className={frozen ? 'text-red-700' : 'text-indigo-700'} />
            <p className={`text-[10px] font-black uppercase tracking-widest ${frozen ? 'text-red-800' : 'text-indigo-800'}`}>
              ICC — FREEZE CONTROL
            </p>
            {frozen && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-red-100 border border-red-300 text-red-700 uppercase flex items-center gap-1">
                <Lock size={9}/> Frozen
              </span>
            )}
          </div>
          {onToggleExpand && (
            expanded ? <ChevronUp size={14} className={frozen ? 'text-red-700' : 'text-indigo-700'} /> : <ChevronDown size={14} className={frozen ? 'text-red-700' : 'text-indigo-700'} />
          )}
        </div>

        {expanded && (
        <>
        {/* Unfreeze section (shown when frozen) */}
        {frozen && (
          <div className="mb-4 p-3 rounded-xl bg-red-100/70 border border-red-200 space-y-2">
            <p className="text-xs font-black text-red-800 uppercase tracking-wide flex items-center gap-1.5">
              <Lock size={11}/> This request is currently frozen
            </p>
            {detail?.iccFreezeNote && (
              <p className="text-xs text-red-700/90 leading-relaxed">
                <span className="font-bold">Reason:</span> {detail.iccFreezeNote}
              </p>
            )}
            {detail?.iccFreezeBy && (
              <p className="text-[10px] text-red-600/70">Frozen by: {detail.iccFreezeBy}</p>
            )}
            <button
              onClick={handleUnfreeze}
              disabled={unfreezing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all disabled:opacity-50 shadow-sm"
            >
              {unfreezing ? <Loader2 size={12} className="animate-spin"/> : <Unlock size={12}/>}
              {unfreezing ? 'Lifting freeze…' : 'Lift Freeze — Resume Processing'}
            </button>
          </div>
        )}

        {/* Comment box */}
        <div className="space-y-2 mb-3">
          <label className={`text-[10px] font-black uppercase tracking-widest ${frozen ? 'text-red-700' : 'text-indigo-700'}`}>
            <MessageCircle size={10} className="inline mr-1"/>
            Post ICC Comment
          </label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={3}
            placeholder="Add an observation or note visible to all involved parties — does not affect request processing…"
            className="w-full text-xs border border-border/50 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
          />
          <button
            onClick={handleComment}
            disabled={posting || !comment.trim()}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-white text-xs font-bold transition-all disabled:opacity-50 shadow-sm ${frozen ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
          >
            {posting ? <Loader2 size={12} className="animate-spin"/> : <MessageCircle size={12}/>}
            {posting ? 'Posting…' : 'Post Comment Only (no freeze)'}
          </button>
        </div>

        <div className="w-full h-px bg-border/30 mb-3"/>

        {/* Freeze section */}
        {!frozen && (
          <div className="space-y-2">
            {!showFreezeForm ? (
              <button
                onClick={() => setShowFreezeForm(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold hover:bg-red-100 transition-all w-full justify-center"
              >
                <Lock size={12}/> Freeze This Request
              </button>
            ) : (
              <div className="space-y-2 p-3 rounded-xl bg-red-50 border border-red-200">
                <p className="text-[10px] font-black text-red-800 uppercase tracking-wide flex items-center gap-1.5">
                  <Lock size={10}/> Freeze Request — Mandatory Reason
                </p>
                <p className="text-[11px] text-red-700/80 leading-relaxed">
                  This will block ALL actions on this request by every department until ICC (Internal Control & Compliance) lifts the freeze. All involved parties will see your reason.
                </p>
                <textarea
                  value={freezeNote}
                  onChange={e => setFreezeNote(e.target.value)}
                  rows={3}
                  placeholder="State the reason for freezing this request (required)…"
                  className="w-full text-xs border border-red-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-red-400 resize-none bg-white"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleFreeze}
                    disabled={freezing || !freezeNote.trim()}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all disabled:opacity-50 shadow-sm"
                  >
                    {freezing ? <Loader2 size={12} className="animate-spin"/> : <Lock size={12}/>}
                    {freezing ? 'Freezing…' : 'Confirm Freeze'}
                  </button>
                  <button
                    onClick={() => { setShowFreezeForm(false); setFreezeNote(''); }}
                    className="px-4 py-2.5 rounded-xl border border-border text-muted-foreground text-xs font-bold hover:bg-muted transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* KIV section */}
        <div className="w-full h-px bg-border/30 my-3"/>
        {onKiv ? (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-violet-50 border border-violet-200">
            <BookMarked size={12} className="text-violet-600 shrink-0"/>
            <span className="flex-1 text-[11px] font-bold text-violet-700">
              On Hold (KIV — ICC){(detail?.kivNote || req?.kivNote) ? ` — ${detail?.kivNote || req?.kivNote}` : ''}
            </span>
            <button
              onClick={async () => {
                setKivActing(true);
                try { await unKivRequisition(req.id); toast.success('KIV lifted — request can proceed.'); onDone(); }
                catch (err) { toast.error(err?.response?.data?.error || 'Could not lift KIV.'); }
                finally { setKivActing(false); }
              }}
              disabled={kivActing}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-black transition-all disabled:opacity-50"
            >
              {kivActing ? <Loader2 size={10} className="animate-spin"/> : <BookMarked size={10}/>}
              Resume
            </button>
          </div>
        ) : null}
        </>
        )}
      </div>
    </div>
  );
};

// ── Audit Price Override Panel ────────────────────────────────────────────────
// Shown only to the Audit department when they currently hold the request.
// Allows them to build a verified items table that supersedes the creator's price.
const AuditOverridePanel = ({ req, detail, user, departments = [], onDone }) => {
  const _fmt = n => `₦${Number(n || 0).toLocaleString()}`;

  const existingOverride = detail?.hasAuditOverride
    ? (() => { try { return JSON.parse(detail.auditContent); } catch { return null; } })()
    : null;

  const blankRow = () => ({ description: '', qty: 1, amount: '' });

  const initRows = () => {
    if (existingOverride?.items?.length)
      return existingOverride.items.map(i => ({ description: i.description, qty: i.qty, amount: String(i.amount) }));
    try {
      const parsed = JSON.parse(req.content || '{}');
      if (parsed.itemized && Array.isArray(parsed.items) && parsed.items.length > 0)
        return parsed.items.map(i => ({ description: i.description || '', qty: i.qty || 1, amount: String(i.amount || '') }));
    } catch { /* fall through */ }
    return [blankRow()];
  };

  const [rows, setRows]           = useState(initRows);
  const [comment, setComment]     = useState(existingOverride?.comment || '');
  const [routingNote, setRoutingNote] = useState(''); // always-visible note sent with forward/return
  const [clearing, setClearing]   = useState(false);
  const [acting, setActing]       = useState(false);
  const [forwardDeptId, setForwardDeptId] = useState('');
  const [showForm, setShowForm]   = useState(!!detail?.hasAuditOverride);

  // Snapshot at mount for change detection — routing note is never counted as a "table change"
  const originalRows    = React.useRef(initRows());
  const originalComment = React.useRef(existingOverride?.comment || '');

  const calcLineTotal = (row) => (parseFloat(row.qty) || 0) * (parseFloat(row.amount) || 0);
  const grandTotal = rows.reduce((s, r) => s + calcLineTotal(r), 0);

  const updateRow = (idx, field, val) => setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));
  const addRow    = () => setRows(prev => [...prev, blankRow()]);
  const removeRow = (idx) => setRows(prev => prev.filter((_, i) => i !== idx));

  // True only when the table rows differ from creator's original — routing note never triggers this
  const hasChanges = showForm && (
    rows.length !== originalRows.current.length ||
    rows.some((r, i) => {
      const o = originalRows.current[i];
      return !o || r.description !== o.description || String(r.qty) !== String(o.qty) || String(r.amount) !== String(o.amount);
    })
  );

  // Return destination: whoever last forwarded to this dept
  const forwardEvents = detail?.forwardEvents || [];
  const currentDeptId = detail?.targetDepartmentId;
  const lastInbound   = [...forwardEvents].reverse().find(e => e.toDeptId === currentDeptId && e.fromDeptId !== currentDeptId);
  const returnTarget  = lastInbound
    ? departments.find(d => d.id === lastInbound.fromDeptId)
    : departments.find(d => d.id === req.departmentId);

  // Forward targets: exclude self and immediate sender
  const forwardDepts = departments.filter(d => {
    if (d.id === currentDeptId) return false;
    if (lastInbound && d.id === lastInbound.fromDeptId) return false;
    return true;
  });

  const doSaveOverride = async () => {
    const validRows = rows.filter(r => r.description.trim() && parseFloat(r.amount) > 0);
    if (!validRows.length) throw new Error('Add at least one item with a description and price.');
    const items = validRows.map(r => ({
      description: r.description.trim(),
      qty: parseFloat(r.qty) || 1,
      amount: parseFloat(r.amount),
      lineTotal: parseFloat(((parseFloat(r.qty) || 1) * parseFloat(r.amount)).toFixed(2)),
    }));
    await saveAuditOverride(req.id, { items, comment: comment.trim() || undefined });
  };

  const handleForward = async () => {
    if (!forwardDeptId) { toast.error('Please select a department to forward to.'); return; }
    setActing(true);
    try {
      if (hasChanges) await doSaveOverride();
      await forwardRequisition(req.id, { targetDepartmentId: parseInt(forwardDeptId), note: routingNote.trim(), returnToSender: false });
      toast.success(hasChanges ? 'Audit table saved & forwarded.' : 'Forwarded.');
      onDone();
    } catch (err) { toast.error(err?.response?.data?.error || err.message || 'Action failed.'); }
    finally { setActing(false); }
  };

  const handleReturn = async () => {
    setActing(true);
    try {
      if (hasChanges) await doSaveOverride();
      await forwardRequisition(req.id, { targetDepartmentId: null, note: routingNote.trim(), returnToSender: true });
      toast.success(hasChanges ? `Saved & returned to ${returnTarget?.name || 'sender'}.` : `Returned to ${returnTarget?.name || 'sender'}.`);
      onDone();
    } catch (err) { toast.error(err?.response?.data?.error || err.message || 'Action failed.'); }
    finally { setActing(false); }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearAuditOverride(req.id);
      toast.success('Override cleared — original creator amount is now effective.');
      onDone();
    } catch (err) { toast.error(err?.response?.data?.error || 'Could not clear override.'); }
    finally { setClearing(false); }
  };

  const isItemized = (() => { try { return JSON.parse(req.content || '{}')?.itemized; } catch { return false; } })();

  return (
    <div className="animate-in fade-in slide-in-from-bottom-5 duration-500 border border-purple-200 rounded-2xl shadow-sm relative overflow-hidden bg-purple-50/40">
      <div className="absolute top-0 left-0 w-1 h-full bg-purple-500" />
      <div className="p-4 space-y-3">

        {/* Header */}
        <div className="flex items-center justify-between pl-1">
          <div className="flex items-center gap-2">
            <Gavel size={14} className="text-purple-700" />
            <p className="text-[10px] font-black text-purple-800 uppercase tracking-widest">Audit Price Override</p>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-purple-50 border border-purple-200 text-purple-500 uppercase">Optional</span>
            {detail?.hasAuditOverride && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-purple-100 border border-purple-300 text-purple-700 uppercase">Override Active</span>
            )}
          </div>
          {isItemized && (
            !showForm ? (
              <button onClick={() => setShowForm(true)} className="text-[10px] font-bold text-purple-700 hover:text-purple-900 hover:bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-lg transition-all">
                {detail?.hasAuditOverride ? 'Edit' : 'Alter Request'}
              </button>
            ) : (
              !detail?.hasAuditOverride && (
                <button onClick={() => setShowForm(false)} className="text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-border/40 px-2.5 py-1 rounded-lg transition-all">Cancel</button>
              )
            )
          )}
        </div>

        {/* Existing override summary */}
        {detail?.hasAuditOverride && !showForm && existingOverride && (
          <div className="space-y-1.5 pl-1">
            <p className="text-xs text-purple-700/80">Verified amount: <span className="font-black text-purple-900">{_fmt(detail.auditAmount)}</span></p>
            {existingOverride.comment && <p className="text-xs text-purple-700/80 italic">"{existingOverride.comment}"</p>}
            <button onClick={handleClear} disabled={clearing} className="text-[10px] font-bold text-red-500 hover:text-red-700 flex items-center gap-1">
              {clearing ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
              Clear Override (revert to creator's amount)
            </button>
          </div>
        )}

        {/* Expanded table form */}
        {showForm && (
          <div className="space-y-3">
            <p className="text-[11px] text-purple-700/80 pl-1 leading-relaxed">
              Build your verified items table below. This will <strong>override the creator's estimated amount</strong> for threshold decisions and payment.
            </p>
            <div className="overflow-x-auto rounded-xl border border-purple-200 shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-purple-100/60 border-b border-purple-200">
                    <th className="text-left px-2 py-2 text-[10px] font-black text-purple-700 uppercase tracking-wider w-8">#</th>
                    <th className="text-left px-2 py-2 text-[10px] font-black text-purple-700 uppercase tracking-wider">Item Description</th>
                    <th className="text-center px-2 py-2 text-[10px] font-black text-purple-700 uppercase tracking-wider w-16">Qty</th>
                    <th className="text-right px-2 py-2 text-[10px] font-black text-purple-700 uppercase tracking-wider w-28">Unit Price (₦)</th>
                    <th className="text-right px-2 py-2 text-[10px] font-black text-purple-700 uppercase tracking-wider w-24">Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-100">
                  {rows.map((row, idx) => (
                    <tr key={idx} className="bg-white">
                      <td className="px-2 py-2 text-xs text-muted-foreground font-mono">{idx + 1}</td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={row.description} onChange={e => updateRow(idx, 'description', e.target.value)}
                          placeholder="Item description"
                          className="w-full text-xs border border-border/50 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-400" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="1" value={row.qty} onChange={e => updateRow(idx, 'qty', e.target.value)}
                          className="w-full text-xs text-center border border-border/50 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-400" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="0.01" value={row.amount} onChange={e => updateRow(idx, 'amount', e.target.value)}
                          placeholder="0.00"
                          className="w-full text-xs text-right border border-border/50 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-400" />
                      </td>
                      <td className="px-2 py-2 text-xs text-right font-mono font-bold text-foreground">{_fmt(calcLineTotal(row))}</td>
                      <td className="px-2 py-2 text-center">
                        {rows.length > 1 && (
                          <button onClick={() => removeRow(idx)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-purple-50/80 border-t-2 border-purple-200">
                    <td colSpan={4} className="px-2 py-2 text-xs font-black text-right uppercase tracking-widest text-purple-700">Verified Grand Total</td>
                    <td className="px-2 py-2 text-sm font-black text-right font-mono text-purple-800">{_fmt(grandTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <button onClick={addRow} className="flex items-center gap-1.5 text-[11px] font-bold text-purple-700 hover:text-purple-900 transition-colors pl-1">
              <Plus size={13} /> Add Row
            </button>
            <div>
              <label className="block text-[10px] font-black text-purple-700 uppercase tracking-widest mb-1 pl-1">Comment (optional)</label>
              <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
                placeholder="e.g. Prices verified against market rate..."
                className="w-full text-xs border border-border/50 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-400 resize-none" />
            </div>
          </div>
        )}

        {/* Routing comment — visible only when table is NOT expanded (no duplicate with override comment) */}
        {!showForm && (
          <div className="space-y-1 pt-1 border-t border-purple-100">
            <label className="text-[10px] font-black text-purple-700 uppercase tracking-widest">Review / Comment</label>
            <textarea
              value={routingNote}
              onChange={e => setRoutingNote(e.target.value)}
              rows={2}
              placeholder="Add your review or reason (optional — visible to recipient)…"
              className="w-full text-xs border border-purple-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-purple-400 resize-none"
            />
          </div>
        )}

        {/* Forward department selector — always visible */}
        <div className="space-y-1">
          <label className="text-[10px] font-black text-purple-700 uppercase tracking-widest">Forward to</label>
          <select value={forwardDeptId} onChange={e => setForwardDeptId(e.target.value)}
            className="w-full bg-white border border-purple-200 rounded-xl px-3 py-2 text-[11px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-purple-300">
            <option value="">— Select department —</option>
            {forwardDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        {/* Action buttons — labels change when unsaved changes exist */}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={handleForward} disabled={acting || !forwardDeptId}
            className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 rounded-xl transition-all disabled:opacity-40 text-sm shadow-sm">
            {acting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {hasChanges ? 'Save & Forward' : 'Forward'}
          </button>
          <div className="space-y-0.5">
            {returnTarget && <p className="text-[9px] text-purple-700/70 font-bold uppercase text-center tracking-wide">Returns to: {returnTarget.name}</p>}
            <button onClick={handleReturn} disabled={acting}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 rounded-xl transition-all disabled:opacity-40 text-sm shadow-sm">
              {acting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              {hasChanges ? 'Save & Return' : 'Return'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

// ── ICC Vets Protocol — Account's gate panel ────────────────────────────────
// Shown to Account instead of the normal treatment form when a Cash/Material
// request hasn't yet been vetted+returned by ICC. Account's only options here
// are to forward it to ICC, or return it up the chain as usual.
const IccVetForwardGate = ({ req, detail, departments, returnDestLabel, holderLabel = 'Account', onDone }) => {
  const [comment, setComment] = useState('');
  const [forwarding, setForwarding] = useState(false);
  const [returning, setReturning]   = useState(false);

  const handleForward = async () => {
    setForwarding(true);
    try {
      await iccVetForward(req.id, comment.trim() || undefined);
      toast.success('Forwarded to ICC for vetting.');
      setComment('');
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not forward to ICC.');
    } finally { setForwarding(false); }
  };

  const handleReturn = async () => {
    if (!comment.trim()) { toast.error('A reason is required to return this request.'); return; }
    setReturning(true);
    try {
      await vettingActionRequisition(req.id, { action: 'return', comment: comment.trim() });
      toast.success(`Returned to ${returnDestLabel}.`);
      setComment('');
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not return request.');
    } finally { setReturning(false); }
  };

  return (
    <div className="space-y-3 border border-indigo-200 rounded-2xl p-4 bg-indigo-50/50 shadow-sm relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500" />
      <div className="flex items-center gap-2 pl-1">
        <Shield size={14} className="text-indigo-700" />
        <p className="text-[10px] font-black text-indigo-800 uppercase tracking-widest">ICC Vets Protocol</p>
        <span className="ml-auto px-2 py-0.5 rounded-full bg-indigo-100 border border-indigo-300 text-[9px] font-black text-indigo-700 uppercase">Awaiting ICC Clearance</span>
      </div>
      <p className="text-[11px] text-indigo-700/80 leading-relaxed pl-1">
        This request must be vetted by ICC before {holderLabel} can treat it. Forward it to ICC now, or return it to {returnDestLabel} if something needs correcting first.
      </p>
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Optional note for ICC (required if returning)…"
        className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2.5 text-xs text-foreground placeholder-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none min-h-[56px]"
      />
      <div className="grid grid-cols-2 gap-2">
        <button onClick={handleForward} disabled={forwarding || returning}
          className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl transition-all disabled:opacity-40 text-sm shadow-sm">
          {forwarding ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Forward to ICC
        </button>
        <button onClick={handleReturn} disabled={forwarding || returning}
          className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 rounded-xl transition-all disabled:opacity-40 text-sm shadow-sm">
          {returning ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
          Return to {returnDestLabel}
        </button>
      </div>
    </div>
  );
};

// ── Vetting Panel (ICC / Audit / Account — role-specific auto-routing) ─────────
const VettingPanel = ({ req, detail, user, departments, onDone, onTreatInitiated }) => {
  const [comment, setComment]       = useState('');
  // Audit dept: default vetChecked=true since their sole role here is vetting
  const [vetChecked, setVetChecked] = useState(() => /\baudit\b/i.test(user?.name || ''));
  const [acting, setActing]         = useState(false);
  const fileRef                     = React.useRef(null);
  const [file, setFile]             = useState(null);
  const [forwardDeptId, setForwardDeptId] = useState('');
  const [localPreview, setLocalPreview]   = useState(null);
  // Disbursement state (Account / Chairman treat flow)
  const [amountInput, setAmountInput]     = useState('');
  const [treatChoice, setTreatChoice]     = useState(''); // 'partial' | 'adjusted'
  const [treatReason, setTreatReason]     = useState('');
  const [treatReasonCustom, setTreatReasonCustom] = useState('');
  // Account-specific treatment toggle
  const [treatInitiated, setTreatInitiated] = useState(false);
  const [paymentType, setPaymentType]       = useState(''); // 'full' | 'partial'
  const [kivActing, setKivActing]           = useState(false);
  const [forwardingForReapproval, setForwardingForReapproval] = useState(false);
  // Convert material → cash
  const [showConvert, setShowConvert] = useState(false);
  const [convertAmount, setConvertAmount] = useState('');
  const [convertComment, setConvertComment] = useState('');
  const [convertActing, setConvertActing] = useState(false);
  // ICC Vets Protocol bypass flags — default null/false (gate applies) until confirmed,
  // since the safe default is to keep the ICC gate enforced.
  const [accountIccBypass, setAccountIccBypass] = useState(null);
  const [ceoIccBypass, setCeoIccBypass]         = useState(null);
  // Optional per-department amount threshold that narrows the bypass — only amounts at/below
  // the threshold are exempt from ICC; above it, the full process (including ICC) still applies.
  const [accountThreshEnabled, setAccountThreshEnabled] = useState(false);
  const [accountThreshAmount, setAccountThreshAmount]   = useState(null);
  const [ceoThreshEnabled, setCeoThreshEnabled]         = useState(false);
  const [ceoThreshAmount, setCeoThreshAmount]           = useState(null);

  useEffect(() => {
    settingsAPI.get('icc_bypass_account_enabled').then(r => setAccountIccBypass(r?.value === 'true')).catch(() => setAccountIccBypass(false));
    settingsAPI.get('icc_bypass_ceo_enabled').then(r => setCeoIccBypass(r?.value === 'true')).catch(() => setCeoIccBypass(false));
    settingsAPI.get('icc_bypass_account_threshold_enabled').then(r => setAccountThreshEnabled(r?.value === 'true')).catch(() => {});
    settingsAPI.get('icc_bypass_account_threshold_amount').then(r => setAccountThreshAmount(r?.value != null ? parseFloat(r.value) : null)).catch(() => {});
    settingsAPI.get('icc_bypass_ceo_threshold_enabled').then(r => setCeoThreshEnabled(r?.value === 'true')).catch(() => {});
    settingsAPI.get('icc_bypass_ceo_threshold_amount').then(r => setCeoThreshAmount(r?.value != null ? parseFloat(r.value) : null)).catch(() => {});
  }, []);

  const deptName = user?.name || '';
  const currentVettingDeptId   = detail?.currentVettingDeptId   ? parseInt(detail.currentVettingDeptId)   : null;
  const finalApprovedByDeptId  = detail?.finalApprovedByDeptId  ? parseInt(detail.finalApprovedByDeptId)  : null;
  const _isAccountDept = /\baccount\b/i.test(user?.name || '');
  const _fas = detail?.finalApprovalStatus;
  const _isMaterialReq = /^material/i.test(req?.type || '');

  // Privileged sub-account of Audit or Account — uses approvalLimit for handling authority
  const _privSub = user?.isSubAccount && user?.parentDeptId && user?.approvalLimit != null;
  const _privLimit = _privSub ? parseFloat(user.approvalLimit) : null;
  const _effAmt = (detail?.hasIccOverride && detail?.iccOverrideAmount != null)
    ? parseFloat(detail.iccOverrideAmount)
    : (detail?.hasAuditOverride && detail?.auditAmount != null)
    ? parseFloat(detail.auditAmount) : parseFloat(req?.amount || 0);
  const _privCovers = _privSub && _privLimit != null && _effAmt <= _privLimit;
  const _parentId = _privSub ? parseInt(user.parentDeptId) : null;
  const _parentDept = _privSub ? departments?.find(d => d.id === _parentId) : null;
  // Determine if sub-account has privilege for this specific request type
  const _reqIsCash = !_isMaterialReq && !/^memo/i.test(req?.type || '');
  const _privCoversThisType = _reqIsCash
    ? _privCovers   // cash: amount-based
    : (_isMaterialReq ? !!(user?.materialPrivilege) : !!(user?.memoPrivilege)); // material/memo: toggle-based
  const _isAuditSub   = _privCoversThisType && /\baudit\b/i.test(_parentDept?.name || '');
  const _isAccountSub = _privCoversThisType && /\baccount\b/i.test(_parentDept?.name || '');

  // Account holds the request and it is a Material request — they can treat even when
  // finalApprovalStatus is 'none' (request arrived via direct forwarding, not vetting chain)
  const _accountHoldsMaterial = _isMaterialReq && (
    (_isAccountDept && detail?.targetDepartmentId === user.deptId) ||
    (_isAccountSub && detail?.targetDepartmentId === _parentId)
  );
  // Account holds a request that Audit has already reviewed (override saved) — allow treatment
  // even when finalApprovalStatus is 'none' (Audit forwarded directly without returning to HR)
  const _accountHoldsAuditReviewed = !!detail?.hasAuditOverride && (
    (_isAccountDept && detail?.targetDepartmentId === user.deptId) ||
    (_isAccountSub && detail?.targetDepartmentId === _parentId)
  );

  const isCurrentVetter = user?.deptId && (
    currentVettingDeptId === user.deptId ||
    (_isAccountDept && detail?.targetDepartmentId === user.deptId &&
      (_fas === 'approved' || _fas === 'vetting' || _fas === 'partial')) ||
    _accountHoldsMaterial ||
    _accountHoldsAuditReviewed ||
    // Material request: any target dept can issue directly once approved (no vetting chain needed)
    (_isMaterialReq && detail?.targetDepartmentId === user.deptId &&
      (_fas === 'approved' || _fas === 'partial')) ||
    // Privileged Audit sub-account — parent dept is current vetter
    (_isAuditSub && currentVettingDeptId === _parentId) ||
    // Privileged Account sub-account — parent Account holds the request
    (_isAccountSub && detail?.targetDepartmentId === _parentId &&
      (_fas === 'approved' || _fas === 'vetting' || _fas === 'partial')) ||
    // Material: privileged sub of target dept can also issue
    (_isMaterialReq && _privSub && detail?.targetDepartmentId === _parentId &&
      (_fas === 'approved' || _fas === 'partial'))
  );
  const finalApprovalStatus    = detail?.finalApprovalStatus;

  const isICC      = /\bicc\b|internal.*control|control.*compliance/i.test(deptName);
  const isAudit    = /\baudit\b/i.test(deptName) || _isAuditSub;
  const isAccount  = /\baccount\b/i.test(deptName) || _isAccountSub;
  const isChairman = /ceo|chairman/i.test(deptName);
  const isGM       = /general\s*manager|\bgm\b/i.test(deptName);

  // Only the active vetting dept sees this panel
  if (!isCurrentVetter) return null;
  // Allow Material/Audit-reviewed requests at Account through even when finalApprovalStatus is 'none'
  if (!_accountHoldsMaterial && !_accountHoldsAuditReviewed && (!finalApprovalStatus || finalApprovalStatus === 'none')) return null;
  if (finalApprovalStatus === 'treated' || finalApprovalStatus === 'closed') return null;

  // ── Re-approval gate ─────────────────────────────────────────────────────────
  // A later price revision pushed the effective amount past the original approver's
  // authority band. The normal treat/forward/return panel is fully blocked — the only
  // action available is forwarding it to whoever holds the required tier. If the current
  // viewer's own department already satisfies that tier, the banner above (rendered by
  // the parent) already gives them the Confirm button directly — nothing to show here.
  if (detail?.needsReapproval) {
    const requiredTier = detail.reapprovalAuthority;
    const alreadyAtRequiredTier = isChairman || (requiredTier === 'gm' && isGM);
    if (alreadyAtRequiredTier) return null;
    return (
      <div className="border-2 border-amber-200 rounded-2xl p-4 bg-amber-50/40 space-y-3">
        <p className="text-xs text-amber-800 leading-relaxed">
          This request needs {(requiredTier || 'higher-tier').toUpperCase()} re-approval before it can be treated. Forward it there now so they can confirm.
        </p>
        <button
          onClick={async () => {
            setForwardingForReapproval(true);
            try {
              const res = await forwardForReapproval(req.id);
              toast.success(`Forwarded to ${res.forwardedTo} for re-approval.`);
              onDone();
            } catch (err) {
              toast.error(err?.response?.data?.error || 'Could not forward for re-approval.');
            } finally { setForwardingForReapproval(false); }
          }}
          disabled={forwardingForReapproval}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all disabled:opacity-50 shadow-sm"
        >
          {forwardingForReapproval ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          {forwardingForReapproval ? 'Forwarding…' : `Forward for ${(requiredTier || '').toUpperCase()} Re-Approval`}
        </button>
      </div>
    );
  }

  // Account and CEO/Chairman cannot treat a Cash/Material request until ICC has vetted
  // and returned it, unless their department has been individually exempted via System
  // Settings. Their only action here is to forward to ICC (or return up the chain as usual).
  const _isMemoReqForGate = /^memo/i.test(req?.type || '');
  // A threshold (if enabled) narrows the bypass to amounts at/below it — above it, the
  // gate still applies even though the master bypass is on.
  const _accountBypassActive = accountIccBypass && !(accountThreshEnabled && accountThreshAmount != null && _effAmt > accountThreshAmount);
  const _ceoBypassActive     = ceoIccBypass && !(ceoThreshEnabled && ceoThreshAmount != null && _effAmt > ceoThreshAmount);
  const _iccGateAppliesToAccount = isAccount && !_accountBypassActive;
  const _iccGateAppliesToChairman = isChairman && !_ceoBypassActive;
  if ((_iccGateAppliesToAccount || _iccGateAppliesToChairman) && !_isMemoReqForGate && !_isMaterialReq && !detail?.iccVettingCleared) {
    return (
      <IccVetForwardGate
        req={req}
        detail={detail}
        departments={departments}
        holderLabel={isChairman ? 'CEO/Chairman' : 'Account'}
        returnDestLabel={finalApprovedByDeptId
          ? (departments.find(d => d.id === finalApprovedByDeptId)?.name || 'Approving Authority')
          : 'Approving Authority'}
        onDone={onDone}
      />
    );
  }

  // Account and Chairman always treat — for material, the target dept issues directly
  const _isTargetDept = detail?.targetDepartmentId === user?.deptId;
  const canTreat = isAccount || isChairman || (_isMaterialReq && _isTargetDept);

  // Disbursement calculations — ICC override takes priority over Audit (ICC acts post-approval)
  const reqAmount        = (detail?.hasIccOverride && detail?.iccOverrideAmount != null)
    ? parseFloat(detail.iccOverrideAmount)
    : (detail?.hasAuditOverride && detail?.auditAmount != null)
    ? parseFloat(detail.auditAmount)
    : parseFloat(detail?.amount || req.amount || 0);
  const alreadyDisbursed = parseFloat(detail?.amountDisbursed || 0);
  const balanceDue       = reqAmount - alreadyDisbursed;
  // Material requests only: most recent individual payment amount (for "X paid. Total so far — Y" display)
  const _lastTreatedEvent = (detail?.vettingEvents || []).filter(e => e.action === 'treated').slice(-1)[0];
  const lastPaymentAmt    = _lastTreatedEvent?.amountDisbursed != null ? parseFloat(_lastTreatedEvent.amountDisbursed) : null;
  const isPartialMode    = finalApprovalStatus === 'partial';
  const hasAmount        = reqAmount > 0;
  const parsedInput      = parseFloat(amountInput);
  // Material requests: no upper-bound price check — Account can enter any value and
  // decides full/partial themselves; this isn't a fund disbursement against a fixed amount.
  const inputIsValid     = !hasAmount || (!isNaN(parsedInput) && parsedInput > 0 && (_isMaterialReq || parsedInput <= balanceDue));
  const isUnderpaying    = hasAmount && inputIsValid && parsedInput < balanceDue;
  const needsTreatChoice = isUnderpaying && !treatChoice;
  const needsTreatReason = isUnderpaying && treatChoice === 'adjusted' && !treatReason;

  // Material requests with no system-known amount — Account may optionally enter a figure
  // and decides full/partial themselves, since there's no fixed requested amount to compare against.
  const showManualMaterialAmount = _isMaterialReq && !hasAmount;
  const manualParsedInput   = parseFloat(amountInput);
  const manualAmountEntered = amountInput.trim() !== '' && !isNaN(manualParsedInput) && manualParsedInput > 0;
  const manualChoiceReady   = !manualAmountEntered || treatChoice === 'full' || treatChoice === 'partial';

  // Auto-resolve next/return dept from departments list (no dropdown needed)
  const auditDept   = departments.find(d => /\baudit\b/i.test(d.name));
  const accountDept = departments.find(d => /\baccount\b/i.test(d.name));

  const handleKiv = async () => {
    setKivActing(true);
    try {
      await kivRequisition(req.id, comment || null);
      toast.success('Request placed on hold (KIV).');
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not place on hold.');
    } finally { setKivActing(false); }
  };

  const handleUnKiv = async () => {
    setKivActing(true);
    try {
      await unKivRequisition(req.id);
      toast.success('Hold removed — request is active again.');
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not remove hold.');
    } finally { setKivActing(false); }
  };

  const handleConvertToCash = async () => {
    const parsed = parseFloat(convertAmount);
    if (!parsed || parsed <= 0) { toast.error('Enter a valid purchase amount.'); return; }
    setConvertActing(true);
    try {
      await convertRequisitionToCash(req.id, { amount: parsed, comment: convertComment.trim() || undefined });
      toast.success('Converted to cash purchase — request is back in pending for approval.');
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Conversion failed.');
    } finally { setConvertActing(false); }
  };

  // Material: target dept issues items; Cash: Account / Chairman disburses
  const roleLabel    = _isMaterialReq ? 'Issue Items' : (isAccount ? 'Account' : isChairman ? 'Chairman / CEO Treatment' : 'Payment Treatment');
  const primaryLabel = _isMaterialReq ? 'Issue Items' : 'Mark Treated';
  const primaryDisabled = false;

  // Account always returns to the approving authority (ICC/Audit no longer in post-approval chain)
  const finalApproverDeptName = detail?.finalApprovedByDeptId
    ? (departments.find(d => d.id === parseInt(detail.finalApprovedByDeptId))?.name || 'Approving Authority')
    : 'Approving Authority';
  const returnDestLabel = finalApproverDeptName;

  // For Account: treatment gated by treatInitiated; material target dept: just needs confirm toggle
  const accountTreatCanAct = isAccount && treatInitiated && (!hasAmount || inputIsValid) && (!showManualMaterialAmount || manualChoiceReady);
  const materialTargetCanAct = _isMaterialReq && _isTargetDept && treatInitiated;
  const canAct = isAccount
    ? accountTreatCanAct
    : materialTargetCanAct || (comment.trim().length > 0
        && (!canTreat || !hasAmount || inputIsValid)
        && !needsTreatChoice
        && !needsTreatReason);

  const act = async (action) => {
    setActing(true);
    try {
      let result = null;
      if (action === 'forward') {
        const nextDeptId = forwardDeptId ? parseInt(forwardDeptId) : null;
        if (!nextDeptId) { toast.error('Please select a department to forward to.'); setActing(false); return; }
        result = await vettingActionRequisition(req.id, { action: 'forward', comment: comment || undefined, nextDeptId, file: file || undefined, vetted: vetChecked });
        if (result !== null) toast.success(vetChecked ? 'Vetted & forwarded.' : 'Forwarded.');
      } else if (action === 'treated') {
        const manualMaterial = showManualMaterialAmount && manualAmountEntered;
        const disbursed = manualMaterial
          ? manualParsedInput
          : (hasAmount && !isNaN(parsedInput) ? parsedInput : undefined);
        // For Account: do NOT send treatmentType — backend auto-determines from amount vs balance.
        // Material request with manually entered amount: Account's own full/partial choice is sent directly.
        // For Chairman: use existing treatChoice logic.
        const type = manualMaterial
          ? treatChoice
          : (isAccount ? undefined : (!isUnderpaying ? 'full' : treatChoice));
        const reason = (!isAccount && treatChoice === 'adjusted')
          ? (treatReason === 'other' ? treatReasonCustom : treatReason) || undefined
          : undefined;
        result = await vettingActionRequisition(req.id, {
          action: 'treated',
          comment: comment || undefined,
          file: file || undefined,
          vetted: vetChecked,
          amountDisbursed: disbursed,
          treatmentType: type,
          treatmentReason: reason,
        });
        if (result !== null) {
          // Determine what actually happened for the toast
          const wasFullyPaid = manualMaterial ? type === 'full' : (!hasAmount || (disbursed != null && disbursed >= balanceDue));
          if (_isMaterialReq) {
            if (wasFullyPaid || type === 'full') toast.success('Items issued — requisition closed.');
            else toast.success('Partial items issued. Request stays open for remainder.');
          } else if (type === 'adjusted') toast.success(`Requisition treated with adjusted amount ₦${disbursed?.toLocaleString()}.`);
          else if (wasFullyPaid) toast.success('Requisition fully treated!');
          else if (manualMaterial) toast.success(`Partial payment of ₦${disbursed?.toLocaleString()} recorded. Request stays open.`);
          else toast.success(`Partial payment of ₦${disbursed?.toLocaleString()} recorded. Balance pending.`);
        }
      } else if (action === 'return') {
        result = await vettingActionRequisition(req.id, { action: 'return', comment, file: file || undefined, vetted: vetChecked });
        if (result !== null) toast.success(vetChecked ? `Returned (Vetted) to ${returnDestLabel}.` : `Returned to ${returnDestLabel}.`);
      }
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Action failed.');
    } finally { setActing(false); }
  };

  return (
    <>
    <div className="space-y-3 border border-blue-200 rounded-2xl p-4 bg-blue-50/50 shadow-sm relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-blue-500" />
      <div className="flex items-center gap-2 pl-1">
        <Award size={14} className="text-blue-700" />
        <p className="text-[10px] font-black text-blue-800 uppercase tracking-widest">{roleLabel}</p>
        <span className="ml-auto px-2 py-0.5 rounded-full bg-blue-100 border border-blue-300 text-[9px] font-black text-blue-700 uppercase">In Vetting</span>
      </div>

      {isAccount ? (
        /* ── Account: checkbox-gated treatment form ─────────────────── */
        <div className="space-y-3">

          {/* Treatment toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none group p-3 rounded-xl border border-blue-200 bg-white hover:bg-blue-50 transition-colors">
            <input
              type="checkbox"
              checked={treatInitiated}
              onChange={e => { setTreatInitiated(e.target.checked); setAmountInput(''); setTreatChoice(''); if (onTreatInitiated) onTreatInitiated(e.target.checked); }}
              className="w-4 h-4 rounded accent-emerald-600 cursor-pointer shrink-0"
            />
            <div>
              <span className="text-[12px] font-black text-foreground">
                {treatInitiated ? '✓ Payment Amount Set' : 'Set Payment Amount'}
              </span>
              {!treatInitiated && (
                <p className="text-[10px] text-muted-foreground mt-0.5">Check to open the treatment form for this requisition.</p>
              )}
            </div>
          </label>

          {/* Treatment form — revealed only when checkbox is checked */}
          {treatInitiated && (
            <div className="space-y-3 p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl">

              {/* Partial payment continuation banner */}
              {isPartialMode && (
                <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-xl text-[11px] text-orange-800 font-semibold">
                  <AlertTriangle size={12} className="shrink-0 text-orange-500" />
                  {hasAmount ? (
                    <>
                      Partial payment on record — ₦{alreadyDisbursed.toLocaleString()} paid of ₦{reqAmount.toLocaleString()} requested.
                      Balance due: <span className="font-black">₦{balanceDue.toLocaleString()}</span>
                    </>
                  ) : (
                    <>Partial payment on record — ₦{(lastPaymentAmt ?? alreadyDisbursed).toLocaleString()} paid. Total paid so far — <span className="font-black">₦{alreadyDisbursed.toLocaleString()}</span></>
                  )}
                </div>
              )}

              {/* Amount input */}
              {hasAmount && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">
                    Amount to Disburse {isPartialMode ? `(Balance: ₦${balanceDue.toLocaleString()})` : `(Requested: ₦${reqAmount.toLocaleString()})`}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-muted-foreground">₦</span>
                    <input
                      type="number" min="1" max={_isMaterialReq ? undefined : balanceDue} step="0.01"
                      value={amountInput}
                      onChange={e => setAmountInput(e.target.value)}
                      placeholder={balanceDue.toLocaleString()}
                      className="w-full bg-white border border-emerald-200 rounded-xl pl-7 pr-3 py-2.5 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                  {amountInput && !inputIsValid && (
                    <p className="text-[10px] text-red-500 font-semibold">Amount cannot exceed the balance due (₦{balanceDue.toLocaleString()}).</p>
                  )}
                </div>
              )}

              {/* Material request, no system-known amount — optional manual amount + Account's own full/partial choice */}
              {showManualMaterialAmount && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">
                    Amount Spent (optional)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-muted-foreground">₦</span>
                    <input
                      type="number" min="0.01" step="0.01"
                      value={amountInput}
                      onChange={e => { setAmountInput(e.target.value); setTreatChoice(''); }}
                      placeholder="Leave blank if not applicable"
                      className="w-full bg-white border border-emerald-200 rounded-xl pl-7 pr-3 py-2.5 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                  {manualAmountEntered && (
                    <div className="flex gap-2 pt-1">
                      {[
                        { value: 'full',    label: 'Full Payment' },
                        { value: 'partial', label: 'Partial Payment' },
                      ].map(opt => (
                        <label key={opt.value}
                          className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-[11px] font-bold transition-all ${treatChoice === opt.value ? 'border-emerald-400 bg-emerald-100 text-emerald-800' : 'border-emerald-200 bg-white text-muted-foreground hover:border-emerald-300'}`}>
                          <input type="radio" name="materialPaymentChoice" value={opt.value}
                            checked={treatChoice === opt.value}
                            onChange={() => setTreatChoice(opt.value)}
                            className="accent-emerald-600" />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Optional note */}
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Treatment note (optional)…"
                className="w-full bg-white border border-emerald-200 rounded-xl p-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-300 min-h-[56px] resize-none shadow-inner"
              />

              {/* Attach document */}
              <div>
                <input type="file" ref={fileRef} className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
                {file ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-100 rounded-xl border border-emerald-200">
                    <FileText size={13} className="text-emerald-600 shrink-0" />
                    <span className="flex-1 truncate text-[11px] font-bold text-foreground">{file.name}</span>
                    <button onClick={() => { const url = URL.createObjectURL(file); setLocalPreview({ filename: file.name, blobUrl: url }); }} className="p-0.5 text-emerald-600 hover:text-emerald-900 rounded shrink-0"><Eye size={12} /></button>
                    <button onClick={() => setFile(null)} className="p-0.5 text-muted-foreground hover:text-destructive rounded shrink-0"><X size={12} /></button>
                  </div>
                ) : (
                  <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 text-[11px] font-bold text-emerald-700 hover:text-emerald-900 transition-colors px-2 py-1 rounded-lg hover:bg-emerald-100">
                    <Paperclip size={13} /> Attach supporting document
                  </button>
                )}
              </div>

              {/* System-decided payment type indicator */}
              {hasAmount && parsedInput > 0 && inputIsValid && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] font-semibold ${parsedInput >= balanceDue ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                  {parsedInput >= balanceDue
                    ? <><CheckCircle2 size={12} className="shrink-0 text-emerald-600" /> Full payment — request will be closed as <span className="font-black ml-1">Fully Treated</span>.</>
                    : <><AlertTriangle size={12} className="shrink-0 text-amber-500" /> Partial payment — request stays open. Balance: <span className="font-black ml-1">₦{(balanceDue - parsedInput).toLocaleString()}</span></>
                  }
                </div>
              )}

              {/* Confirm Treatment button */}
              <button
                onClick={() => act('treated')}
                disabled={acting || !accountTreatCanAct}
                className={`w-full flex items-center justify-center gap-2 text-white font-bold py-3 rounded-xl transition-all disabled:opacity-40 text-sm shadow-sm ${(hasAmount && parsedInput > 0 && parsedInput < balanceDue) || (showManualMaterialAmount && manualAmountEntered && treatChoice === 'partial') ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                {acting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {hasAmount && parsedInput > 0 && parsedInput < balanceDue
                  ? `Record Partial Payment — ₦${parsedInput.toLocaleString()}`
                  : hasAmount && parsedInput > 0
                  ? `Confirm Full Payment — ₦${parsedInput.toLocaleString()}`
                  : showManualMaterialAmount && manualAmountEntered && treatChoice === 'partial'
                  ? `Record Partial Payment — ₦${manualParsedInput.toLocaleString()}`
                  : showManualMaterialAmount && manualAmountEntered && treatChoice === 'full'
                  ? `Confirm Full Payment — ₦${manualParsedInput.toLocaleString()}`
                  : isPartialMode
                  ? 'Complete Treatment'
                  : 'Confirm Treatment'}
              </button>
            </div>
          )}

          {/* Forward / Return / KIV — hidden while Set Payment Amount is checked */}
          {!treatInitiated && <div className="pt-1 space-y-2 border-t border-blue-200">
            <p className="text-[9px] font-black text-blue-700/60 uppercase tracking-widest">Or Route to Another Department</p>
            {/* Required comment before routing */}
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Write reason for forwarding or returning (required)…"
              rows={2}
              className="w-full bg-white border border-blue-200 rounded-xl px-3 py-2 text-xs text-foreground placeholder-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
            />
            {!comment.trim() && <p className="text-[9px] text-blue-500/70 italic">A comment is required to forward or return.</p>}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <select value={forwardDeptId} onChange={e => setForwardDeptId(e.target.value)}
                  className="w-full bg-white border border-blue-200 rounded-xl px-2 py-1.5 text-[11px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-blue-300">
                  <option value="">Forward to dept…</option>
                  {departments.filter(d => d.id !== user?.deptId).map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <button onClick={() => act('forward')} disabled={acting || !forwardDeptId || !comment.trim()}
                  className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-xl transition-all disabled:opacity-40 text-xs shadow-sm">
                  {acting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  Forward
                </button>
              </div>
              <div className="space-y-1">
                <p className="text-[9px] text-amber-700/70 font-bold uppercase text-center tracking-wide">Returns to: {returnDestLabel}</p>
                <button onClick={() => act('return')} disabled={acting || !comment.trim()}
                  className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 rounded-xl transition-all disabled:opacity-40 text-sm shadow-sm">
                  {acting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  Return
                </button>
              </div>
            </div>
            {(detail?.isKIV ?? req.isKIV) ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-50 border border-violet-200">
                <BookMarked size={13} className="text-violet-600 shrink-0" />
                <span className="flex-1 text-[11px] font-bold text-violet-700">
                  On Hold (KIV){(detail?.kivNote || req.kivNote) ? ` — ${detail?.kivNote || req.kivNote}` : ''}
                </span>
                <button onClick={handleUnKiv} disabled={kivActing}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-black transition-all disabled:opacity-50">
                  {kivActing ? <Loader2 size={10} className="animate-spin" /> : <BookMarked size={10} />}
                  Resume
                </button>
              </div>
            ) : (
              <button onClick={handleKiv} disabled={kivActing}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 text-[10px] font-black transition-all disabled:opacity-50">
                {kivActing ? <Loader2 size={12} className="animate-spin" /> : <BookMarked size={12} />}
                Hold (KIV)
              </button>
            )}
          </div>}
        </div>
      ) : (
        /* ── Non-Account: existing vetting form ─────────────────────── */
        <>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Write your vetting remarks or return reason (required)..."
            className="w-full bg-white border border-blue-200 rounded-xl p-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-300 min-h-[72px] resize-none shadow-inner"
          />

          {/* Vetted checkbox — defaults true for Audit since vetting is their sole purpose here */}
          <label className="flex items-start gap-2.5 cursor-pointer select-none group">
            <input type="checkbox" checked={vetChecked} onChange={e => setVetChecked(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-blue-600 cursor-pointer shrink-0" />
            <span className="text-[11px] text-blue-800 font-semibold leading-snug">
              {isAudit ? 'Mark this as vetted by Audit' : 'I have vetted this document'}
              {vetChecked
                ? <span className="ml-1 text-emerald-600 font-black">(Vetted ✓)</span>
                : <span className="ml-1 text-rose-500 font-semibold italic">(will return as unvetted)</span>}
            </span>
          </label>

          {!canAct && <p className="text-[10px] text-blue-500/70 italic">Write a remark to unlock actions.</p>}

          <div>
            <input type="file" ref={fileRef} className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
            {file ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-100 rounded-xl border border-blue-200">
                <FileText size={13} className="text-blue-600 shrink-0" />
                <span className="flex-1 truncate text-[11px] font-bold text-foreground">{file.name}</span>
                <button onClick={() => { const url = URL.createObjectURL(file); setLocalPreview({ filename: file.name, blobUrl: url }); }} className="p-0.5 text-blue-600 hover:text-blue-900 rounded shrink-0"><Eye size={12} /></button>
                <button onClick={() => setFile(null)} className="p-0.5 text-muted-foreground hover:text-destructive rounded shrink-0"><X size={12} /></button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 text-[11px] font-bold text-blue-700 hover:text-blue-900 transition-colors px-2 py-1 rounded-lg hover:bg-blue-100">
                <Paperclip size={13} /> Attach supporting document
              </button>
            )}
          </div>

          {isChairman ? (
            /* Chairman — same treatment+forward+return layout */
            <div className="space-y-3 pt-1">
              {isPartialMode && (
                <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-xl text-[11px] text-orange-800 font-semibold">
                  <AlertTriangle size={12} className="shrink-0 text-orange-500" />
                  Partial payment on record — ₦{alreadyDisbursed.toLocaleString()} paid of ₦{reqAmount.toLocaleString()} requested.
                  Balance due: <span className="font-black">₦{balanceDue.toLocaleString()}</span>
                </div>
              )}
              {hasAmount && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-blue-700 uppercase tracking-widest">
                    Amount to Disburse {isPartialMode ? `(Balance: ₦${balanceDue.toLocaleString()})` : `(Requested: ₦${reqAmount.toLocaleString()})`}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-muted-foreground">₦</span>
                    <input type="number" min="1" max={balanceDue} step="0.01" value={amountInput}
                      onChange={e => { setAmountInput(e.target.value); setTreatChoice(''); setTreatReason(''); setTreatReasonCustom(''); }}
                      placeholder={balanceDue.toLocaleString()}
                      className="w-full bg-white border border-blue-200 rounded-xl pl-7 pr-3 py-2.5 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  </div>
                  {amountInput && !inputIsValid && <p className="text-[10px] text-red-500 font-semibold">Amount cannot exceed the balance due (₦{balanceDue.toLocaleString()}).</p>}
                </div>
              )}
              {isUnderpaying && (
                <div className="space-y-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest">Amount is less than balance — choose payment type:</p>
                  <label className="flex items-start gap-2 cursor-pointer group">
                    <input type="radio" name="treatChoice" value="partial" checked={treatChoice === 'partial'}
                      onChange={() => { setTreatChoice('partial'); setTreatReason(''); setTreatReasonCustom(''); }} className="mt-0.5 accent-amber-600 shrink-0" />
                    <div>
                      <span className="text-[11px] font-bold text-amber-900">Partial Payment</span>
                      <p className="text-[10px] text-amber-700/80">Balance of ₦{(balanceDue - (parsedInput || 0)).toLocaleString()} will be completed later.</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer group">
                    <input type="radio" name="treatChoice" value="adjusted" checked={treatChoice === 'adjusted'}
                      onChange={() => setTreatChoice('adjusted')} className="mt-0.5 accent-amber-600 shrink-0" />
                    <div>
                      <span className="text-[11px] font-bold text-amber-900">Adjusted Final Payment</span>
                      <p className="text-[10px] text-amber-700/80">This IS the full payment — no balance expected. Requires a reason.</p>
                    </div>
                  </label>
                  {treatChoice === 'adjusted' && (
                    <div className="space-y-1.5 pt-1">
                      <select value={treatReason} onChange={e => setTreatReason(e.target.value)}
                        className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 text-[11px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-amber-300">
                        <option value="">Select reason for adjustment…</option>
                        <option value="Account decision (budget constraint)">Account decision — budget constraint</option>
                        <option value="Per Audit instruction">Per Audit instruction</option>
                        <option value="Per GM/CEO directive">Per GM / CEO directive</option>
                        <option value="Per HR directive">Per HR directive</option>
                        <option value="other">Other (specify below)</option>
                      </select>
                      {treatReason === 'other' && (
                        <input type="text" value={treatReasonCustom} onChange={e => setTreatReasonCustom(e.target.value)} placeholder="Specify reason…"
                          className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 text-[11px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-amber-300" />
                      )}
                    </div>
                  )}
                </div>
              )}
              <button onClick={() => act('treated')} disabled={acting || !canAct}
                className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl transition-all disabled:opacity-40 text-sm shadow-sm">
                {acting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {isUnderpaying && treatChoice === 'partial' ? `Record Partial Payment (₦${parsedInput ? parsedInput.toLocaleString() : '…'})` : isUnderpaying && treatChoice === 'adjusted' ? `Treat — Adjusted to ₦${parsedInput ? parsedInput.toLocaleString() : '…'}` : isPartialMode ? `Complete Treatment${hasAmount && parsedInput ? ` (₦${parsedInput.toLocaleString()})` : ''}` : `Mark Fully Treated${hasAmount && parsedInput ? ` (₦${parsedInput.toLocaleString()})` : ''}`}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <select value={forwardDeptId} onChange={e => setForwardDeptId(e.target.value)}
                    className="w-full bg-white border border-blue-200 rounded-xl px-2 py-1.5 text-[11px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-blue-300">
                    <option value="">Forward to dept…</option>
                    {departments.filter(d => d.id !== user?.deptId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <button onClick={() => act('forward')} disabled={acting || !forwardDeptId || !canAct}
                    className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-xl transition-all disabled:opacity-40 text-xs shadow-sm">
                    {acting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    {vetChecked ? 'Vetted & Forward' : 'Forward (Unvetted)'}
                  </button>
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] text-amber-700/70 font-bold uppercase text-center tracking-wide">Returns to: {returnDestLabel}</p>
                  <button onClick={() => act('return')} disabled={acting || !canAct}
                    className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 rounded-xl transition-all disabled:opacity-40 text-sm shadow-sm">
                    {acting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                    {vetChecked ? 'Return (Vetted)' : 'Return'}
                  </button>
                </div>
              </div>
            </div>
          ) : isICC ? (
        /* ICC — hardcoded forward to Audit */
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button onClick={() => act('forward')} disabled={acting || primaryDisabled || !canAct}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl transition-all disabled:opacity-40 text-sm shadow-sm">
            {acting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {vetChecked ? `Vetted & ${primaryLabel}` : `${primaryLabel} (Unvetted)`}
          </button>
          <div className="space-y-1">
            <p className="text-[9px] text-amber-700/70 font-bold uppercase text-center tracking-wide">
              Returns to: {returnDestLabel}
            </p>
            <button onClick={() => act('return')} disabled={acting || !canAct}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 rounded-xl transition-all disabled:opacity-40 text-sm shadow-sm">
              {acting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              {vetChecked ? 'Return (Vetted)' : 'Return'}
            </button>
          </div>
        </div>
      ) : (
        /* Audit (and any other vetter) — free-choice forward to any dept including GM/CEO */
        <div className="space-y-2 pt-1">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Forward to</label>
            <select
              value={forwardDeptId}
              onChange={e => setForwardDeptId(e.target.value)}
              className="w-full bg-white border border-blue-200 rounded-xl px-3 py-2 text-[11px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-blue-300">
              <option value="">— Select department —</option>
              {departments.filter(d => d.id !== user?.deptId).map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => act('forward')} disabled={acting || !forwardDeptId || !canAct}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl transition-all disabled:opacity-40 text-sm shadow-sm">
              {acting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {vetChecked ? 'Vetted & Forward' : 'Forward (Unvetted)'}
            </button>
            <div className="space-y-1">
              <p className="text-[9px] text-amber-700/70 font-bold uppercase text-center tracking-wide">
                Returns to: {returnDestLabel}
              </p>
              <button onClick={() => act('return')} disabled={acting || !canAct}
                className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 rounded-xl transition-all disabled:opacity-40 text-sm shadow-sm">
                {acting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                {vetChecked ? 'Return (Vetted)' : 'Return'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )}

      {/* Convert Material → Cash — visible to target dept when items can't be fulfilled from stock */}
      {_isMaterialReq && _isTargetDept && (
        <div className="mt-3 border-t border-orange-200 pt-3">
          {!showConvert ? (
            <button
              onClick={() => setShowConvert(true)}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-orange-300 bg-orange-50 hover:bg-orange-100 text-orange-700 text-[11px] font-black transition-all"
            >
              <ArrowRight size={12} className="shrink-0" />
              Items not in stock — Convert to Cash Purchase
            </button>
          ) : (
            <div className="space-y-2 p-3 bg-orange-50 border border-orange-300 rounded-xl">
              <p className="text-[10px] font-black text-orange-800 uppercase tracking-widest">Convert to Cash Purchase</p>
              <p className="text-[10px] text-orange-700 leading-snug">
                This will reset the approval chain. The request will go back to <strong>Pending</strong> and follow the normal cash approval flow based on the amount you enter.
              </p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-muted-foreground">₦</span>
                <input
                  type="number" min="1" step="0.01"
                  value={convertAmount}
                  onChange={e => setConvertAmount(e.target.value)}
                  placeholder="Estimated purchase amount…"
                  className="w-full bg-white border border-orange-300 rounded-xl pl-7 pr-3 py-2 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
              </div>
              <textarea
                value={convertComment}
                onChange={e => setConvertComment(e.target.value)}
                placeholder="Reason (optional — e.g. out of stock, needs external procurement)…"
                rows={2}
                className="w-full bg-white border border-orange-200 rounded-xl px-3 py-2 text-xs text-foreground placeholder-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { setShowConvert(false); setConvertAmount(''); setConvertComment(''); }}
                  className="py-2 rounded-xl border border-orange-200 bg-white hover:bg-orange-50 text-orange-700 text-[11px] font-bold transition-all">
                  Cancel
                </button>
                <button onClick={handleConvertToCash} disabled={convertActing || !convertAmount.trim() || parseFloat(convertAmount) <= 0}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-[11px] font-black transition-all disabled:opacity-40">
                  {convertActing ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
                  Confirm Convert
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>

    {localPreview && (
      <FilePreviewModal
        attachment={{ filename: localPreview.filename }}
        initialBlobUrl={localPreview.blobUrl}
        onClose={() => {
          URL.revokeObjectURL(localPreview.blobUrl);
          setLocalPreview(null);
        }}
      />
    )}
    </>
  );
};

// ── ICC Vets Protocol — ICC's vetting panel ─────────────────────────────────
// Shown to ICC while they hold a Cash/Material request forwarded by Account.
// For Cash requests ICC may build a verified items table (same mechanic as
// Audit's pre-approval override, just positioned later — and ICC's table takes
// priority over Audit's per getEffectiveReqAmount). Material requests just get
// a plain vet + return — no table alteration.
const IccVetsPanel = ({ req, detail, departments, onDone, expanded = true, onToggleExpand = null }) => {
  const _fmt = n => `₦${Number(n || 0).toLocaleString()}`;
  const isMaterialReq = /^material/i.test(req?.type || '');
  const forwarderDeptId = detail?.iccForwardedFromDeptId ? parseInt(detail.iccForwardedFromDeptId) : null;
  const forwarderLabel = forwarderDeptId
    ? (departments.find(d => d.id === forwarderDeptId)?.name || 'the forwarding department')
    : 'Account';

  const existingOverride = detail?.hasIccOverride
    ? (() => { try { return JSON.parse(detail.iccOverrideContent); } catch { return null; } })()
    : null;
  // Audit's table (if set) is the most recent figures before ICC's turn — pre-fill from
  // that rather than the creator's stale original, when ICC hasn't set their own table yet.
  const auditOverrideForPrefill = (!existingOverride && detail?.hasAuditOverride)
    ? (() => { try { return JSON.parse(detail.auditContent); } catch { return null; } })()
    : null;

  const blankRow = () => ({ description: '', qty: 1, amount: '' });
  const initRows = () => {
    if (existingOverride?.items?.length)
      return existingOverride.items.map(i => ({ description: i.description, qty: i.qty, amount: String(i.amount) }));
    if (auditOverrideForPrefill?.items?.length)
      return auditOverrideForPrefill.items.map(i => ({ description: i.description, qty: i.qty, amount: String(i.amount) }));
    try {
      const parsed = JSON.parse(req.content || '{}');
      if (parsed.itemized && Array.isArray(parsed.items) && parsed.items.length > 0)
        return parsed.items.map(i => ({ description: i.description || '', qty: i.qty || 1, amount: String(i.amount || '') }));
    } catch { /* fall through */ }
    return [blankRow()];
  };

  const [rows, setRows]                 = useState(initRows);
  const [showTable, setShowTable]       = useState(!isMaterialReq && !!detail?.hasIccOverride);
  // Single comment box — pre-fills from ICC's own prior note if they already set an override.
  const [note, setNote]                 = useState(existingOverride?.comment || '');
  const [acting, setActing]             = useState(false);

  const calcLineTotal = (row) => (parseFloat(row.qty) || 0) * (parseFloat(row.amount) || 0);
  const grandTotal = rows.reduce((s, r) => s + calcLineTotal(r), 0);
  const updateRow = (idx, field, val) => setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));
  const addRow    = () => setRows(prev => [...prev, blankRow()]);
  const removeRow = (idx) => setRows(prev => prev.filter((_, i) => i !== idx));

  const isItemized = (() => { try { return JSON.parse(req.content || '{}')?.itemized; } catch { return false; } })();

  const handleReturn = async () => {
    setActing(true);
    try {
      let overrideItems;
      if (!isMaterialReq && showTable) {
        const validRows = rows.filter(r => r.description.trim() && parseFloat(r.amount) > 0);
        if (validRows.length) {
          overrideItems = validRows.map(r => ({ description: r.description.trim(), qty: parseFloat(r.qty) || 1, amount: parseFloat(r.amount) }));
        }
      }
      await iccVetReturn(req.id, {
        comment: note.trim() || undefined,
        overrideItems,
        // Single comment box now — the Vetting Note doubles as the table's comment too.
        overrideComment: overrideItems ? (note.trim() || undefined) : undefined,
      });
      toast.success(`Vetting complete — returned to ${forwarderLabel} for treatment.`);
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.error || `Could not return to ${forwarderLabel}.`);
    } finally { setActing(false); }
  };

  return (
    <div className="space-y-3 border border-violet-200 rounded-2xl p-4 bg-violet-50/50 shadow-sm relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-violet-500" />
      <div className={`flex items-center gap-2 pl-1 flex-wrap ${onToggleExpand ? 'cursor-pointer' : ''}`} onClick={onToggleExpand || undefined}>
        <Gavel size={14} className="text-violet-700" />
        <p className="text-[10px] font-black text-violet-800 uppercase tracking-widest">ICC Vets Protocol</p>
        <span className="px-2 py-0.5 rounded-full bg-violet-100 border border-violet-300 text-[9px] font-black text-violet-700 uppercase">Awaiting Your Vetting</span>
        {onToggleExpand && (
          <span className="ml-auto">
            {expanded ? <ChevronUp size={14} className="text-violet-700" /> : <ChevronDown size={14} className="text-violet-700" />}
          </span>
        )}
      </div>

      {expanded && (
      <>
      <p className="text-[11px] text-violet-700/80 leading-relaxed pl-1">
        {forwarderLabel} has forwarded this request to your department for vetting before treatment.
        {isMaterialReq ? ` Review and return it to ${forwarderLabel} when ready.` : ' You may optionally set a verified price table — it will take priority for payment.'}
      </p>

      {!isMaterialReq && isItemized && (
        <>
          {!showTable ? (
            <button onClick={() => setShowTable(true)} className="text-[10px] font-bold text-violet-700 hover:text-violet-900 hover:bg-violet-50 border border-violet-200 px-2.5 py-1 rounded-lg transition-all">
              {detail?.hasIccOverride ? 'Edit Verified Table' : 'Alter Table'}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-xl border border-violet-200 shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-violet-100/60 border-b border-violet-200">
                      <th className="text-left px-2 py-2 text-[10px] font-black text-violet-700 uppercase tracking-wider w-8">#</th>
                      <th className="text-left px-2 py-2 text-[10px] font-black text-violet-700 uppercase tracking-wider">Item Description</th>
                      <th className="text-center px-2 py-2 text-[10px] font-black text-violet-700 uppercase tracking-wider w-16">Qty</th>
                      <th className="text-right px-2 py-2 text-[10px] font-black text-violet-700 uppercase tracking-wider w-28">Unit Price (₦)</th>
                      <th className="text-right px-2 py-2 text-[10px] font-black text-violet-700 uppercase tracking-wider w-24">Total</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-violet-100">
                    {rows.map((row, idx) => (
                      <tr key={idx} className="bg-white">
                        <td className="px-2 py-2 text-xs text-muted-foreground font-mono">{idx + 1}</td>
                        <td className="px-2 py-1.5">
                          <input type="text" value={row.description} onChange={e => updateRow(idx, 'description', e.target.value)}
                            placeholder="Item description"
                            className="w-full text-xs border border-border/50 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" min="1" value={row.qty} onChange={e => updateRow(idx, 'qty', e.target.value)}
                            className="w-full text-xs text-center border border-border/50 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" min="0" step="0.01" value={row.amount} onChange={e => updateRow(idx, 'amount', e.target.value)}
                            placeholder="0.00"
                            className="w-full text-xs text-right border border-border/50 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400" />
                        </td>
                        <td className="px-2 py-2 text-xs text-right font-mono font-bold text-foreground">{_fmt(calcLineTotal(row))}</td>
                        <td className="px-2 py-2 text-center">
                          {rows.length > 1 && (
                            <button onClick={() => removeRow(idx)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-violet-50/80 border-t-2 border-violet-200">
                      <td colSpan={4} className="px-2 py-2 text-xs font-black text-right uppercase tracking-widest text-violet-700">ICC Verified Grand Total</td>
                      <td className="px-2 py-2 text-sm font-black text-right font-mono text-violet-800">{_fmt(grandTotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <button onClick={addRow} className="flex items-center gap-1.5 text-[11px] font-bold text-violet-700 hover:text-violet-900 transition-colors pl-1">
                <Plus size={13} /> Add Row
              </button>
              {!detail?.hasIccOverride && (
                <button onClick={() => setShowTable(false)} className="text-[10px] font-bold text-muted-foreground hover:text-foreground">Cancel table</button>
              )}
            </div>
          )}
        </>
      )}

      <div className="space-y-1 pt-1 border-t border-violet-100">
        <label className="text-[10px] font-black text-violet-700 uppercase tracking-widest">Vetting Note</label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          placeholder={`Optional note for ${forwarderLabel}…`}
          className="w-full text-xs border border-violet-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none"
        />
      </div>

      <button onClick={handleReturn} disabled={acting}
        className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-bold py-2.5 rounded-xl transition-all disabled:opacity-40 text-sm shadow-sm">
        {acting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
        Complete Vetting — Return to {forwarderLabel}
      </button>
      </>
      )}
    </div>
  );
};

// ── Sub-account visibility selector — per-unit dropdown with checkboxes ───────
const SubVisibilitySelector = ({ req, onAction }) => {
  const [open, setOpen]         = useState(false);
  const [saving, setSaving]     = useState(false);
  const [loaded, setLoaded]     = useState(false);
  const [visibleToAll, setVisibleToAll] = useState(req.visibleToSubAccounts ?? false);
  const [subAccounts, setSubAccounts]   = useState([]);
  const [specificIds, setSpecificIds]   = useState([]);
  const dropRef = React.useRef(null);

  const loadState = async () => {
    if (loaded) return;
    try {
      const data = await reqAPI.getSubVisibility(req.id);
      setVisibleToAll(data.visibleToAll);
      setSpecificIds(data.specificIds || []);
      setSubAccounts(data.subAccounts || []);
      setLoaded(true);
    } catch { toast.error('Failed to load unit list.'); }
  };

  const handleOpen = () => { setOpen(v => !v); loadState(); };

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const save = async (payload) => {
    setSaving(true);
    try {
      const res = await reqAPI.setSubAccountVisibility(req.id, payload);
      setVisibleToAll(res.visibleToSubAccounts);
      setSpecificIds(res.specificIds || []);
      onAction?.('refreshed', { ...req, visibleToSubAccounts: res.visibleToSubAccounts });
      toast.success('Visibility updated.');
    } catch { toast.error('Failed to save visibility.'); }
    finally { setSaving(false); }
  };

  const toggleSelectAll = () => {
    if (visibleToAll) save({ selectAll: false, subAccountIds: [] });
    else save({ selectAll: true });
  };

  const toggleSpecific = (id) => {
    if (visibleToAll) return;
    const next = specificIds.includes(id) ? specificIds.filter(i => i !== id) : [...specificIds, id];
    save({ selectAll: false, subAccountIds: next });
  };

  const label = visibleToAll ? 'All Units'
    : specificIds.length > 0 ? `${specificIds.length} Unit${specificIds.length !== 1 ? 's' : ''}`
    : 'Hidden from Units';

  const btnColor = visibleToAll
    ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
    : specificIds.length > 0
      ? 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100'
      : 'bg-muted/40 border-border/50 text-muted-foreground hover:bg-muted/70';

  return (
    <div className="relative" ref={dropRef}>
      <button
        onClick={handleOpen}
        disabled={saving}
        title="Control which sub-units can see this request"
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-black uppercase tracking-wider transition-all disabled:opacity-50 ${btnColor}`}
      >
        {saving ? <Loader2 size={9} className="animate-spin"/> : (visibleToAll || specificIds.length > 0) ? <Eye size={9}/> : <EyeOff size={9}/>}
        {label}
        <ChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`}/>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-border rounded-xl shadow-xl w-52 p-2">
          {!loaded ? (
            <div className="flex items-center justify-center py-3"><Loader2 size={14} className="animate-spin text-muted-foreground"/></div>
          ) : (
            <>
              <button
                onClick={toggleSelectAll}
                disabled={saving}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors mb-1
                  ${visibleToAll ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-muted/50 text-foreground/70'}`}
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0
                  ${visibleToAll ? 'bg-emerald-500 border-emerald-500' : 'border-border/70'}`}>
                  {visibleToAll && <Check size={10} className="text-white"/>}
                </span>
                Select All Units
              </button>
              <div className="border-t border-border/30 my-1"/>
              {subAccounts.length === 0 ? (
                <p className="text-[10px] text-muted-foreground px-2 py-1.5 italic">No sub-units found.</p>
              ) : subAccounts.map(sub => {
                const checked = visibleToAll || specificIds.includes(sub.id);
                return (
                  <button
                    key={sub.id}
                    onClick={() => toggleSpecific(sub.id)}
                    disabled={saving || visibleToAll}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors
                      ${checked && !visibleToAll ? 'bg-blue-50/60 text-blue-700' : ''}
                      ${visibleToAll ? 'opacity-60 cursor-default' : 'hover:bg-muted/50 text-foreground/70'}`}
                  >
                    <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0
                      ${checked ? (visibleToAll ? 'bg-emerald-500 border-emerald-500' : 'bg-blue-500 border-blue-500') : 'border-border/70'}`}>
                      {checked && <Check size={10} className="text-white"/>}
                    </span>
                    <span className="truncate text-left">{sub.name}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ── KIV Warning Banner — shown to ALL users when a request is on hold ────────
const KIVWarningBanner = ({ req, detail, canResume, onRefresh, departments = [] }) => {
  const [expanded, setExpanded] = useState(false);
  const [resuming, setResuming] = useState(false);
  const kivNote   = detail?.kivNote   || req?.kivNote;
  const kivByName = detail?.kivByName || req?.kivByName;
  const kivDept   = departments.find(d => d.name === kivByName);
  const kivHeadName = kivDept?.headName;

  const handleResume = async () => {
    setResuming(true);
    try {
      await unKivRequisition(req.id);
      toast.success('Hold removed — request is active again.');
      onRefresh(); // refresh in place, do NOT navigate away
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not lift hold.');
    } finally { setResuming(false); }
  };

  if (canResume) {
    // ── Holder's view — they placed the hold, show their own reason + Resume ──
    return (
      <div className="mx-4 mt-3 mb-1 rounded-xl border-2 border-violet-400 bg-violet-50 shadow-md shadow-violet-100 animate-in fade-in slide-in-from-top-3 duration-300">
        <div className="p-4 flex items-start gap-3">
          <BookMarked size={20} className="text-violet-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-black text-violet-800 uppercase tracking-wide">You Have Placed This Request On Hold</p>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-violet-200 border border-violet-400 text-violet-800 uppercase tracking-wide">KIV Active</span>
            </div>
            {kivNote && (
              <p className="mt-1.5 text-xs text-violet-700 leading-relaxed">
                <span className="font-bold">Your reason:</span> {kivNote}
              </p>
            )}
            <p className="mt-1 text-[10px] text-violet-500 font-medium italic">Click Resume to lift the hold and re-enable all actions.</p>
          </div>
          <button
            onClick={handleResume}
            disabled={resuming}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black transition-all disabled:opacity-50 shadow-sm"
          >
            {resuming ? <Loader2 size={12} className="animate-spin" /> : <BookMarked size={12} />}
            Resume
          </button>
        </div>
      </div>
    );
  }

  // ── Viewer's view — someone else placed the hold ──────────────────────────
  return (
    <div className="mx-4 mt-3 mb-1 rounded-xl border-2 border-amber-400 bg-amber-50 shadow-md shadow-amber-100 animate-in fade-in slide-in-from-top-3 duration-300">
      <div className="p-4 flex items-start gap-3">
        <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5 animate-pulse" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-black text-amber-800 uppercase tracking-wide">Request On Hold (KIV)</p>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-200 border border-amber-400 text-amber-800 uppercase tracking-wide">All Actions Paused</span>
            {kivByName && (
              <span className="text-xs font-bold text-amber-700">
                — Held by <span className="underline">{kivByName}</span>
                {kivHeadName && <span className="font-normal"> ({kivHeadName})</span>}
              </span>
            )}
          </div>
          {kivNote && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="mt-1.5 text-xs text-amber-700 font-bold hover:text-amber-900 underline underline-offset-2 transition-colors"
            >
              {expanded ? 'Hide reason ▲' : 'View reason ▼'}
            </button>
          )}
          {expanded && kivNote && (
            <div className="mt-2 p-3 rounded-xl bg-amber-100 border border-amber-300 text-sm text-amber-900 leading-relaxed font-medium animate-in fade-in slide-in-from-top-1 duration-200">
              {kivNote}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Detail Modal ─────────────────────────────────────────────────────────────
const RequisitionDetailModal = ({ req, user, departments, onClose, onAction, onEditDraft, canPrint }) => {
  const [detail, setDetail]         = useState(null);
  const [loading, setLoading]       = useState(true);
  const [acting, setActing]         = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [printModal, setPrintModal] = useState(false);
  const [newFiles, setNewFiles]       = useState([]);
  const [uploading, setUploading]     = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [pendingDeleteAttachment, setPendingDeleteAttachment] = useState(null);
  const [deletingAttachment, setDeletingAttachment] = useState(false);
  const [approveChecked, setApproveChecked] = useState(false);
  const [tagModal, setTagModal]     = useState(false);
  const [auditGate, setAuditGate]   = useState(null); // { authorityLabel } when active, else null
  const [reapprovalNote, setReapprovalNote] = useState('');
  const [reapproving, setReapproving] = useState(false);
  const fileInputRef                = React.useRef(null);
  const paymentSectionRef           = React.useRef(null);
  const approvalSectionRef          = React.useRef(null);
  const [accountPaymentMode, setAccountPaymentMode] = useState(false); // true when Account checks 'Set Payment Amount'
  // Only one of the two ICC panels (Observer comment/freeze, Vets Protocol) may be open at
  // once — expanding one collapses the other. null = both collapsed.
  const [expandedIccPanel, setExpandedIccPanel] = useState(null); // 'observer' | 'vets' | null

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRequisitionDetail(req.id).then(d => {
      if (!cancelled) { setDetail(d); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [req.id]);

  const handleAttachFiles = async (stageCtx, filesToUpload) => {
    const files = filesToUpload ?? newFiles;
    if (!files.length) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const { uploadAttachments } = await import('../lib/store');
      await uploadAttachments(req.id, files, { ...stageCtx, onProgress: setUploadProgress });
      setUploadProgress(100);
      const updated = await getRequisitionDetail(req.id);
      setDetail(updated);
      setNewFiles([]);
      toast.success(`${files.length} file(s) attached successfully.`);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'File upload failed. Please try again.');
    } finally {
      setTimeout(() => { setUploading(false); setUploadProgress(null); }, 400);
    }
  };

  // Is this an incoming (target dept) requisition for the current user?
  const isIncoming = user?.deptId && detail?.targetDepartmentId === user.deptId;
  // Is current user a tagged read-only observer?
  // A department that is ALSO the active forward target must never be blocked —
  // they received the request after being tagged and now have to act on it.
  const wasTaggedNowActive = !!(detail?.isTagged)
    && !!(detail?.targetDepartmentId)
    && parseInt(detail.targetDepartmentId) === parseInt(user?.deptId);
  const isTaggedObserver = !!(detail?.isTagged) && !wasTaggedNowActive;

  // ICC globals
  const isIccUser = user?.role === 'department' && /\bicc\b|internal.*control|control.*compliance/i.test(user?.name || '');
  const isOwnRequest = req.departmentId === user?.deptId; // ICC created this request themselves
  const showIccPanel = isIccUser && !isOwnRequest; // ICC panel only on other depts' requests
  const isFrozen = !!detail?.iccFrozen; // frozen by ICC — blocks all actions for non-ICC
  const isOnKiv  = !!(detail?.isKIV ?? req.isKIV);  // on hold — blocks all actions until resumed
  const isIncomingHolder = !!(detail?.targetDepartmentId && parseInt(detail.targetDepartmentId) === parseInt(user?.deptId));
  const canResumeKiv = isIncomingHolder || isIccUser;

  // Determine the sequence of events for the explanatory banner.
  // We need to know: (a) how the request arrived at this dept and
  // (b) whether the tag was applied before or after that arrival.
  const taggedNowActiveInfo = (() => {
    if (!wasTaggedNowActive) return null;
    const myDeptId = parseInt(user?.deptId);
    const events   = detail?.forwardEvents || [];
    const tags     = detail?.tags || [];

    // Last ForwardEvent that put this request at this dept's desk
    const lastArrival = [...events].reverse().find(e => parseInt(e.toDeptId) === myDeptId);
    const route = lastArrival?.action === 'returned' ? 'returned' : 'forwarded';

    // When was this dept tagged?
    const tagRecord  = tags.find(t => parseInt(t.deptId) === myDeptId);
    const taggedAt   = tagRecord?.taggedAt ? new Date(tagRecord.taggedAt) : null;
    const arrivedAt  = lastArrival?.createdAt ? new Date(lastArrival.createdAt) : null;

    // Order: 'tagged_first' = CC'd then forwarded/returned (original intent)
    //        'arrived_first' = forwarded/returned then CC'd afterwards
    const order = (!taggedAt || !arrivedAt)
      ? 'tagged_first'
      : taggedAt <= arrivedAt ? 'tagged_first' : 'arrived_first';

    return { route, order };
  })();
  // Can current user tag other departments? (must be in chain and not tagged observer)
  const canTag = !isTaggedObserver && user?.role === 'department' && detail;
  // Is this a direct inter-department request (no admin workflow)?
  const isInterDept = detail?.targetDepartmentId && !detail?.currentStageId;
  // Can current user take approval action — requires detail to be loaded to avoid flash of wrong panel
  const canApprove = !!detail && user?.role !== 'department' && req.status === 'pending' && !isInterDept;
  // Is the request financial?
  const isFinancial = req.type === 'Cash' || (req.amount && req.amount > 0);

  // Latest return event (if returned)
  const latestReturn = detail?.forwardEvents?.filter(e => e.action === 'returned').slice(-1)[0];
  // True when the req has been returned to the original creator's dept (fields locked, comment-only)
  const isReturnedToCreator = !!(latestReturn && detail?.targetDepartmentId === detail?.departmentId && user?.deptId === detail?.departmentId);
  // True when a vetting dept returned the request back to this user's dept (needs re-routing)
  const isVettingReturned = detail?.finalApprovalStatus === 'approved'
    && !detail?.currentVettingDeptId
    && !!(detail?.vettingEvents?.some(e => e.action === 'return'))
    && detail?.targetDepartmentId === user?.deptId;

  const handleApprove = async (remarks) => {
    setActing(true);
    try {
      await updateRequisitionStatus(req.id, 'approved', remarks);
      onAction();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Approval could not be processed. Please try again.');
    } finally { setActing(false); }
  };

  const handleReject = async (remarks) => {
    if (!remarks?.trim()) { toast.error('Please state a reason for rejection.'); return; }
    setActing(true);
    try {
      await updateRequisitionStatus(req.id, 'rejected', remarks);
      onAction();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Rejection could not be processed. Please try again.');
    } finally { setActing(false); }
  };

  const handleEscalate = () =>
    toast('Use Reject with remarks to escalate manually.', { icon: 'ℹ️' });

  const timeline    = detail ? buildTimeline(detail.approvals || [], detail.currentStage, detail.status) : [];
  const attachments = detail?.attachments || [];
  const forwardEvents = detail?.forwardEvents || [];
  const verCode     = detail?.approvals?.slice(-1)[0]?.signature?.verificationCode;

  // Split content into brief-only and items-only for independent mobile slot placement
  const _parsedContent = (() => {
    if (!req.content) return null;
    try { return JSON.parse(req.content); } catch { return null; }
  })();
  const _fmt = n => `₦${Number(n || 0).toLocaleString()}`;

  const briefBlock = req.description ? (
    <div className="space-y-2">
      <div className="flex items-center space-x-2">
        <FileText size={15} className="text-primary" />
        <p className="text-xs font-black text-foreground uppercase tracking-[0.1em]">Requisition Brief</p>
      </div>
      <p className="text-base font-semibold text-foreground leading-relaxed bg-[#FAF9F6]/50 p-4 rounded-xl border border-border/40 shadow-inner">
        {req.description}
      </p>
    </div>
  ) : null;

  const _hasAuditOverride = !!detail?.hasAuditOverride;
  const _auditParsed = _hasAuditOverride
    ? (() => { try { return JSON.parse(detail.auditContent); } catch { return null; } })()
    : null;
  const _hasIccOverride = !!detail?.hasIccOverride;
  const _iccParsed = _hasIccOverride
    ? (() => { try { return JSON.parse(detail.iccOverrideContent); } catch { return null; } })()
    : null;

  const _renderItemsTable = (items, total, comment, opts = {}) => {
    const { headerBg = 'bg-muted/60', headerText = 'text-muted-foreground', footerBg = 'bg-primary/5', footerBorder = 'border-primary/20', footerText = 'text-primary', borderColor = 'border-border/50' } = opts;
    return (
      <div className={`overflow-x-auto rounded-xl border ${borderColor} shadow-sm`}>
        {comment && <p className="text-sm text-muted-foreground italic px-3 pt-2">{comment}</p>}
        <table className="w-full text-sm">
          <thead>
            <tr className={`${headerBg} border-b ${borderColor}`}>
              <th className={`text-left px-3 py-2.5 text-[10px] font-black ${headerText} uppercase tracking-wider w-8`}>S/N</th>
              <th className={`text-left px-3 py-2.5 text-[10px] font-black ${headerText} uppercase tracking-wider`}>Item Description</th>
              <th className={`text-center px-3 py-2.5 text-[10px] font-black ${headerText} uppercase tracking-wider w-20`}>Quantity</th>
              <th className={`text-right px-3 py-2.5 text-[10px] font-black ${headerText} uppercase tracking-wider`}>Unit Price</th>
              <th className={`text-right px-3 py-2.5 text-[10px] font-black ${headerText} uppercase tracking-wider`}>Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {items.map((item, idx) => (
              <tr key={idx} className="bg-white hover:bg-muted/20 transition-colors">
                <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono">{idx + 1}</td>
                <td className="px-3 py-2.5 text-sm font-medium text-foreground">{item.description}</td>
                <td className="px-3 py-2.5 text-xs text-center font-semibold">{item.qty}</td>
                <td className="px-3 py-2.5 text-xs text-right font-mono text-muted-foreground">{_fmt(item.amount)}</td>
                <td className="px-3 py-2.5 text-xs text-right font-mono font-bold text-foreground">{_fmt(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={`${footerBg} border-t-2 ${footerBorder}`}>
              <td colSpan={4} className={`px-3 py-2.5 text-xs font-black text-right uppercase tracking-widest ${footerText}`}>Grand Total</td>
              <td className={`px-3 py-2.5 text-sm font-black text-right font-mono ${footerText}`}>{_fmt(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  const itemsBlock = (() => {
    if (!_parsedContent) return null;
    if (_parsedContent.itemized && Array.isArray(_parsedContent.items) && _parsedContent.items.length > 0) {
      return (
        <div className="space-y-4">
          {/* Creator's original table — always shown */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Paperclip size={15} className="text-primary" />
              <p className="text-xs font-black text-foreground uppercase tracking-[0.1em]">
                {(_hasAuditOverride || _hasIccOverride) ? 'Creator\'s Estimate (Original)' : 'Item Details'}
              </p>
              {(_hasAuditOverride || _hasIccOverride) && (
                <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-muted border border-border text-muted-foreground uppercase">For Reference</span>
              )}
            </div>
            {_renderItemsTable(
              _parsedContent.items,
              _parsedContent.total,
              _parsedContent.comment,
              (_hasAuditOverride || _hasIccOverride)
                ? { headerBg: 'bg-muted/40', headerText: 'text-muted-foreground', footerBg: 'bg-muted/30', footerBorder: 'border-border/40', footerText: 'text-muted-foreground', borderColor: 'border-border/40' }
                : {}
            )}
          </div>

          {/* Audit verified table — shown when override exists. Superseded by ICC's table if ICC also set one. */}
          {_hasAuditOverride && _auditParsed?.items?.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Gavel size={15} className="text-purple-600" />
                <p className="text-xs font-black text-purple-800 uppercase tracking-[0.1em]">Audit Verified Amount</p>
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border uppercase ${_hasIccOverride ? 'bg-muted border-border text-muted-foreground' : 'bg-purple-100 border-purple-300 text-purple-700'}`}>
                  {_hasIccOverride ? 'Superseded by ICC' : 'Effective for Approval & Payment'}
                </span>
              </div>
              {detail.auditDeptName && (
                <p className="text-[11px] text-purple-600/80 pl-1">Verified by: <span className="font-bold">{detail.auditDeptName}</span></p>
              )}
              {_renderItemsTable(
                _auditParsed.items,
                _auditParsed.total,
                _auditParsed.comment,
                _hasIccOverride
                  ? { headerBg: 'bg-muted/40', headerText: 'text-muted-foreground', footerBg: 'bg-muted/30', footerBorder: 'border-border/40', footerText: 'text-muted-foreground', borderColor: 'border-border/40' }
                  : { headerBg: 'bg-purple-100/60', headerText: 'text-purple-700', footerBg: 'bg-purple-50/80', footerBorder: 'border-purple-200', footerText: 'text-purple-800', borderColor: 'border-purple-200' }
              )}
            </div>
          )}

          {/* ICC verified table — shown when ICC has set one via the ICC Vets Protocol; always the effective amount */}
          {_hasIccOverride && _iccParsed?.items?.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Gavel size={15} className="text-violet-600" />
                <p className="text-xs font-black text-violet-800 uppercase tracking-[0.1em]">ICC Verified Amount</p>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-violet-100 border border-violet-300 text-violet-700 uppercase">Effective for Approval & Payment</span>
              </div>
              {detail.iccOverrideDeptName && (
                <p className="text-[11px] text-violet-600/80 pl-1">Verified by: <span className="font-bold">{detail.iccOverrideDeptName}</span></p>
              )}
              {_renderItemsTable(
                _iccParsed.items,
                _iccParsed.total,
                _iccParsed.comment,
                { headerBg: 'bg-violet-100/60', headerText: 'text-violet-700', footerBg: 'bg-violet-50/80', footerBorder: 'border-violet-200', footerText: 'text-violet-800', borderColor: 'border-violet-200' }
              )}
            </div>
          )}
        </div>
      );
    }
    if (!_parsedContent.itemized && _parsedContent.description) {
      return (
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <FileText size={15} className="text-primary" />
            <p className="text-xs font-black text-foreground uppercase tracking-[0.1em]">Material Description</p>
          </div>
          <p className="text-sm text-foreground leading-relaxed bg-[#FAF9F6]/50 p-4 rounded-xl border border-border/40 shadow-inner whitespace-pre-wrap">
            {_parsedContent.description}
          </p>
        </div>
      );
    }
    return null;
  })();

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-5 animate-in fade-in duration-500 pb-10">
      
      {/* Top Header / Back Button Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-white border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl flex items-center gap-2 transition-all font-bold text-xs uppercase tracking-wider shadow-sm group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          Back to Directory
        </button>

        {req.status === 'draft' && onEditDraft && (
          <button
            onClick={() => onEditDraft(req)}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl flex items-center gap-2 transition-all font-bold text-xs uppercase tracking-wider shadow-sm"
          >
            <FileText size={16} />
            Continue Editing
          </button>
        )}

        {canTag && (
          <button
            onClick={() => setTagModal(true)}
            title="Tag departments as observers"
            className="px-4 py-2 bg-white border border-border/50 text-muted-foreground hover:text-primary hover:border-primary/40 rounded-xl transition-all flex items-center gap-2 font-bold text-xs uppercase tracking-wider shadow-sm"
          >
            <Paperclip size={16} />
            CC Dept
          </button>
        )}

        {canPrint && (
          <button
            onClick={() => setPrintModal(true)}
            title="Print Stage Report"
            className="px-4 py-2 bg-primary text-white hover:bg-primary/90 rounded-xl transition-all shadow-md shadow-primary/20 flex items-center gap-2 font-bold text-xs uppercase tracking-wider"
          >
            <Printer size={16} />
            Print Record
          </button>
        )}
      </div>

      <div className="glass bg-white/95 w-full rounded-[2rem] border border-border/40 shadow-[0_4px_40px_rgba(0,0,0,0.03)] relative flex flex-col overflow-hidden min-h-[85vh]">

        {/* Header */}
        <div className="p-5 lg:p-7 border-b border-border/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0 bg-white/50">
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-[9px] font-black text-primary uppercase tracking-widest flex items-center gap-1">
                <div className="w-1 h-1 bg-primary rounded-full animate-pulse" />
                Neural Sync Active
              </div>
              {(() => {
                const fas = detail?.finalApprovalStatus;
                // These have their own dedicated chip below — don't show req.status alongside them
                if (['approved', 'vetting', 'treated', 'published'].includes(fas)) return null;
                const displayStatus = fas === 'partial' ? 'partial' : req.status;
                const displayLabel  = fas === 'partial' ? 'Partial Payment' : req.status;
                return (
                  <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase border shadow-sm ${statusColors[displayStatus] || statusColors[req.status]}`}>
                    {displayLabel}
                  </span>
                );
              })()}
              {isIncoming && (
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-blue-500 border border-blue-600 text-white shadow-lg shadow-blue-500/20">
                  Incoming Action
                </span>
              )}
              {(detail?.isKIV ?? req.isKIV) && (
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase border shadow-sm bg-violet-50 border-violet-200 text-violet-700 flex items-center gap-1">
                  <BookMarked size={9} /> On Hold (KIV)
                </span>
              )}
              {isTaggedObserver && (
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-amber-500 border border-amber-600 text-white shadow-lg shadow-amber-500/20 flex items-center gap-1">
                  <Paperclip size={9} /> Copied (Read Only)
                </span>
              )}
              {wasTaggedNowActive && taggedNowActiveInfo && (() => {
                const { route, order } = taggedNowActiveInfo;
                if (order === 'arrived_first') {
                  // Request was at their desk first — they were tagged after the fact
                  return (
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase flex items-center gap-1 shadow-lg bg-teal-600 border border-teal-700 text-white shadow-teal-500/20">
                      <Paperclip size={9} />
                      {route === 'returned' ? 'Returned to You — Also CC\'d' : 'Forwarded to You — Also CC\'d'}
                    </span>
                  );
                }
                // Tagged first, then forwarded/returned to them
                return (
                  <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase flex items-center gap-1 shadow-lg
                    ${route === 'returned'
                      ? 'bg-orange-500 border border-orange-600 text-white shadow-orange-500/20'
                      : 'bg-blue-600 border border-blue-700 text-white shadow-blue-500/20'}`}>
                    {route === 'returned'
                      ? <><RotateCcw size={9} /> Copied → Returned to You</>
                      : <><ArrowRight size={9} /> Copied → Forwarded to You</>}
                  </span>
                );
              })()}
              {detail?.finalApprovalStatus === 'approved' && (
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-emerald-500 border border-emerald-600 text-white shadow-lg shadow-emerald-500/20 flex items-center gap-1">
                  <CheckCircle2 size={10} /> Finally Approved
                </span>
              )}
              {detail?.finalApprovalStatus === 'vetting' && (
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-purple-500 border border-purple-600 text-white shadow-lg shadow-purple-500/20 flex items-center gap-1">
                  <Award size={10} /> In Vetting
                </span>
              )}
              {detail?.finalApprovalStatus === 'treated' && (
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-teal-500 border border-teal-600 text-white shadow-lg shadow-teal-500/20 flex items-center gap-1">
                  <CheckCircle2 size={10} /> Treated
                </span>
              )}
              {detail?.finalApprovalStatus === 'published' && (
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-emerald-600 border border-emerald-700 text-white shadow-lg shadow-emerald-500/20 flex items-center gap-1">
                  <CheckCircle2 size={10} /> Published
                </span>
              )}
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-foreground tracking-tighter leading-tight">{req.title}</h2>
            <div className="flex items-center gap-3 text-xs tracking-wide text-muted-foreground font-semibold flex-wrap">
               <span className="flex items-center gap-1.5">
                 <Building2 size={13}/> {req.department}
                 {req.isFromSubAccount && (() => {
                   const subDept = departments.find(d => d.id === req.departmentId);
                   const parentDept = subDept?.parentId ? departments.find(d => d.id === subDept.parentId) : null;
                   const pName = parentDept?.name || req.parentDeptName || null;
                   return (
                     <span className="px-1.5 py-0.5 rounded-full bg-violet-100 border border-violet-200 text-violet-700 text-[8px] font-black tracking-widest uppercase">
                       {pName || 'Sub-Unit'}
                     </span>
                   );
                 })()}
               </span>
               {/* Shared-by badge — shows to sub-accounts viewing their parent dept's shared request */}
               {user?.isSubAccount && user?.parentDeptId && Number(req.departmentId) === Number(user.parentDeptId) && (
                 <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[9px] font-black uppercase tracking-wider">
                   <Users size={9}/> {req.deptHeadName || req.department} (Dept Head)
                 </span>
               )}
               {detail?.targetDepartment?.name && (
                 <span className="flex items-center gap-1.5"><ArrowRight size={13}/> {detail.targetDepartment.name}</span>
               )}
               <span className="px-2 py-0.5 rounded-md bg-muted font-mono text-[10px] tracking-widest">#{req.id}</span>

               {/* Sub-account visibility — dept head only, own dept, non-sub-account requests */}
               {user?.role === 'department' && !user?.isSubAccount && !req.isFromSubAccount && Number(req.departmentId) === Number(user?.deptId) && (
                 <SubVisibilitySelector req={req} onAction={onAction} />
               )}
            </div>
          </div>
          
          {isFinancial && (() => {
            const eff = getEffectiveAmount({ ...detail, amount: detail?.amount ?? req.amount });
            const hasOverride = eff.source != null;
            const palette = eff.source === 'icc'
              ? { box: 'bg-violet-50 border-violet-200', text: 'text-violet-700', amt: 'text-violet-900' }
              : hasOverride
                ? { box: 'bg-purple-50 border-purple-200', text: 'text-purple-700', amt: 'text-purple-900' }
                : { box: 'bg-white border-border/40', text: 'text-muted-foreground', amt: 'text-foreground' };
            return (
              <div className={`sm:text-right border p-4 rounded-xl shadow-sm min-w-[200px] ${palette.box}`}>
                <p className={`text-[10px] font-black uppercase tracking-widest leading-none mb-1 ${palette.text}`}>{eff.label}</p>
                <p className={`text-2xl font-mono font-black ${palette.amt}`}>
                  ₦{eff.amount.toLocaleString()}
                </p>
                {hasOverride && (
                  <p className="text-[9px] text-muted-foreground mt-0.5 line-through">
                    Originally: ₦{eff.originalAmount.toLocaleString()}
                  </p>
                )}
              </div>
            );
          })()}
        </div>

        {/* Audit Pre-Review Banner — shown at top when approval authority is gated on audit */}
        {auditGate && detail && !loading && !isOnKiv && (
          <div className="mx-4 mt-3 space-y-2 border border-amber-200 rounded-2xl p-4 bg-amber-50/60 shadow-sm relative overflow-hidden animate-in fade-in slide-in-from-top-3 duration-300">
            <div className="absolute top-0 left-0 w-1 h-full bg-amber-500 rounded-l-2xl" />
            <div className="flex items-center gap-2 pl-1">
              <ShieldCheck size={14} className="text-amber-700" />
              <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest">Audit Pre-Review Required</p>
              <span className="ml-auto px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-[9px] font-black text-amber-700 uppercase">{auditGate.authorityLabel}</span>
            </div>
            <p className="text-[12px] text-amber-800 leading-relaxed pl-1">
              This request must be reviewed by <strong>Audit</strong> before you can approve it.
              Forward it to the Audit department — once Audit reviews and returns it, the approval form will unlock.
            </p>
            <div className="flex items-start gap-2 p-3 rounded-xl bg-white border border-amber-200 text-[11px] text-amber-700 font-medium">
              <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-500" />
              <span>Approval is locked until Audit returns this document. You can still forward or return it using the routing panel below.</span>
            </div>
          </div>
        )}

        {/* KIV Warning Banner — visible to ALL users when request is on hold */}
        {isOnKiv && detail && !loading && (
          <KIVWarningBanner
            req={req}
            detail={detail}
            canResume={canResumeKiv}
            departments={departments}
            onRefresh={() => getRequisitionDetail(req.id).then(d => setDetail(d))}
          />
        )}

        {/* ICC Freeze Banner — visible to ALL users when request is frozen */}
        {detail?.iccFrozen && (
          <div className="mx-4 mt-3 p-4 rounded-xl bg-red-50 border-2 border-red-300 flex items-start gap-3 animate-in fade-in slide-in-from-top-3 shadow-sm">
            <Lock size={20} className="text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-red-800 uppercase tracking-wide flex items-center gap-2">
                Request Frozen by ICC (Internal Control & Compliance)
                <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-red-100 border border-red-300 text-red-700 uppercase">All Actions Blocked</span>
              </p>
              <p className="text-sm text-red-700 mt-1 leading-relaxed font-medium">
                {detail.iccFreezeNote || 'ICC (Internal Control & Compliance) has placed a hold on this request. No actions may be taken until ICC lifts the freeze.'}
              </p>
              {detail.iccFreezeBy && (
                <p className="text-[10px] text-red-600/70 mt-1 font-bold">Frozen by: {detail.iccFreezeBy}</p>
              )}
            </div>
          </div>
        )}

        {/* Return Warning Banner */}
        {latestReturn && detail?.targetDepartmentId === detail?.departmentId && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3 animate-in fade-in slide-in-from-top-3">
            <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-black text-amber-800 uppercase tracking-wide">Returned — Action Required</p>
              <p className="text-sm text-amber-700 mt-1 leading-relaxed">
                {latestReturn.note || 'This request was returned for clarification. Please review and re-submit.'}
              </p>
              <p className="text-[10px] text-amber-600/70 mt-1">
                Returned by: {latestReturn.fromDepartment?.name || 'Department'} — {new Date(latestReturn.createdAt).toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {/* Body Grid */}
        <div className="flex-1 overflow-hidden">
          <div className="h-full grid lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_460px] 2xl:grid-cols-[minmax(0,1fr)_500px]">
            {/* Left Content Column */}
            <div className="overflow-y-auto custom-scrollbar p-4 lg:p-6 space-y-6 order-2 lg:order-1 lg:border-r border-border/50">
              
              {/* Brief + Items — desktop only; mobile renders each in its own sidebar slot */}
              <div className="hidden lg:block space-y-6">{briefBlock}{itemsBlock}</div>

              {/* Action Panels */}
              {/* Tagged Observer — pure read-only CC */}
              {isTaggedObserver && (
                <div className="animate-in fade-in slide-in-from-bottom-5 duration-500 border border-amber-200 rounded-2xl p-5 bg-amber-50/60 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-amber-400" />
                  <div className="flex items-center gap-2 pl-1 mb-2">
                    <Paperclip size={14} className="text-amber-700" />
                    <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest">Copied (CC) — Read Only</p>
                  </div>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    Your department has been CC'd on this requisition for visibility only. You can view all details, attachments, and history, and print the record — but you cannot take any action.
                  </p>
                </div>
              )}

              {/* Was tagged/copied AND is now the active target — show order-aware context banner */}
              {wasTaggedNowActive && taggedNowActiveInfo && (() => {
                const { route, order } = taggedNowActiveInfo;
                const arrivedFirst = order === 'arrived_first';
                const isReturn     = route === 'returned';

                // Colours: teal for arrived-first, orange for tagged-first-returned, blue for tagged-first-forwarded
                const borderCls = arrivedFirst ? 'border-teal-200'  : isReturn ? 'border-orange-200'  : 'border-blue-200';
                const bgCls     = arrivedFirst ? 'bg-teal-50/60'    : isReturn ? 'bg-orange-50/60'    : 'bg-blue-50/60';
                const barCls    = arrivedFirst ? 'bg-teal-500'      : isReturn ? 'bg-orange-500'      : 'bg-blue-500';
                const iconCls   = arrivedFirst ? 'text-teal-700'    : isReturn ? 'text-orange-700'    : 'text-blue-700';
                const labelCls  = arrivedFirst ? 'text-teal-800'    : isReturn ? 'text-orange-800'    : 'text-blue-800';
                const textCls   = arrivedFirst ? 'text-teal-700'    : isReturn ? 'text-orange-700'    : 'text-blue-700';

                const icon  = arrivedFirst ? <Paperclip size={14} className={iconCls} />
                            : isReturn     ? <RotateCcw size={14} className={iconCls} />
                            :                <ArrowRight size={14} className={iconCls} />;

                const title = arrivedFirst
                  ? (isReturn ? 'Returned to You — Also CC\'d' : 'Forwarded to You — Also CC\'d')
                  : (isReturn ? 'Previously Copied — Returned to You' : 'Previously Copied — Forwarded to You');

                const body = arrivedFirst
                  ? (isReturn
                      ? 'This request was returned to your department first. You were subsequently added as a CC recipient for ongoing visibility. You are the active holder and can take all necessary actions.'
                      : 'This request was forwarded to your department first. You were subsequently added as a CC recipient for ongoing visibility. You are the active holder and can take all necessary actions.')
                  : (isReturn
                      ? 'Your department was originally CC\'d on this request for visibility. It has since been returned to you and is now awaiting your action. You have full access to review and respond.'
                      : 'Your department was originally CC\'d on this request for visibility. It has since been forwarded to you and is now awaiting your action. You have full access to review and respond.');

                return (
                  <div className={`animate-in fade-in slide-in-from-bottom-5 duration-500 rounded-2xl p-5 shadow-sm relative overflow-hidden border ${borderCls} ${bgCls}`}>
                    <div className={`absolute top-0 left-0 w-1 h-full ${barCls}`} />
                    <div className="flex items-center gap-2 pl-1 mb-2">
                      {icon}
                      <p className={`text-[10px] font-black uppercase tracking-widest ${labelCls}`}>{title}</p>
                    </div>
                    <p className={`text-xs leading-relaxed ${textCls}`}>{body}</p>
                  </div>
                );
              })()}

              {/* ICC Observer Panel — shown to ICC for all requests except ICC's own */}
              {showIccPanel && detail && !loading && (
                <div className="animate-in fade-in slide-in-from-bottom-5 duration-500">
                  <IccObserverPanel
                    req={req}
                    detail={detail}
                    expanded={expandedIccPanel === 'observer'}
                    onToggleExpand={() => setExpandedIccPanel(p => p === 'observer' ? null : 'observer')}
                    onDone={() => {
                      getRequisitionDetail(req.id).then(d => setDetail(d));
                      onAction();
                    }}
                  />
                </div>
              )}

              {/* Re-approval required — a later price revision pushed the effective amount past
                  the band of whoever already gave final approval. Blocks treatment server-side
                  regardless of this banner; the button only appears for whoever can clear it. */}
              {!!detail?.needsReapproval && !loading && (() => {
                const requiredTier = detail.reapprovalAuthority;
                const n = (user?.name || '').toLowerCase();
                const isAdmin = user?.role === 'global_admin';
                const isGM = /general\s*manager|\bgm\b/i.test(n);
                const isChairman = /ceo|chairman/i.test(n);
                const canClear = isAdmin || isChairman || (requiredTier === 'gm' && isGM);
                return (
                  <div className="animate-in fade-in slide-in-from-bottom-5 duration-500 border-2 border-amber-300 rounded-2xl p-4 bg-amber-50/70 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-amber-500" />
                    <div className="flex items-center gap-2 pl-1 mb-1">
                      <AlertTriangle size={14} className="text-amber-700" />
                      <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest">
                        Re-Approval Required {requiredTier ? `— ${requiredTier.toUpperCase()}` : ''}
                      </p>
                    </div>
                    <p className="text-xs text-amber-700/85 leading-relaxed pl-1">
                      {detail.reapprovalReason || 'The verified amount was revised after final approval and now exceeds the original approver\'s authority. Treatment is blocked until the correct tier confirms.'}
                    </p>
                    {canClear && (
                      <div className="mt-3 space-y-2">
                        <textarea
                          value={reapprovalNote}
                          onChange={e => setReapprovalNote(e.target.value)}
                          rows={2}
                          placeholder="Optional note for the record (e.g. reason for accepting the revised amount)…"
                          className="w-full text-xs border border-amber-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
                        />
                        <button
                          onClick={async () => {
                            setReapproving(true);
                            try {
                              await reapproveRequisition(req.id, reapprovalNote.trim());
                              toast.success('Re-approved — Account can now treat this request.');
                              setReapprovalNote('');
                              getRequisitionDetail(req.id).then(d => setDetail(d));
                              onAction();
                            } catch (err) {
                              toast.error(err?.response?.data?.error || 'Could not re-approve.');
                            } finally { setReapproving(false); }
                          }}
                          disabled={reapproving}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all disabled:opacity-50 shadow-sm"
                        >
                          {reapproving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                          {reapproving ? 'Confirming…' : 'Confirm Re-Approval'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Frozen notice for non-ICC depts — action panels below are hidden when frozen */}
              {isFrozen && !isIccUser && !loading && (
                <div className="animate-in fade-in slide-in-from-bottom-5 duration-500 border-2 border-red-300 rounded-2xl p-4 bg-red-50/70 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-red-500" />
                  <div className="flex items-center gap-2 pl-1 mb-1">
                    <Lock size={14} className="text-red-700" />
                    <p className="text-[10px] font-black text-red-800 uppercase tracking-widest">Actions Blocked by ICC (Internal Control & Compliance)</p>
                  </div>
                  <p className="text-xs text-red-700/85 leading-relaxed pl-1">
                    ICC (Internal Control & Compliance) has frozen this request. You cannot forward, approve, return, or take any action until the freeze is lifted by ICC.
                  </p>
                </div>
              )}

              {!isTaggedObserver && isReturnedToCreator && req.status === 'pending' && !loading && !isFrozen && (
                <div className="animate-in fade-in slide-in-from-bottom-5 duration-500">
                  <CreatorCommentPanel
                    req={req}
                    departments={departments}
                    onDone={() => { onAction(); }}
                  />
                </div>
              )}

              {!isTaggedObserver && !approveChecked && !isReturnedToCreator && isIncoming && req.status === 'pending' && !loading && !isFrozen && !isOnKiv &&
               !/\baudit\b/i.test(user?.name || '') &&
               !/\baccount\b/i.test(user?.name || '') &&
               (!['treated', 'published', 'approved', 'vetting', 'partial'].includes(detail?.finalApprovalStatus) || isVettingReturned) && (
                <div className="animate-in fade-in slide-in-from-bottom-5 duration-500">
                   <RespondPanel
                     req={req}
                     detail={detail}
                     departments={departments}
                     onDone={() => { onAction(); }}
                   />
                </div>
              )}

              {/* Audit Override Panel — primary action surface for Audit dept (replaces RespondPanel) */}
              {!isTaggedObserver && user?.role === 'department' && detail && !loading && !isFrozen &&
               /\baudit\b/i.test(user?.name || '') &&
               detail.targetDepartmentId === user?.deptId &&
               !isMemoRecord(req) && (
                <div className="animate-in fade-in slide-in-from-bottom-5 duration-500">
                  <AuditOverridePanel
                    req={req}
                    detail={detail}
                    user={user}
                    departments={departments}
                    onDone={() => {
                      getRequisitionDetail(req.id).then(d => setDetail(d));
                      onAction();
                    }}
                  />
                </div>
              )}

              {!isTaggedObserver && !loading && canApprove && !isFrozen && !isOnKiv && (
                <div className="space-y-3 pt-4 border-t border-border/50">
                  <div className="flex items-center space-x-2">
                     <ShieldCheck size={13} className="text-primary" />
                     <p className="text-[10px] font-black text-foreground uppercase tracking-[0.1em]">Administrative Decision</p>
                  </div>
                  <div className={acting ? 'opacity-60 pointer-events-none' : ''}>
                    <ApprovalActionPanel
                      onApprove={handleApprove}
                      onReject={handleReject}
                      onEscalate={handleEscalate}
                    />
                  </div>
                </div>
              )}

              {/* Vetting Panel — Account (and privileged Audit/Account sub-accounts) for post-approval treatment. */}
              {!isTaggedObserver && user?.role === 'department' && detail && !loading && !isFrozen && !isOnKiv &&
               (/\baccount\b/i.test(user?.name || '') || /\baudit\b/i.test(user?.name || '')
                || (user?.isSubAccount && user?.parentDeptId && user?.approvalLimit != null)) &&
               ((detail.finalApprovalStatus && !['none', 'treated'].includes(detail.finalApprovalStatus))
                || (/^material/i.test(req?.type || '') && (detail.targetDepartmentId === user?.deptId
                    || detail.targetDepartmentId === (user?.parentDeptId ? parseInt(user.parentDeptId) : -1)))) && (
                <div ref={paymentSectionRef} className="animate-in fade-in slide-in-from-bottom-5 duration-500">
                  <VettingPanel
                    req={req}
                    detail={detail}
                    user={user}
                    departments={departments}
                    onTreatInitiated={setAccountPaymentMode}
                    onDone={() => {
                      getRequisitionDetail(req.id).then(d => setDetail(d));
                      onAction();
                    }}
                  />
                </div>
              )}

              {/* ICC Vets Protocol — ICC's vetting panel, shown only while ICC currently holds the request */}
              {!isTaggedObserver && user?.role === 'department' && detail && !loading && !isFrozen && !isOnKiv &&
               /\bicc\b|internal.*control|control.*compliance/i.test(user?.name || '') &&
               detail?.currentVettingDeptId && parseInt(detail.currentVettingDeptId) === parseInt(user?.deptId) && (
                <div className="animate-in fade-in slide-in-from-bottom-5 duration-500">
                  <IccVetsPanel
                    req={req}
                    detail={detail}
                    departments={departments}
                    expanded={expandedIccPanel === 'vets'}
                    onToggleExpand={() => setExpandedIccPanel(p => p === 'vets' ? null : 'vets')}
                    onDone={() => {
                      getRequisitionDetail(req.id).then(d => setDetail(d));
                      onAction();
                    }}
                  />
                </div>
              )}

              {/* Account read-only notice — shown when Chairman treated directly and Account was notified */}
              {user?.role === 'department' &&
               /\baccount/i.test(user?.name || '') &&
               detail?.finalApprovalStatus === 'treated' &&
               detail?.targetDepartmentId === user?.deptId && (
                <div className="animate-in fade-in slide-in-from-bottom-5 duration-500 border border-teal-200 rounded-2xl p-4 bg-teal-50/60 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-teal-500" />
                  <div className="flex items-center gap-2 pl-1 mb-3">
                    <CheckCircle2 size={14} className="text-teal-700" />
                    <p className="text-[10px] font-black text-teal-800 uppercase tracking-widest">Direct Treatment — Audit Record</p>
                    <span className="ml-auto px-2 py-0.5 rounded-full bg-teal-100 border border-teal-300 text-[9px] font-black text-teal-700 uppercase">View Only</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="bg-white/70 rounded-xl p-2.5 border border-teal-100">
                      <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-0.5">Treatment By</p>
                      <p className="font-bold text-foreground">Chairman / CEO</p>
                    </div>
                    <div className="bg-white/70 rounded-xl p-2.5 border border-teal-100">
                      <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-0.5">Mode</p>
                      <p className="font-bold text-foreground">Direct Treatment</p>
                    </div>
                    <div className="bg-white/70 rounded-xl p-2.5 border border-teal-100">
                      <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-0.5">Status</p>
                      <p className="font-bold text-teal-700">Finalized</p>
                    </div>
                    <div className="bg-white/70 rounded-xl p-2.5 border border-teal-100">
                      <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-0.5">Action</p>
                      <p className="font-bold text-muted-foreground">View Only</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Attachments Section */}
              {/* ── Enclosures (existing attachments) ── */}
              {attachments.length > 0 && (
                <div className="hidden lg:block space-y-3 pt-4 border-t border-border/50">
                  <div className="flex items-center space-x-2">
                     <Paperclip size={13} className="text-primary" />
                     <p className="text-[10px] font-black text-foreground uppercase tracking-[0.1em]">Enclosures ({attachments.length})</p>
                  </div>
                  {(() => {
                    // Delete is allowed only for creator dept and only before the req has been forwarded
                    const canDeleteAttachments = user?.role === 'department' &&
                      parseInt(user.deptId) === detail?.departmentId &&
                      (detail?.forwardEvents?.length === 0 || detail?.status === 'draft');
                    return (
                      <div className="grid grid-cols-1 gap-2">
                        {attachments.map(a => (
                          <div key={a.id} className="flex items-center gap-2 p-3 bg-muted/20 rounded-xl border border-border/30 text-xs hover:border-primary/20 transition-all group">
                            <FileText size={13} className="text-primary shrink-0" />
                            <div className="flex-1 min-w-0">
                               <p className="truncate text-foreground font-bold text-[11px]">{a.filename}</p>
                               <div className="flex items-center gap-2 flex-wrap mt-0.5">
                                 <span className="text-[9px] text-muted-foreground font-mono">{a.size ? `${(a.size / 1024).toFixed(0)} KB` : 'N/A'}</span>
                                 {(() => {
                                   const deptName = a.uploaderDept || a.uploadedBy?.department?.name || '';
                                   const userName = a.uploadedBy?.name || '';
                                   const label = [deptName, userName].filter(Boolean).join(' · ');
                                   return label ? (
                                     <span className="text-[9px] text-primary/70 font-bold uppercase tracking-wide">{label}</span>
                                   ) : null;
                                 })()}
                                 {a.stageName && (
                                   <span className="text-[9px] text-muted-foreground/60 italic">{a.stageName}</span>
                                 )}
                                 {a.createdAt && (
                                   <span className="text-[9px] text-muted-foreground/50 font-mono">{new Date(a.createdAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}</span>
                                 )}
                               </div>
                            </div>
                            <button
                              onClick={() => setPreviewFile(a)}
                              title="Preview"
                              className="p-1.5 text-muted-foreground hover:text-primary transition-all rounded-lg hover:bg-primary/5 shrink-0"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  const res = await fetch(`/api/attachments/${a.id}/download`, { credentials: 'include' });
                                  if (!res.ok) throw new Error();
                                  const blob = await res.blob();
                                  const url = URL.createObjectURL(blob);
                                  const dl = document.createElement('a');
                                  dl.href = url; dl.download = a.filename; document.body.appendChild(dl);
                                  dl.click(); dl.remove();
                                  setTimeout(() => URL.revokeObjectURL(url), 10000);
                                } catch { toast.error('Download failed.'); }
                              }}
                              title="Download"
                              className="p-1.5 text-muted-foreground hover:text-primary transition-all rounded-lg hover:bg-primary/5 shrink-0"
                            >
                              <Download size={14} />
                            </button>
                            {canDeleteAttachments && (
                              <button
                                title="Delete attachment"
                                onClick={() => setPendingDeleteAttachment(a)}
                                className="p-1.5 text-muted-foreground hover:text-red-500 transition-all rounded-lg hover:bg-red-50 shrink-0"
                              >
                                <Trash size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── Post-Creation Attachment Upload ── */}
              {!isTaggedObserver && !loading && !approveChecked && !accountPaymentMode && user?.role !== 'global_admin' && !['treated', 'published', 'vetting', 'approved'].includes(detail?.finalApprovalStatus) && (isIncoming || canApprove) && (() => {
                // Compute stage context for tagging
                const fwdEvents = detail?.forwardEvents || [];
                const approvals = detail?.approvals || [];
                const latestFwd = fwdEvents[fwdEvents.length - 1];
                const latestApp = approvals[approvals.length - 1];
                let stageName, stageKey;
                if (latestFwd) {
                  stageName = `${latestFwd.toDepartment?.name || 'Department'} Review`;
                  stageKey  = `fwd-${latestFwd.id}`;
                } else if (detail?.currentStage) {
                  stageName = detail.currentStage.name;
                  stageKey  = `app-${detail.currentStage.id}`;
                } else if (latestApp) {
                  stageName = latestApp.stage?.name || 'Approval Stage';
                  stageKey  = `app-${latestApp.id}`;
                } else {
                  stageName = 'Initial Submission';
                  stageKey  = 'submission';
                }
                const uploaderDept = user?.name || '';

                return (
                  <div className="space-y-3 pt-4 border-t border-dashed border-border/40 animate-in fade-in duration-500">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <ArrowDownToLine size={13} className="text-primary" />
                        <p className="text-[10px] font-black text-foreground uppercase tracking-[0.1em]">Attach Documents</p>
                      </div>
                      <span className="text-[9px] font-mono text-muted-foreground/60 italic truncate max-w-[120px]" title={stageName}>
                        Stage: {stageName}
                      </span>
                    </div>

                    <input
                      type="file"
                      multiple
                      ref={fileInputRef}
                      className="hidden"
                      accept="*/*"
                      onChange={e => {
                        const added = Array.from(e.target.files);
                        e.target.value = '';
                        if (!added.length) return;
                        const names = new Set(newFiles.map(f => f.name));
                        const merged = [...newFiles, ...added.filter(f => !names.has(f.name))];
                        setNewFiles(merged);
                        handleAttachFiles({ stageName, stageKey, uploaderDept }, merged);
                      }}
                    />

                    {!uploading && (
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-border/40 rounded-xl p-4 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all group"
                      >
                        <div className="flex flex-col items-center gap-1.5">
                          <Paperclip size={18} className="text-muted-foreground/50 group-hover:text-primary transition-colors" />
                          <p className="text-[11px] font-bold text-muted-foreground group-hover:text-primary transition-colors">
                            Click to select files
                          </p>
                          <p className="text-[9px] text-muted-foreground/50">PDF, images, Word, Excel — any format</p>
                        </div>
                      </div>
                    )}

                    {newFiles.length > 0 && (
                      <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {newFiles.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-2 bg-primary/5 rounded-lg border border-primary/10">
                            <FileText size={12} className="text-primary shrink-0" />
                            <span className="flex-1 truncate text-[11px] font-bold text-foreground">{f.name}</span>
                            <span className="text-[9px] font-mono text-muted-foreground shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                            {!uploading && (
                              <>
                                <button
                                  title="Preview"
                                  onClick={() => {
                                    const url = URL.createObjectURL(f);
                                    window.open(url, '_blank', 'noopener,noreferrer');
                                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                                  }}
                                  className="p-0.5 text-muted-foreground hover:text-primary rounded transition-colors shrink-0"
                                >
                                  <Eye size={12} />
                                </button>
                                <button
                                  onClick={() => setNewFiles(newFiles.filter((_, j) => j !== i))}
                                  className="p-0.5 text-muted-foreground hover:text-destructive rounded transition-colors shrink-0"
                                >
                                  <X size={12} />
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                        {uploading && (
                          <div className="space-y-1.5 pt-1 animate-in fade-in duration-300">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="font-black text-primary uppercase tracking-widest flex items-center gap-1.5">
                                <Loader2 size={10} className="animate-spin" />
                                {(uploadProgress ?? 0) >= 100 ? 'Processing…' : 'Uploading…'}
                              </span>
                              <span className="font-mono text-muted-foreground">{uploadProgress ?? 0}%</span>
                            </div>
                            <div className="w-full bg-muted/40 rounded-full h-2 overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full transition-all duration-200"
                                style={{ width: `${uploadProgress ?? 0}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Final Approve Panel — below Attach Documents, for dept authority users */}
              {!isTaggedObserver && user?.role === 'department' && detail && !loading && !isOnKiv &&
               !['treated', 'published', 'vetting'].includes(detail?.finalApprovalStatus) && (
                <div ref={approvalSectionRef} className="animate-in fade-in slide-in-from-bottom-5 duration-500">
                  <FinalApprovePanel
                    req={req}
                    detail={detail}
                    user={user}
                    departments={departments}
                    onApproveCheck={setApproveChecked}
                    onAuditGate={setAuditGate}
                    onApproved={() => {
                      setApproveChecked(false);
                      getRequisitionDetail(req.id).then(d => setDetail(d));
                      onAction();
                    }}
                  />
                </div>
              )}

              {/* Mobile-only Close Document — sits below attachments */}
              <button onClick={onClose} className="lg:hidden w-full text-[9px] text-muted-foreground hover:text-foreground font-black uppercase tracking-[0.2em] transition-colors py-3 border-t border-border/50 mt-2">
                Close Document
              </button>
            </div>

            {/* Right Sidebar Column */}
            <div className="bg-muted/10 overflow-y-auto custom-scrollbar p-4 lg:p-5 space-y-5 flex flex-col order-1 lg:order-2">

              {/* ── SLOT ORDER (mobile = right sidebar first, desktop = right sidebar only) ──
                  1. Current Status  (always)
                  2. Item Details    (lg:hidden — mobile only)
                  3. Enclosures      (lg:hidden — mobile only)
                  4. Vetting Chain   (always)
                  5. Processing Chain (always)
              ── */}

              {/* 1. Current Status — first on both mobile and desktop */}
              {/* Status & Alerts */}
              <div className="space-y-3">
                 <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.1em]">Current Status</p>
                 {req.status === 'pending' ? (
                   // Check vetting / final-approval state before falling back to generic
                   detail?.finalApprovalStatus === 'vetting' ? (
                     <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 space-y-2">
                       <div className="flex items-center gap-2">
                         <div className="w-7 h-7 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-600">
                           <Award size={14} />
                         </div>
                         <div className="flex-1">
                           <p className="text-xs font-bold text-purple-700">Under Vetting</p>
                           <p className="text-[10px] text-purple-600/80 font-medium">
                             {(() => {
                               const cvId = detail?.currentVettingDeptId ? parseInt(detail.currentVettingDeptId) : null;
                               return departments.find(d => d.id === cvId)?.name
                                 || detail?.vettingEvents?.filter(e => e.action !== 'return')?.slice(-1)[0]?.deptName
                                 || 'Vetting Department';
                             })()}
                           </p>
                         </div>
                         {/* Mobile-only: Account dept scroll to payment panel while vetting */}
                         {(() => {
                           const isAccount = /\baccount\b/i.test(user?.name || '');
                           const cvId = detail?.currentVettingDeptId ? parseInt(detail.currentVettingDeptId) : null;
                           const isMyVetting = cvId && parseInt(user?.deptId) === cvId;
                           if (!isAccount || !isMyVetting) return null;
                           return (
                             <button
                               onClick={() => paymentSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                               className="lg:hidden flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 border border-blue-700 text-blue-100 text-[10px] font-black transition-all animate-bounce shadow-sm shrink-0"
                               title="Go to payment panel"
                             >
                               <ArrowDownToLine size={12} />
                               <span>Set Payment</span>
                             </button>
                           );
                         })()}
                       </div>
                     </div>
                   ) : detail?.finalApprovalStatus === 'approved' ? (
                     <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2 text-emerald-700">
                       <ShieldCheck size={16} />
                       <span className="text-xs font-bold">Finally Approved – Pending Vetting</span>
                     </div>
                   ) : detail?.finalApprovalStatus === 'partial' ? (
                     <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 space-y-1.5">
                       <div className="flex items-center gap-2 text-orange-700">
                         <AlertTriangle size={16} />
                         <span className="text-xs font-bold">Partial Payment — Balance Pending</span>
                         {/* Mobile-only: tap to jump down to payment entry section */}
                         <button
                           onClick={() => paymentSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                           className="lg:hidden ml-auto flex items-center gap-1 px-2 py-1 rounded-lg bg-red-600 hover:bg-red-700 border border-red-700 text-red-100 text-[10px] font-black transition-all animate-bounce shadow-sm"
                           title="Go to payment entry"
                         >
                           <ArrowDownToLine size={12} />
                           <span>Continue Payment</span>
                         </button>
                       </div>
                       {detail.amount > 0 ? (() => {
                         const effAmt = (detail.hasIccOverride && detail.iccOverrideAmount != null) ? Number(detail.iccOverrideAmount) : (detail.hasAuditOverride && detail.auditAmount != null) ? Number(detail.auditAmount) : Number(detail.amount);
                         const paid = Number(detail.amountDisbursed || 0);
                         return (
                           <div className="text-[10px] text-orange-700/80 font-semibold pl-6">
                             Paid: ₦{paid.toLocaleString()} of ₦{effAmt.toLocaleString()} {(detail.hasIccOverride || detail.hasAuditOverride) ? 'verified' : 'requested'}
                             {' — '}Balance: ₦{(effAmt - paid).toLocaleString()}
                           </div>
                         );
                       })() : Number(detail.amountDisbursed || 0) > 0 && (
                         <div className="text-[10px] text-orange-700/80 font-semibold pl-6">
                           Total paid so far — ₦{Number(detail.amountDisbursed).toLocaleString()}
                         </div>
                       )}
                     </div>
                   ) : detail?.finalApprovalStatus === 'treated' ? (
                     <div className="p-3 rounded-xl bg-teal-500/10 border border-teal-500/20 space-y-1.5">
                       <div className="flex items-center gap-2 text-teal-700">
                         <CheckCircle2 size={16} />
                         <span className="text-xs font-bold">
                           {detail?.treatmentType === 'adjusted' ? 'Treated (Adjusted Amount)' : 'Fully Treated'}
                         </span>
                       </div>
                       {detail.amount > 0 && detail.amountDisbursed != null && (() => {
                         const effAmt = (detail.hasIccOverride && detail.iccOverrideAmount != null) ? Number(detail.iccOverrideAmount) : (detail.hasAuditOverride && detail.auditAmount != null) ? Number(detail.auditAmount) : Number(detail.amount);
                         return (
                           <div className="text-[10px] text-teal-700/80 font-semibold pl-6">
                             Total Disbursed: ₦{Number(detail.amountDisbursed).toLocaleString()}
                             {detail.treatmentType === 'adjusted' && ` of ₦${effAmt.toLocaleString()} ${detail.hasAuditOverride ? 'verified' : 'requested'}`}
                             {detail.treatmentReason && ` — ${detail.treatmentReason}`}
                           </div>
                         );
                       })()}
                     </div>
                   ) : detail?.finalApprovalStatus === 'published' ? (
                     <div className="p-3 rounded-xl bg-emerald-600/10 border border-emerald-600/20 flex items-center gap-2 text-emerald-800">
                       <CheckCircle2 size={16} />
                       <span className="text-xs font-bold">Published</span>
                     </div>
                   ) : isInterDept ? (
                     <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-600">
                             <Building2 size={14} />
                          </div>
                          <div className="flex-1">
                            <p className="text-xs font-bold text-blue-700">Department Review</p>
                            <p className="text-[10px] text-blue-600/80 font-medium">{detail?.targetDepartment?.name || 'Target Department'}</p>
                          </div>
                          {/* Mobile-only: scroll to approval panel for threshold depts */}
                          {(() => {
                            const deptName = user?.name || '';
                            const isThreshold = /ceo|chairman|general\s*manager|\bgm\b|\bhr\b|human\s*resource/i.test(deptName);
                            const isAtMyDesk = parseInt(detail?.targetDepartmentId) === parseInt(user?.deptId);
                            if (!isThreshold || !isAtMyDesk || req.status !== 'pending') return null;
                            return (
                              <button
                                onClick={() => approvalSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                                className="lg:hidden flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 border border-emerald-700 text-emerald-100 text-[10px] font-black transition-all animate-bounce shadow-sm shrink-0"
                                title="Go to approval panel"
                              >
                                <ArrowDownToLine size={12} />
                                <span>Click to Approve</span>
                              </button>
                            );
                          })()}
                          {/* Mobile-only: scroll to payment panel for Account dept (first-time payment) */}
                          {(() => {
                            const isAccount = /\baccount\b/i.test(user?.name || '');
                            const isAtMyDesk = parseInt(detail?.targetDepartmentId) === parseInt(user?.deptId);
                            const fas = detail?.finalApprovalStatus;
                            const readyForPayment = fas && !['none', 'treated', 'partial'].includes(fas);
                            if (!isAccount || !isAtMyDesk || !readyForPayment) return null;
                            return (
                              <button
                                onClick={() => paymentSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                                className="lg:hidden flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 border border-blue-700 text-blue-100 text-[10px] font-black transition-all animate-bounce shadow-sm shrink-0"
                                title="Go to payment panel"
                              >
                                <ArrowDownToLine size={12} />
                                <span>Set Payment</span>
                              </button>
                            );
                          })()}
                        </div>
                     </div>
                   ) : (
                     <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-600">
                             <Clock size={14} />
                          </div>
                          <div className="flex-1">
                            <p className="text-xs font-bold text-amber-700">Awaiting Approval</p>
                            <p className="text-[10px] text-amber-600/80 font-medium">{req.currentStageName || detail?.currentStage?.name}</p>
                          </div>
                          {/* Mobile-only: threshold dept scroll to approval panel via workflow stage */}
                          {(() => {
                            const deptName = user?.name || '';
                            const isThreshold = /ceo|chairman|general\s*manager|\bgm\b|\bhr\b|human\s*resource/i.test(deptName);
                            const stageRole = (detail?.currentStage?.role || '').toLowerCase();
                            const isMyStage = isThreshold && (stageRole.includes('hr') || stageRole.includes('gm') || stageRole.includes('ceo') || stageRole.includes('general manager') || stageRole.includes('human resource') || stageRole.includes('chairman'));
                            if (!isMyStage || req.status !== 'pending') return null;
                            return (
                              <button
                                onClick={() => approvalSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                                className="lg:hidden flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 border border-emerald-700 text-emerald-100 text-[10px] font-black transition-all animate-bounce shadow-sm shrink-0"
                                title="Go to approval panel"
                              >
                                <ArrowDownToLine size={12} />
                                <span>Click to Approve</span>
                              </button>
                            );
                          })()}
                        </div>
                        {detail?.currentStage?.role && (
                          <div className="text-[9px] font-black uppercase text-amber-800 tracking-widest px-2 py-0.5 bg-amber-500/20 rounded-md inline-block">
                            REQUIRED: {detail.currentStage.role}
                          </div>
                        )}
                     </div>
                   )
                 ) : req.status === 'draft' ? (
                   <div className="p-3 rounded-xl bg-muted/40 border border-border/60 flex items-center gap-2 text-muted-foreground">
                      <FileText size={16} />
                      <span className="text-xs font-bold">Draft — Not Yet Submitted</span>
                   </div>
                 ) : req.status === 'approved' ? (
                   <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2 text-emerald-700">
                      <ShieldCheck size={16} />
                      <span className="text-xs font-bold">Document Fully Authenticated</span>
                   </div>
                 ) : req.status === 'rejected' ? (
                   <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex items-center gap-2 text-destructive">
                      <AlertTriangle size={16} />
                      <span className="text-xs font-bold">Rejected</span>
                   </div>
                 ) : (
                   <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex items-center gap-2 text-destructive">
                      <AlertTriangle size={16} />
                      <span className="text-xs font-bold">Requisition Terminated</span>
                   </div>
                 )}
              </div>

              {/* 2. Items — mobile slot: after Current Status */}
              {itemsBlock && <div className="lg:hidden border-b border-border/30 pb-4">{itemsBlock}</div>}

              {/* 3. Enclosures — mobile slot: right after item table */}
              {attachments.length > 0 && (
                <div className="lg:hidden space-y-3 border-b border-border/30 pb-4">
                  <div className="flex items-center space-x-2">
                    <Paperclip size={13} className="text-primary" />
                    <p className="text-[10px] font-black text-foreground uppercase tracking-[0.1em]">Enclosures ({attachments.length})</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {attachments.map(a => (
                      <div key={a.id} className="flex items-center gap-2 p-3 bg-muted/20 rounded-xl border border-border/30 text-xs hover:border-primary/20 transition-all group">
                        <FileText size={13} className="text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-foreground font-bold text-[11px]">{a.filename}</p>
                          <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            <span className="text-[9px] text-muted-foreground font-mono">{a.size ? `${(a.size / 1024).toFixed(0)} KB` : 'N/A'}</span>
                            {(a.uploadedBy?.name || a.uploaderDept) && (
                              <span className="text-[9px] text-primary/70 font-bold uppercase tracking-wide">
                                {a.uploaderDept || a.uploadedBy?.department?.name || ''}
                                {a.uploadedBy?.name ? ` · ${a.uploadedBy.name}` : ''}
                              </span>
                            )}
                            {a.stageName && <span className="text-[9px] text-muted-foreground/60 italic">{a.stageName}</span>}
                            {a.createdAt && <span className="text-[9px] text-muted-foreground/50 font-mono">{new Date(a.createdAt).toLocaleDateString()}</span>}
                          </div>
                        </div>
                        <button onClick={() => setPreviewFile(a)} title="Preview" className="p-1.5 text-muted-foreground hover:text-primary transition-all rounded-lg hover:bg-primary/5 shrink-0"><Eye size={14} /></button>
                        <button onClick={async () => {
                          try {
                            const res = await fetch(`/api/attachments/${a.id}/download`, { credentials: 'include' });
                            if (!res.ok) throw new Error();
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const dl = document.createElement('a');
                            dl.href = url; dl.download = a.filename; document.body.appendChild(dl);
                            dl.click(); dl.remove();
                            setTimeout(() => URL.revokeObjectURL(url), 10000);
                          } catch { toast.error('Download failed.'); }
                        }} title="Download" className="p-1.5 text-muted-foreground hover:text-primary transition-all rounded-lg hover:bg-primary/5 shrink-0"><Download size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Vetting Chain History — Account's review/treatment + ICC Vets Protocol steps.
                  ICC OVERSIGHT events (freeze/unfreeze/comment) are rendered separately below —
                  those are global-observer actions, not part of the actual vetting chain, even
                  though both are stored in the same VettingEvent table. */}
              {detail?.vettingEvents?.filter(e => !/^icc_(freeze|unfreeze|comment)$/i.test(e.action || '')).length > 0 && (() => {
                const evts = detail.vettingEvents.filter(e => !/^icc_(freeze|unfreeze|comment)$/i.test(e.action || '')); // ascending from server
                const displayed = [...evts].reverse(); // newest first

                // Resolve the dept that sent to vetting (for legacy events where actorName is a user name)
                const finalApproverDeptId = detail?.finalApprovedByDeptId ? parseInt(detail.finalApprovedByDeptId) : null;
                const finalApproverDeptName = finalApproverDeptId
                  ? (departments.find(d => d.id === finalApproverDeptId)?.name || null)
                  : null;

                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.1em]">Vetting Chain</p>
                      <div className="w-5 h-5 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-600 text-[9px] font-bold">{evts.length}</div>
                    </div>
                    <div className="space-y-2">
                      {displayed.map((ev, displayIdx) => {
                        // original ascending index of this event
                        const origIdx = evts.length - 1 - displayIdx;
                        const nextEvt = evts[origIdx + 1]; // next chronologically = where it forwarded to

                        // Build the direction line
                        const isSentToVetting = ev.action === 'sent_to_vetting';
                        const isForward = ev.action === 'forward';
                        const isReturn = ev.action === 'return';
                        const isTreated = ev.action === 'treated';

                        let fromLabel, toLabel, badgeText, badgeColor, iconColor, description;

                        if (isSentToVetting) {
                          // Use finalApproverDeptName for existing records where actorName stored user's personal name
                          fromLabel = finalApproverDeptName || ev.actorName || 'System';
                          toLabel = ev.deptName;
                          badgeText = 'Vetting Started';
                          badgeColor = 'bg-indigo-100 text-indigo-700';
                          iconColor = 'bg-indigo-500';
                          description = `${fromLabel} submitted this requisition to ${toLabel} to begin the vetting review.`;
                        } else if (isForward) {
                          fromLabel = ev.deptName;
                          toLabel = nextEvt?.deptName || null;
                          badgeText = ev.vetted ? 'Vetted & Forwarded' : 'Forwarded (Unvetted)';
                          badgeColor = ev.vetted ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-600';
                          iconColor = ev.vetted ? 'bg-emerald-500' : 'bg-blue-500';
                          description = toLabel
                            ? `${fromLabel} ${ev.vetted ? 'vetted and forwarded' : 'forwarded (without vetting)'} to ${toLabel}.${ev.comment ? ` Note: "${ev.comment}"` : ''}`
                            : ev.comment || null;
                        } else if (isReturn) {
                          fromLabel = ev.deptName;
                          const prevEvt = evts[origIdx - 1];
                          // For sent_to_vetting, deptName is the RECEIVING dept — use actorName/finalApprover instead
                          if (prevEvt?.action === 'sent_to_vetting') {
                            toLabel = finalApproverDeptName || prevEvt?.actorName || null;
                          } else {
                            toLabel = prevEvt?.deptName || null;
                          }
                          badgeText = ev.vetted ? 'Returned (Vetted)' : 'Returned';
                          badgeColor = 'bg-amber-100 text-amber-700';
                          iconColor = 'bg-amber-500';
                          description = toLabel
                            ? `${fromLabel} ${ev.vetted ? '(vetted)' : ''} returned the document to ${toLabel}.${ev.comment ? ` Reason: "${ev.comment}"` : ''}`
                            : ev.comment || null;
                        } else if (isTreated) {
                          fromLabel = ev.deptName;
                          toLabel = null;
                          const disbAmt = ev.amountDisbursed != null ? parseFloat(ev.amountDisbursed) : null;
                          const reqAmt  = detail?.amount ? parseFloat(detail.amount) : null;
                          if (ev.treatmentType === 'partial') {
                            badgeText  = 'Partial Payment';
                            badgeColor = 'bg-orange-100 text-orange-700';
                            iconColor  = 'bg-orange-500';
                          } else if (ev.treatmentType === 'adjusted') {
                            badgeText  = 'Treated (Adjusted)';
                            badgeColor = 'bg-teal-100 text-teal-700';
                            iconColor  = 'bg-teal-500';
                          } else {
                            badgeText  = 'Fully Treated';
                            badgeColor = 'bg-teal-100 text-teal-700';
                            iconColor  = 'bg-teal-500';
                          }
                          const amtLine = disbAmt != null
                            ? (reqAmt != null
                                ? `Disbursed: ₦${disbAmt.toLocaleString()} of ₦${reqAmt.toLocaleString()} requested.`
                                : `Amount Recorded: ₦${disbAmt.toLocaleString()}.`)
                            : null;
                          const reasonLine = ev.treatmentReason ? `Reason: "${ev.treatmentReason}"` : null;
                          description = [
                            `${fromLabel} processed payment for this requisition.`,
                            amtLine,
                            reasonLine,
                            ev.comment ? `Note: "${ev.comment}"` : null,
                          ].filter(Boolean).join(' ');
                        } else if (ev.action === 'icc_vet_forward') {
                          fromLabel = ev.deptName || 'Account';
                          toLabel = 'ICC';
                          badgeText = 'Forwarded to ICC';
                          badgeColor = 'bg-indigo-100 text-indigo-700';
                          iconColor = 'bg-indigo-500';
                          description = `${fromLabel} forwarded this requisition to ICC for the ICC Vets Protocol review.${ev.comment ? ` Note: "${ev.comment}"` : ''}`;
                        } else if (ev.action === 'icc_vet_return') {
                          fromLabel = ev.deptName || 'ICC';
                          toLabel = 'Account';
                          badgeText = 'ICC Vetting Complete';
                          badgeColor = 'bg-emerald-100 text-emerald-700';
                          iconColor = 'bg-emerald-500';
                          description = `${fromLabel} completed vetting and returned this requisition to Account for treatment.${ev.comment ? ` Note: "${ev.comment}"` : ''}`;
                        } else if (ev.action === 'icc_comment') {
                          fromLabel = ev.deptName || 'ICC';
                          toLabel = null;
                          badgeText = 'ICC Comment';
                          badgeColor = 'bg-indigo-100 text-indigo-700';
                          iconColor = 'bg-indigo-500';
                          description = ev.comment ? `ICC Observation: "${ev.comment}"` : 'ICC posted a comment.';
                        } else if (ev.action === 'icc_freeze') {
                          fromLabel = ev.deptName || 'ICC';
                          toLabel = null;
                          badgeText = '🔒 ICC Freeze';
                          badgeColor = 'bg-red-100 text-red-700';
                          iconColor = 'bg-red-500';
                          description = ev.comment ? `Request frozen by ICC. Reason: "${ev.comment}"` : 'ICC froze this request — all actions blocked.';
                        } else if (ev.action === 'icc_unfreeze') {
                          fromLabel = ev.deptName || 'ICC';
                          toLabel = null;
                          badgeText = '🔓 ICC Unfrozen';
                          badgeColor = 'bg-emerald-100 text-emerald-700';
                          iconColor = 'bg-emerald-500';
                          description = 'ICC lifted the freeze — processing resumed.';
                        } else if (ev.action === 'forwarded_for_reapproval') {
                          fromLabel = ev.deptName;
                          toLabel = null;
                          badgeText = 'Forwarded for Re-Approval';
                          badgeColor = 'bg-amber-100 text-amber-700';
                          iconColor = 'bg-amber-500';
                          description = `${fromLabel} forwarded this requisition for re-approval after a price revision.`;
                        } else if (ev.action === 'reapproved') {
                          fromLabel = ev.deptName;
                          toLabel = null;
                          badgeText = 'Re-Approved';
                          badgeColor = 'bg-emerald-100 text-emerald-700';
                          iconColor = 'bg-emerald-500';
                          description = `${fromLabel} re-approved the revised amount — treatment can proceed.${ev.comment ? ` Note: "${ev.comment}"` : ''}`;
                        } else {
                          fromLabel = ev.deptName;
                          toLabel = null;
                          badgeText = ev.action?.replace(/_/g, ' ');
                          badgeColor = 'bg-muted text-muted-foreground';
                          iconColor = 'bg-purple-500';
                          description = ev.comment || null;
                        }

                        return (
                          <div key={ev.id || displayIdx} className={`flex gap-2.5 p-3 rounded-xl border shadow-sm ${isTreated ? 'bg-teal-50/40 border-teal-200/60' : isReturn ? 'bg-amber-50/40 border-amber-200/60' : 'bg-white border-border/30'}`}>
                            <div className={`w-6 h-6 rounded-full ${iconColor} flex items-center justify-center shrink-0 mt-0.5 shadow-sm`}>
                              {isTreated ? <CheckCircle2 size={11} className="text-white" /> :
                               isReturn ? <RotateCcw size={11} className="text-white" /> :
                               isSentToVetting ? <Send size={11} className="text-white" /> :
                               <ArrowRightCircle size={11} className="text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              {/* Direction row */}
                              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                <span className="text-[11px] font-black text-foreground">{fromLabel}</span>
                                {toLabel && (
                                  <>
                                    <ArrowRight size={10} className="text-muted-foreground/50 shrink-0" />
                                    <span className="text-[11px] font-black text-foreground">{toLabel}</span>
                                  </>
                                )}
                                <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full ${badgeColor}`}>{badgeText}</span>
                              </div>
                              {/* Description */}
                              {description && (
                                <p className="text-[10px] text-muted-foreground leading-relaxed">{description}</p>
                              )}
                              {ev.attachmentName && (() => {
                                const matchedAtt = detail?.attachments?.find(a => a.filename === ev.attachmentName);
                                return (
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <Paperclip size={9} className="text-primary/70 shrink-0" />
                                    <span className="text-[9px] text-primary/70 truncate max-w-[140px]">{ev.attachmentName}</span>
                                    {matchedAtt && (
                                      <button onClick={() => setPreviewFile(matchedAtt)} title="Preview attachment"
                                        className="p-0.5 text-muted-foreground hover:text-primary transition-all rounded shrink-0">
                                        <Eye size={10} />
                                      </button>
                                    )}
                                  </div>
                                );
                              })()}
                              {/* Timestamp */}
                              <p className="text-[8px] text-muted-foreground/50 mt-1 font-mono">
                                {ev.createdAt ? new Date(ev.createdAt).toLocaleString() : ''}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ICC Observation Log — freeze/comment/unfreeze history (global observer actions), separate from the Vetting Chain */}
              {detail?.vettingEvents?.filter(e => /^icc_(freeze|unfreeze|comment)$/i.test(e.action || '')).length > 0 && (() => {
                const iccEvts = [...detail.vettingEvents.filter(e => /^icc_(freeze|unfreeze|comment)$/i.test(e.action || ''))].reverse();
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.1em]">ICC Observation Log</p>
                      <div className="w-5 h-5 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-600 text-[9px] font-bold">{iccEvts.length}</div>
                    </div>
                    <div className="space-y-2">
                      {iccEvts.map((ev, i) => {
                        const isFreeze = ev.action === 'icc_freeze';
                        const isUnfreeze = ev.action === 'icc_unfreeze';
                        const badgeText = isFreeze ? '🔒 ICC Freeze' : isUnfreeze ? '🔓 ICC Unfrozen' : 'ICC Comment';
                        const badgeColor = isFreeze ? 'bg-red-100 text-red-700' : isUnfreeze ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700';
                        const iconColor = isFreeze ? 'bg-red-500' : isUnfreeze ? 'bg-emerald-500' : 'bg-indigo-500';
                        const description = isFreeze
                          ? (ev.comment ? `Request frozen by ICC. Reason: "${ev.comment}"` : 'ICC froze this request — all actions blocked.')
                          : isUnfreeze
                            ? 'ICC lifted the freeze — processing resumed.'
                            : (ev.comment ? `ICC Observation: "${ev.comment}"` : 'ICC posted a comment.');
                        return (
                          <div key={ev.id || i} className="flex gap-2.5 p-3 rounded-xl border border-indigo-200/60 bg-indigo-50/40 shadow-sm">
                            <div className={`w-6 h-6 rounded-full ${iconColor} flex items-center justify-center shrink-0 mt-0.5 shadow-sm`}>
                              <Eye size={11} className="text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                <span className="text-[11px] font-black text-foreground">{ev.deptName || 'ICC'}</span>
                                <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full ${badgeColor}`}>{badgeText}</span>
                              </div>
                              <p className="text-[10px] text-muted-foreground leading-relaxed">{description}</p>
                              <p className="text-[8px] text-muted-foreground/50 mt-1 font-mono">{ev.createdAt ? new Date(ev.createdAt).toLocaleString() : ''}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Processing Chain (for inter-dept) OR Approval Trail */}
              <div className="space-y-3 flex-1">
                {isInterDept && forwardEvents.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.1em]">Processing Chain</p>
                      <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[9px] font-bold">
                        {forwardEvents.length}
                      </div>
                    </div>
                    <ProcessingChain events={[...forwardEvents].reverse()} />
                  </>
                ) : timeline.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.1em]">Approval Trail</p>
                      <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[9px] font-bold">
                        {timeline.length}
                      </div>
                    </div>
                    {loading ? (
                      <div className="space-y-3 animate-pulse">
                         {[1,2,3].map(i => <div key={i} className="h-14 bg-muted/40 rounded-xl" />)}
                      </div>
                    ) : (
                      <div className="relative pl-1">
                         <ApprovalTimeline stages={timeline} />
                      </div>
                    )}
                  </>
                ) : null}
              </div>

              {/* Identity & Verification */}
              {verCode && (
                <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 space-y-2">
                  <div className="flex items-center space-x-2 text-emerald-600">
                     <ShieldCheck size={12} />
                     <p className="text-[9px] font-black uppercase tracking-widest">Digital Fingerprint</p>
                  </div>
                  <p className="font-mono text-xs font-bold text-emerald-800 break-all bg-white p-2 rounded-lg text-center border border-emerald-500/10 shadow-sm">
                    {verCode}
                  </p>
                </div>
              )}

              {/* Actions Footer */}
              <div className="pt-3 mt-auto border-t border-border/50">
                 {req.status === 'approved' && req.signedPdfKey && (
                    <button
                      onClick={() => downloadSignedPdf(req.id)}
                      className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3 rounded-xl transition-all shadow-xl shadow-primary/20 text-xs uppercase tracking-widest"
                    >
                      <Download size={14} /> Sign Voucher
                    </button>
                 )}
                 <button onClick={onClose} className="hidden lg:block w-full text-[9px] text-muted-foreground hover:text-foreground font-black uppercase tracking-[0.2em] transition-colors py-3">
                  Close Document
                 </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* File Preview Modal */}
      {previewFile && <FilePreviewModal attachment={previewFile} onClose={() => setPreviewFile(null)} />}
      {/* Print Stage Modal */}
      {printModal && <PrintStageModal req={req} detail={detail} onClose={() => setPrintModal(false)} />}
      {/* Tag Observer Modal */}
      {tagModal && (
        <TagModal
          reqId={req.id}
          departments={departments}
          onClose={() => setTagModal(false)}
          onTagged={() => getRequisitionDetail(req.id).then(d => setDetail(d))}
        />
      )}
      <ConfirmModal
        isOpen={!!pendingDeleteAttachment}
        onClose={() => setPendingDeleteAttachment(null)}
        isProcessing={deletingAttachment}
        title="Delete Attachment"
        message={`Delete "${pendingDeleteAttachment?.filename}"? This cannot be undone.`}
        onConfirm={async () => {
          setDeletingAttachment(true);
          try {
            await reqAPI.deleteAttachment(pendingDeleteAttachment.id);
            const updated = await getRequisitionDetail(req.id);
            setDetail(updated);
            toast.success('Attachment deleted.');
            setPendingDeleteAttachment(null);
          } catch (err) {
            toast.error(err?.response?.data?.error || 'Could not delete attachment.');
          } finally { setDeletingAttachment(false); }
        }}
      />
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────
const RequisitionsPage = ({ onViewChange, initialReqId, onDeepLinkConsumed }) => {
  const { user } = useAuth();
  const [requisitions, setRequisitions] = useState([]);
  const [departments, setDepartments]   = useState([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [isFormOpen, setIsFormOpen]     = useState(null);
  const [editDraft, setEditDraft]       = useState(null);
  const [selectedReq, setSelectedReq]   = useState(null);
  const [selectedIds, setSelectedIds]   = useState([]);
  const [deleting, setDeleting]         = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletePendingAction, setDeletePendingAction] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncStale, setSyncStale]       = useState(false);
  const [flashedIds, setFlashedIds]     = useState(new Set());
  const [filterView, setFilterView]     = useState(user?.role === 'global_admin' ? 'all' : 'active');
  // Starts `null` (unknown) so the Print button stays hidden until the real access list
  // loads — defaulting to `true` would flash the button then hide it when restricted.
  const [canPrint, setCanPrint]         = useState(null);
  // Super Admin's create buttons default OFF and start `null` (hidden) until the real
  // setting resolves — same flash-free pattern, since the safe default is "hidden".
  const [adminCreateFundEnabled, setAdminCreateFundEnabled]         = useState(null);
  const [adminCreateMaterialEnabled, setAdminCreateMaterialEnabled] = useState(null);
  const selectedReqRef = React.useRef(null);

  useEffect(() => {
    if (user?.role !== 'global_admin') return;
    settingsAPI.get('admin_create_fund_enabled').then(r => setAdminCreateFundEnabled(r?.value === 'true')).catch(() => setAdminCreateFundEnabled(false));
    settingsAPI.get('admin_create_material_enabled').then(r => setAdminCreateMaterialEnabled(r?.value === 'true')).catch(() => setAdminCreateMaterialEnabled(false));
  }, [user?.role]);

  // Normalize a requisition so department/creator are always strings, not nested objects.
  // isFromSubAccount and deptHeadName are already extracted by store.normalizeRequisitionList
  // before the department object is flattened — don't re-derive them here.
  // Always fetch fresh data from server — show cached instantly, then replace with live
  const openReqById = async (id, allReqs) => {
    const list = allReqs || requisitions;
    const cached = list.find(r => r.id === parseInt(id));
    if (cached && isMemoRecord(cached)) {
      onViewChange?.('memos');
      return;
    }
    if (cached) setSelectedReq(normalizeReq(cached));
    try {
      const fresh = await reqAPI.getRequisition(id);
      if (isMemoRecord(fresh)) {
        onViewChange?.('memos');
        return;
      }
      setSelectedReq(normalizeReq(fresh));
    } catch(err) {}
  };

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [data, depts, canPrintResolved] = await Promise.all([
        getOperationalRequisitions(),
        getDepartments(),
        // Falls back to the last known good cached value on a network failure, not blindly
        // to "enabled" — so a disabled Print button doesn't get exposed by a network blip.
        loadCachedFlag('canPrint', async () => {
          const res = await printSettingsAPI.getAccess();
          return res?.canPrint !== false;
        }),
      ]);
      setRequisitions(data);
      setDepartments(depts);
      setCanPrint(canPrintResolved);
      setLastSyncedAt(new Date());
      setSyncStale(false);
      if (!silent) setLoading(false);

      // Check for deep link after data loads (localStorage fallback)
      if (!silent) {
        const pendingId = localStorage.getItem('rms_pending_requisition_id');
        if (pendingId) {
          localStorage.removeItem('rms_pending_requisition_id');
          await openReqById(pendingId, data);
        }

        // Check for "open new form" intent from local-draft Continue action
        const pendingFormType = sessionStorage.getItem('rms_pending_open_request');
        if (pendingFormType) {
          sessionStorage.removeItem('rms_pending_open_request');
          setEditDraft(null);
          setIsFormOpen(pendingFormType);
        }
      }
    } catch {
      setSyncStale(true);
      if (!silent) setLoading(false);
    }
  };

  // Keep ref in sync with selectedReq state
  React.useEffect(() => { selectedReqRef.current = selectedReq; }, [selectedReq]);

  useEffect(() => { loadData(); }, []);

  // Re-fetch when the hard-refresh button is clicked or the APK comes back to foreground
  useEffect(() => {
    const onRefresh = () => loadData(true);
    window.addEventListener('globalHardRefresh', onRefresh);
    return () => window.removeEventListener('globalHardRefresh', onRefresh);
  }, []);

  // SSE real-time subscription — updates arrive within seconds of any action
  useEffect(() => {
    if (!localStorage.getItem('rms_user')) return;

    let es;
    let reconnectTimer;
    let closed = false; // tracks intentional unmount close so we don't re-schedule

    const connect = async () => {
      if (closed) return;
      try {
        const { ticket } = await reqAPI.getSseTicket();
        if (closed) return;
        es = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);
        es.addEventListener('requisition_updated', (e) => {
          const { id, action, fromDept, toDept } = JSON.parse(e.data);

          // Build a descriptive message from action metadata
          const label = (() => {
            if (!action) return `Req #${id} was updated`;
            if (action === 'forwarded')       return `📤 ${fromDept} forwarded Req #${id}${toDept ? ` → ${toDept}` : ''}`;
            if (action === 'returned')        return `↩️ ${fromDept} returned Req #${id}${toDept ? ` to ${toDept}` : ''}`;
            if (action === 'approved')        return `✅ ${fromDept} approved Req #${id}`;
            if (action === 'rejected')        return `❌ ${fromDept} rejected Req #${id}`;
            if (action === 'finally_approved') return `🏆 ${fromDept} finally approved Req #${id}`;
            if (action === 'sent_to_vetting') return `📋 Req #${id} sent to vetting${toDept ? ` → ${toDept}` : ''}`;
            if (action === 'vetting_forwarded') return `📋 ${fromDept} forwarded Req #${id} in vetting`;
            if (action === 'treated')         return `✅ ${fromDept} treated Req #${id}`;
            return `Req #${id} was updated`;
          })();

          // Silent background refresh of list
          loadData(true);
          setSyncStale(false);

          // Flash the row in the table so the user notices the change
          setFlashedIds(prev => new Set([...prev, id]));
          setTimeout(() => setFlashedIds(prev => { const s = new Set(prev); s.delete(id); return s; }), 4000);

          // If this exact req is open, fetch fresh detail immediately — no toast needed
          if (selectedReqRef.current?.id === id) {
            reqAPI.getRequisition(id).then(fresh => setSelectedReq(normalizeReq(fresh))).catch(() => {});
          } else {
            toast(label, {
              icon: null,
              duration: 5000,
              style: { fontSize: '12px', fontWeight: '600' },
              id: `req-update-${id}`
            });
          }
        });
        es.onerror = () => {
          if (closed) return;
          es.close();
          setSyncStale(true);
          reconnectTimer = setTimeout(connect, 8000);
        };
      } catch {
        if (!closed) reconnectTimer = setTimeout(connect, 15000);
      }
    };

    connect();

    // Stale timestamp updater — marks data as stale after 90 s without an update
    const staleTimer = setInterval(() => {
      setSyncStale(prev => prev || (lastSyncedAt && Date.now() - lastSyncedAt.getTime() > 90000));
    }, 30000);

    return () => {
      closed = true;
      es?.close();
      clearTimeout(reconnectTimer);
      clearInterval(staleTimer);
    };
  }, []);

  // Deep link via prop (from Dashboard eye button)
  useEffect(() => {
    if (!initialReqId || loading) return;
    openReqById(initialReqId);
    onDeepLinkConsumed?.();
  }, [initialReqId, loading]);

  // Listen for custom event so it works even if already on this page
  useEffect(() => {
    const handleOpenReq = async (e) => {
      await openReqById(e.detail);
    };
    window.addEventListener('openRequisition', handleOpenReq);
    return () => window.removeEventListener('openRequisition', handleOpenReq);
  }, [requisitions]);

  // Open a draft directly in edit form (from navbar drafts popover or auto-save)
  useEffect(() => {
    const handleOpenDraftEdit = async (e) => {
      const { id, type: draftType } = e.detail || {};
      if (!id) return;
      try {
        const { getRequisitionDetail } = await import('../lib/store');
        const draft = await getRequisitionDetail(id);
        if (!draft) return;
        setEditDraft(draft);
        setIsFormOpen(draftType || draft.type || 'Cash');
      } catch { /* ignore */ }
    };
    window.addEventListener('rms:openDraftEdit', handleOpenDraftEdit);
    return () => window.removeEventListener('rms:openDraftEdit', handleOpenDraftEdit);
  }, []);

  // Open a fresh form for a local autosave (CashRequestForm restores from localStorage automatically)
  useEffect(() => {
    const handleOpenNewRequest = (e) => {
      const { type } = e.detail || {};
      setEditDraft(null);
      setIsFormOpen(type || 'Cash');
    };
    window.addEventListener('rms:openNewRequest', handleOpenNewRequest);
    return () => window.removeEventListener('rms:openNewRequest', handleOpenNewRequest);
  }, []);

  const isActiveForMe = (r) => {
    if (!user?.deptId) return true;
    const deptId = Number(user.deptId);
    if (Number(r.departmentId) === deptId) return true;           // creator always sees own requests
    // Terminal requests have no pending action — non-creators don't see them as "active"
    const fas = (r.finalApprovalStatus || '').toLowerCase();
    if (fas === 'treated' || fas === 'published') return false;
    if (Number(r.targetDepartmentId) === deptId) return true;     // currently at my desk
    if (r.currentVettingDeptId && Number(r.currentVettingDeptId) === deptId) return true; // vetting
    // Sub-unit requests — only show to the actual parent dept, not every non-sub-account dept
    if (r.isFromSubAccount && !user?.isSubAccount && Number(r.parentDeptId) === deptId) return true;
    // Parent dept shared this request with this sub-account (backend already enforced visibility)
    if (user?.isSubAccount && user?.parentDeptId && Number(r.departmentId) === Number(user.parentDeptId)) return true;
    return false;
  };

  const filtered = requisitions.filter(r => {
    if (isMemoRecord(r)) return false;
    if (filterView === 'active' && user?.role !== 'global_admin') {
      if (!isActiveForMe(r)) return false;
    }
    const q = search.toLowerCase();
    const matchSearch  = !q
      || String(r.id).includes(q)
      || r.refCode?.toLowerCase().includes(q)
      || r.type?.toLowerCase().includes(q)
      || r.title?.toLowerCase().includes(q)
      || String(r.amount || '').includes(q);
    const matchStatus  = filterStatus === 'all' || r.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const isIncoming = (r) => user?.deptId && r.targetDepartmentId === user.deptId;
  const isAdmin = user?.role === 'global_admin';

  const toggleSelect = (id) => {
    setSelectedIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  };

  const toggleAll = () => {
    if (selectedIds.length === filtered.length) setSelectedIds([]);
    else setSelectedIds(filtered.map(r => r.id));
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      await reqAPI.deleteMultipleRequisitions(selectedIds);
      toast.success('Records fully purged from the entire system!');
      setSelectedIds([]);
      await loadData();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not delete the selected records. Please try again.');
    } finally {
      setDeleting(false);
      setIsDeleteModalOpen(false);
      setDeletePendingAction(null);
    }
  };

  const handleSingleDelete = async () => {
    if (!deletePendingAction?.id) return;
    setDeleting(true);
    try {
      await reqAPI.deleteRequisition(deletePendingAction.id);
      toast.success(`Record #${deletePendingAction.id} purged globally!`);
      await loadData();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not delete this record. Please try again.');
    } finally {
      setDeleting(false);
      setIsDeleteModalOpen(false);
      setDeletePendingAction(null);
    }
  };

  const showBulkDeleteConfirm = () => {
    setDeletePendingAction({ type: 'bulk' });
    setIsDeleteModalOpen(true);
  };

  const showSingleDeleteConfirm = (id, e) => {
    e.stopPropagation();
    setDeletePendingAction({ type: 'single', id });
    setIsDeleteModalOpen(true);
  };

  return (
    <>
      <ConfirmModal 
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={deletePendingAction?.type === 'bulk' ? handleBulkDelete : handleSingleDelete}
        isProcessing={deleting}
        title={deletePendingAction?.type === 'bulk' ? "Bulk Purge System Records" : `Delete Record #${deletePendingAction?.id}`}
        message={deletePendingAction?.type === 'bulk' 
          ? `Are you sure you want to permanently delete ${selectedIds.length} selected records? This cannot be undone and will remove them from all logs.`
          : `Are you sure you want to permanently delete Requisition #${deletePendingAction?.id}? This action is immutable.`
        }
      />
      {isFormOpen ? (
        <CashRequestForm
          type={isFormOpen}
          isOpen={!!isFormOpen}
          editDraft={editDraft}
          onClose={() => { setIsFormOpen(null); setEditDraft(null); loadData(); }}
        />
      ) : selectedReq ? (
        <RequisitionDetailModal
          req={selectedReq}
          user={user}
          departments={departments}
          canPrint={canPrint}
          onClose={() => setSelectedReq(null)}
          onAction={(actionType, updatedReq) => {
            if (actionType === 'refreshed' && updatedReq) {
              // In-place update — keep modal open, no reload, instant
              setRequisitions(prev => prev.map(r => r.id === updatedReq.id ? { ...r, ...updatedReq } : r));
              setSelectedReq(prev => prev ? { ...prev, ...updatedReq } : prev);
              return;
            }
            setSelectedReq(null);
            loadData(true); // always silent — no loading spinner on action
          }}
          onEditDraft={(req) => {
            if (/^memo/i.test(req.type)) return; // Memo drafts handled in Memo page
            setEditDraft(req);
            setIsFormOpen(req.type);
            setSelectedReq(null);
          }}
        />
      ) : (
      <div className="max-w-full mx-auto space-y-5 pb-20 animate-slide-up">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 px-2">
          <div className="space-y-1">
             <div className="flex items-center gap-2 mb-1">
              <div className="px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-[9px] font-black text-primary uppercase tracking-widest flex items-center gap-1">
                <div className="w-1 h-1 bg-primary rounded-full animate-pulse" />
                Administrative Registry
              </div>
            </div>
            <h1 className="text-3xl font-black text-foreground tracking-tighter">
              Requisition <span className="text-primary italic font-serif">Directory</span>
            </h1>
            <p className="text-muted-foreground text-[12px] font-medium tracking-tight">Managing {filtered.length} synchronized cash and material records.</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <button
                onClick={showBulkDeleteConfirm}
                disabled={deleting}
                className="bg-rose-500/10 hover:bg-rose-500 text-rose-600 hover:text-white border border-rose-500/20 font-black py-3 px-5 rounded-2xl transition-all shadow-lg flex items-center gap-2 active:scale-95"
              >
                {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                <span className="uppercase tracking-widest text-[10px]">Purge {selectedIds.length} Units</span>
              </button>
            )}
            {(!isAdmin || adminCreateFundEnabled || adminCreateMaterialEnabled) && (
              <div className="flex items-center gap-2">
                {(!isAdmin || adminCreateFundEnabled) && (
                  <button
                    onClick={() => setIsFormOpen('Cash')}
                    className="bg-primary hover:bg-primary/90 text-white font-black py-3 px-5 rounded-2xl transition-all shadow-lg shadow-primary/20 flex items-center gap-2 active:scale-95 text-[10px] uppercase tracking-widest"
                  >
                    <Plus size={16} /> Fund Request
                  </button>
                )}
                {(!isAdmin || adminCreateMaterialEnabled) && (
                  <button
                    onClick={() => setIsFormOpen('Material')}
                    className="bg-foreground hover:bg-foreground/90 text-background font-black py-3 px-5 rounded-2xl transition-all shadow-lg flex items-center gap-2 active:scale-95 text-[10px] uppercase tracking-widest"
                  >
                    <Plus size={16} /> Material Request
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sync status indicator */}
        {syncStale && lastSyncedAt && (
          <div className="flex items-center gap-2 text-[10px] text-amber-600 font-bold px-1">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            Offline — showing data as of {lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}

        {/* Unified Main Card */}
        <div className="glass bg-white/70 backdrop-blur-3xl rounded-[2rem] border border-border/40 p-1 shadow-2xl shadow-primary/5 overflow-hidden">
          <div className="bg-[#FAF9F6]/30 rounded-[1.8rem] p-4 lg:p-6 space-y-5">
            {/* Filters Row */}
            <div className="flex flex-col xl:flex-row items-stretch xl:items-center gap-4 border-b border-border/20 pb-5">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by S/N, reference, type, registry item, or amount…"
                  className="w-full bg-white border border-border/50 rounded-xl py-3 pl-12 pr-4 text-sm font-bold text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-4 focus:ring-primary/10 transition-all shadow-sm"
                />
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 xl:pb-0 custom-scrollbar whitespace-nowrap">
                {/* View toggle — Active (at-desk) vs All Records (history) */}
                {!isAdmin && (
                  <div className="flex items-center rounded-lg border border-border/50 overflow-hidden mr-1 shrink-0">
                    {[
                      { key: 'active', label: 'Active' },
                      { key: 'all',    label: 'All Records' },
                    ].map(({ key, label }) => (
                      <button key={key} onClick={() => setFilterView(key)}
                        className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
                          filterView === key
                            ? 'bg-primary text-white'
                            : 'bg-white text-muted-foreground hover:bg-muted'
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {['all', 'pending', 'approved', 'rejected', 'draft'].map(s => (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all active:scale-95 ${
                      filterStatus === s
                        ? 'bg-primary border-primary text-white shadow-lg shadow-primary/20'
                        : 'bg-white border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Directory Table */}
            {loading ? (
              <div className="py-20 flex flex-col items-center justify-center space-y-3">
                <Loader2 size={32} className="text-primary animate-spin opacity-20" />
                <p className="text-xs font-black text-muted-foreground uppercase tracking-widest animate-pulse">Syncing Directory Access...</p>
              </div>
            ) : (
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-separate border-spacing-y-1">
                  <thead>
                    <tr className="text-muted-foreground text-[9px] font-black uppercase tracking-[0.2em]">
                      <th className="pb-3 px-4 w-8">
                        <input type="checkbox" className="rounded-md border-border/50 text-primary focus:ring-primary" checked={filtered.length > 0 && selectedIds.length === filtered.length} onChange={toggleAll} />
                      </th>
                      <th className="pb-3 px-4">S/N</th>
                      <th className="pb-3 px-4">Reference</th>
                      <th className="pb-3 px-4">Module Type</th>
                      <th className="pb-3 px-4">Registry Item</th>
                      <th className="pb-3 px-4">Payload</th>
                      <th className="pb-3 px-4">Authorization Trail</th>
                      <th className="pb-3 px-4">State</th>
                      <th className="pb-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => {
                      const isMoneyReq = r.type === 'Cash' || (r.amount && r.amount > 0);
                      return (
                      <tr
                        key={r.id}
                        onClick={() => setSelectedReq(normalizeReq(r))}
                        className={`group cursor-pointer transition-all ${flashedIds.has(r.id) ? 'animate-pulse ring-2 ring-primary/30 ring-inset rounded-xl' : ''}`}
                      >
                        <td className="py-3 px-4 bg-white/50 border-y border-l border-border/30 rounded-l-xl group-hover:bg-white transition-colors" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" className="rounded-md border-border/50 text-primary focus:ring-primary" checked={selectedIds.includes(r.id)} onChange={() => toggleSelect(r.id)} />
                        </td>
                        <td className="py-3 px-4 bg-white/50 border-y border-border/30 group-hover:bg-white transition-colors">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black text-primary tracking-widest"><Highlight text={`#${r.id}`} query={search} /></span>
                            <span className="text-[9px] text-muted-foreground/60 font-mono italic">{new Date(r.createdAt).toLocaleDateString()}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 bg-white/50 border-y border-border/30 group-hover:bg-white transition-colors max-w-[180px]">
                          {r.refCode ? (
                            <span className="text-[9px] font-mono font-bold text-primary/80 tracking-tight break-all"><Highlight text={r.refCode} query={search} /></span>
                          ) : (
                            <span className="text-[9px] text-muted-foreground/30 italic">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 bg-white/50 border-y border-border/30 group-hover:bg-white transition-colors">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${
                              r.type === 'Cash' ? 'bg-emerald-500 shadow-emerald-500/20'
                              : r.type === 'Material' ? 'bg-primary shadow-primary/20'
                              : 'bg-amber-500 shadow-amber-500/20'
                            } shadow-lg`} />
                            <span className="text-[10px] font-black text-foreground uppercase tracking-widest"><Highlight text={r.type} query={search} /></span>
                          </div>
                        </td>
                        <td className="py-3 px-4 bg-white/50 border-y border-border/30 group-hover:bg-white transition-colors">
                          <div className="space-y-0.5">
                            <p className="text-[12px] font-bold text-foreground max-w-xs truncate"><Highlight text={r.title} query={search} /></p>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {r.urgency && r.urgency !== 'normal' && (
                                <div className={`flex items-center gap-1 text-[9px] font-black uppercase ${urgencyColors[r.urgency]}`}>
                                  <div className={`w-1 h-1 rounded-full ${r.urgency === 'critical' ? 'bg-red-500' : 'bg-amber-500'} animate-pulse`} />
                                  {r.urgency} Priority
                                </div>
                              )}
                              {r.tags?.some(t => t.deptId === user?.deptId) && (
                                <span className="flex items-center gap-0.5 text-[8px] font-black uppercase text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                  <Paperclip size={7} /> CC'd
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 bg-white/50 border-y border-border/30 group-hover:bg-white transition-colors">
                          {isMoneyReq ? (() => {
                            const eff = getEffectiveAmount(r);
                            if (eff.source === 'icc') {
                              return (
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[12px] font-black text-teal-700 font-mono">₦{eff.amount.toLocaleString()}</span>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[9px] text-muted-foreground/50 font-mono line-through">₦{eff.supersededAmount.toLocaleString()}</span>
                                    <span className="px-1 py-0.5 rounded text-[7px] font-black bg-teal-100 border border-teal-200 text-teal-700 uppercase tracking-wide">ICC</span>
                                  </div>
                                </div>
                              );
                            }
                            if (eff.source === 'audit') {
                              return (
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[12px] font-black text-purple-700 font-mono">₦{eff.amount.toLocaleString()}</span>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[9px] text-muted-foreground/50 font-mono line-through">₦{eff.supersededAmount.toLocaleString()}</span>
                                    <span className="px-1 py-0.5 rounded text-[7px] font-black bg-purple-100 border border-purple-200 text-purple-600 uppercase tracking-wide">Audit</span>
                                  </div>
                                </div>
                              );
                            }
                            return (
                              <span className={`text-[12px] font-black text-foreground font-mono ${search && String(r.amount || '').includes(search) ? 'bg-yellow-200 text-yellow-900 rounded-sm px-0.5' : ''}`}>₦{eff.amount.toLocaleString()}</span>
                            );
                          })() : (
                            <span className="text-[10px] text-muted-foreground/50 italic">Non-financial</span>
                          )}
                        </td>
                        <td className="py-3 px-4 bg-white/50 border-y border-border/30 group-hover:bg-white transition-colors">
                          <div className="flex items-center gap-1.5 text-[10px]">
                            <span className="font-bold text-muted-foreground opacity-60 uppercase">{r.department}</span>
                            {r.isFromSubAccount && (() => {
                              const subDept = departments.find(d => d.id === r.departmentId);
                              const parentDept = subDept?.parentId ? departments.find(d => d.id === subDept.parentId) : null;
                              const pName = parentDept?.name || r.parentDeptName || null;
                              return pName ? (
                                <span className="px-1.5 py-0.5 rounded-full bg-violet-100 border border-violet-200 text-violet-700 text-[8px] font-black tracking-widest uppercase">{pName}</span>
                              ) : null;
                            })()}
                            {(() => {
                              const trailDept = getLiveTrailDepartment(r, departments);
                              return trailDept?.name ? (
                                <>
                                  <ArrowRight size={9} className="text-muted-foreground/30" />
                                  <span className="font-black text-primary uppercase tracking-tight">{trailDept.name}</span>
                                </>
                              ) : null;
                            })()}
                            {r.treatedByDept?.name && r.treatedByDept.name !== r.targetDepartment?.name && (
                              <>
                                <ArrowRight size={9} className="text-muted-foreground/30" />
                                <span className="font-black text-teal-600 uppercase tracking-tight">{r.treatedByDept.name}</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 bg-white/50 border-y border-border/30 group-hover:bg-white transition-colors">
                          <div className="flex flex-col gap-1">
                            {(() => {
                              const norm = normalizeReq(r);
                              const details = (() => {
                                if (norm.status === 'draft') return { label: 'Draft', color: statusColors.draft };
                                if (norm.status === 'rejected') return { label: 'Rejected', color: statusColors.rejected };
                                
                                // Sub-workflow Statuses
                                if (norm.finalState === 'published') return { label: 'Published', color: statusColors.published };
                                if (norm.finalState === 'treated') {
                                  const tbId = r.treatedByDeptId ? parseInt(r.treatedByDeptId) : null;
                                  const tbName = tbId ? departments.find(d => d.id === tbId)?.name : null;
                                  const isMat = /^material/i.test(r.type || '');
                                  return { label: isMat ? 'Issued' : 'Treated', color: statusColors.treated, sub: tbName ? `by ${tbName}` : null };
                                }
                                if (norm.finalState === 'vetting') {
                                  const cvId = r.currentVettingDeptId ? parseInt(r.currentVettingDeptId) : null;
                                  const cvDeptName = cvId ? departments.find(d => d.id === cvId)?.name : null;
                                  return { label: 'Vetting', color: statusColors.vetting, sub: cvDeptName ? `now in ${cvDeptName}` : null };
                                }
                                if (norm.finalState === 'approved' && norm.status === 'approved') return { label: 'Final Approved', color: statusColors.approved };

                                // Finally approved but not yet routed to vetting / issuance
                                if (norm.finalState === 'approved' && norm.status === 'pending') {
                                  const faId = r.finalApprovedByDeptId ? parseInt(r.finalApprovedByDeptId) : null;
                                  const faName = faId ? departments.find(d => d.id === faId)?.name : null;
                                  const isMat = /^material/i.test(r.type || '');
                                  return {
                                    label: 'Approved',
                                    color: 'bg-emerald-50 border-emerald-300 text-emerald-700',
                                    sub:   faName ? `by ${faName} — ${isMat ? 'awaiting issuance' : 'awaiting vetting'}` : (isMat ? 'Awaiting issuance' : 'Awaiting vetting')
                                  };
                                }

                                if (norm.status === 'approved') return { label: 'Approved (Internal)', color: statusColors.approved };

                                if (norm.status === 'pending') {
                                  return {
                                    label:  norm.currentStageName ? `At: ${norm.currentStageName}` : 'Pending',
                                    color:  statusColors.pending,
                                    sub:    norm.currentStageName ? 'Review Pending' : null
                                  };
                                }
                                return { label: norm.status, color: statusColors.pending };
                              })();

                              return (
                                <>
                                  <span className={`w-fit px-2 py-0.5 rounded-lg text-[9px] font-black uppercase border tracking-widest ${details.color}`}>
                                    {details.label}
                                  </span>
                                  {details.sub && (
                                    <span className="text-[8px] font-bold text-muted-foreground/60 uppercase tracking-tighter truncate max-w-[100px]">
                                      {details.sub}
                                    </span>
                                  )}
                                  {r.isKIV && (
                                    <span className="w-fit flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-black uppercase border tracking-widest bg-violet-50 border-violet-200 text-violet-700">
                                      <BookMarked size={7} /> KIV
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="py-3 px-4 bg-white/50 border-y border-r border-border/30 rounded-r-xl group-hover:bg-white transition-colors text-right">
                          <div className="flex justify-end gap-1.5">
                             <button className="p-2 bg-background shadow-inner rounded-lg text-primary transition-all active:scale-90 border border-primary/10">
                               <Eye size={16} />
                             </button>
                             {(() => {
                               const isLocked = ['treated','published','approved'].includes(r.finalApprovalStatus);
                               const canDel = isAdmin || (Number(r.departmentId) === Number(user?.deptId) && !isLocked);
                               return canDel ? (
                                 <button onClick={e => { e.stopPropagation(); showSingleDeleteConfirm(r.id, e); }} className="p-2 bg-red-50 shadow-inner rounded-lg text-red-500 transition-all active:scale-90 border border-red-200/50">
                                   <Trash2 size={16} />
                                 </button>
                               ) : null;
                             })()}
                          </div>
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
                {filtered.length === 0 && (
                  <div className="py-20 text-center space-y-3 bg-white/20 rounded-2xl border border-dashed border-border/50">
                    <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mx-auto text-muted-foreground/30">
                      <FileText size={28} />
                    </div>
                    <p className="text-sm font-bold text-muted-foreground">No cash or material requisitions found.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </>
  );
};

export default RequisitionsPage;
