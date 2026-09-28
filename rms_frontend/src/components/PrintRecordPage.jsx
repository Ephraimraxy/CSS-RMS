import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Printer, Download, Eye, FileText, Loader2, X, ChevronDown, ChevronUp } from 'lucide-react';
import { reqAPI } from '../lib/api';
import { downloadDynamicPdf } from '../lib/store';
import { toast } from 'react-hot-toast';

const PrintRecordPage = ({ reqId, onBack }) => {
  const [req, setReq] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedStage, setSelectedStage] = useState('all');
  const [generating, setGenerating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewFileUrl, setPreviewFileUrl] = useState(null);
  const [previewFileName, setPreviewFileName] = useState(null);
  const iframeRef = useRef(null);

  useEffect(() => {
    if (!reqId) return;
    setLoading(true);
    reqAPI.getRequisition(reqId)
      .then(data => {
        setReq(data);
        setDetail(data);
      })
      .catch(() => toast.error('Failed to load record.'))
      .finally(() => setLoading(false));
  }, [reqId]);

  // Revoke preview blob URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (previewFileUrl) URL.revokeObjectURL(previewFileUrl);
    };
  }, [previewUrl, previewFileUrl]);

  const attachments = detail?.attachments || [];

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

  const getRelevantAttachments = (stageId) => {
    if (stageId === 'all') return attachments;
    const byKey = attachments.filter(a => a.stageKey === stageId);
    if (byKey.length > 0) return byKey;
    const stage = stages.find(s => s.id === stageId);
    if (!stage) return attachments;
    const cutoff = new Date(stage.rawDate).getTime();
    return attachments.filter(a => new Date(a.createdAt).getTime() <= cutoff);
  };

  const relevantAttachments = getRelevantAttachments(selectedStage);

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
      await downloadDynamicPdf(reqId, stageParam);
      if (relevantAttachments.length > 0) {
        for (let i = 0; i < relevantAttachments.length; i++) {
          await new Promise(r => setTimeout(r, i * 300));
          triggerAttachmentDownload(relevantAttachments[i]);
        }
        toast.success(`Report + ${relevantAttachments.length} attachment(s) downloaded.`, { id: toastId });
      } else {
        toast.success('Report downloaded successfully!', { id: toastId });
      }
    } catch {
      toast.error('Failed to generate report.', { id: toastId });
    } finally { setGenerating(false); }
  };

  const handlePreview = async () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setPreviewing(true);
    const toastId = toast.loading('Generating preview...');
    try {
      const stageParam = selectedStage === 'all' ? null : selectedStage;
      const blob = await reqAPI.getDynamicPdf(reqId, stageParam);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      toast.success('Preview ready!', { id: toastId });
    } catch {
      toast.error('Preview failed. Server busy.', { id: toastId });
    } finally { setPreviewing(false); }
  };

  const handlePreviewAttachment = async (a) => {
    try {
      const res = await fetch(`/api/attachments/${a.id}/download`, { credentials: 'include' });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (previewFileUrl) URL.revokeObjectURL(previewFileUrl);
      setPreviewFileUrl(url);
      setPreviewFileName(a.filename);
    } catch { toast.error('Could not preview file.'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!req) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-muted-foreground">Record not found.</p>
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-bold">
          <ArrowLeft size={16} /> Back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border/30 px-4 sm:px-8 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border/50 bg-white text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:bg-muted transition-all active:scale-95"
          >
            <ArrowLeft size={13} /> Back
          </button>
          <div className="flex items-center gap-2">
            <Printer size={16} className="text-primary" />
            <div>
              <p className="text-xs font-black text-foreground uppercase tracking-widest">Generate Report</p>
              <p className="text-[10px] text-muted-foreground truncate max-w-xs">{req.title} — #{req.id}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePreview}
            disabled={generating || previewing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border/60 bg-white hover:bg-muted text-foreground font-bold transition-all disabled:opacity-50 text-[10px] uppercase tracking-widest active:scale-95"
          >
            {previewing ? <Loader2 size={14} className="animate-spin text-primary" /> : <Eye size={14} className="text-primary" />}
            {previewing ? 'Building...' : 'Preview'}
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating || previewing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold transition-all disabled:opacity-50 text-[10px] uppercase tracking-widest shadow-sm active:scale-95"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {generating ? 'Generating...' : 'Download'}
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-0 h-[calc(100vh-57px)]">
        {/* Left panel — stage selector */}
        <div className="lg:w-80 xl:w-96 shrink-0 border-r border-border/30 overflow-y-auto bg-background/50">
          <div className="p-4 border-b border-border/20">
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1">Select Scope</p>
            <p className="text-[11px] text-muted-foreground/70">Choose which stage of the record to print. Attachments will be included automatically.</p>
          </div>

          <div className="p-3 space-y-2">
            {/* All stages option */}
            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${selectedStage === 'all' ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-primary/30'}`}>
              <input type="radio" name="stage" value="all" checked={selectedStage === 'all'} onChange={() => setSelectedStage('all')} className="mt-0.5 accent-primary" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-bold text-foreground block">Full Report (All Stages)</span>
                <p className="text-[10px] text-muted-foreground">Complete document with all actions and signatures</p>
              </div>
              {attachments.length > 0 && (
                <span className="text-[9px] font-black text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0 mt-0.5">
                  +{attachments.length} file{attachments.length > 1 ? 's' : ''}
                </span>
              )}
            </label>

            {stages.map(s => {
              const stageFiles = getRelevantAttachments(s.id);
              return (
                <label key={s.id} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${selectedStage === s.id ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-primary/30'}`}>
                  <input type="radio" name="stage" value={s.id} checked={selectedStage === s.id} onChange={() => setSelectedStage(s.id)} className="mt-0.5 accent-primary" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-foreground block truncate">{s.label}</span>
                    <p className="text-[10px] text-muted-foreground">{s.date}</p>
                  </div>
                  {stageFiles.length > 0 && (
                    <span className="text-[9px] font-black text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0 mt-0.5">
                      +{stageFiles.length} file{stageFiles.length > 1 ? 's' : ''}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {/* Attachments list for selected scope */}
          {relevantAttachments.length > 0 && (
            <div className="p-3 border-t border-border/20">
              <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-2">Attachments in scope</p>
              <div className="space-y-1.5">
                {relevantAttachments.map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-[10px] bg-muted/30 rounded-lg px-2.5 py-1.5">
                    <FileText size={10} className="text-primary shrink-0" />
                    <span className="flex-1 truncate text-foreground font-medium">{a.filename}</span>
                    {a.uploaderDept && <span className="text-muted-foreground/60 shrink-0 font-bold text-[9px]">{a.uploaderDept}</span>}
                    <button
                      onClick={() => handlePreviewAttachment(a)}
                      title="Preview"
                      className="p-0.5 text-muted-foreground hover:text-primary rounded transition-colors shrink-0"
                    >
                      <Eye size={10} />
                    </button>
                    <button
                      onClick={() => triggerAttachmentDownload(a)}
                      title="Download"
                      className="p-0.5 text-muted-foreground hover:text-primary rounded transition-colors shrink-0"
                    >
                      <Download size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right panel — preview area */}
        <div className="flex-1 flex flex-col bg-muted/20 overflow-hidden">
          {previewFileUrl ? (
            /* Attachment preview */
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between px-4 py-2 bg-background border-b border-border/30">
                <span className="text-[11px] font-bold text-foreground truncate">{previewFileName}</span>
                <button onClick={() => { URL.revokeObjectURL(previewFileUrl); setPreviewFileUrl(null); setPreviewFileName(null); }} className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors">
                  <X size={14} />
                </button>
              </div>
              <iframe
                src={previewFileUrl}
                className="flex-1 w-full border-0"
                title={previewFileName}
              />
            </div>
          ) : previewUrl ? (
            /* Report PDF preview */
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between px-4 py-2 bg-background border-b border-border/30">
                <div className="flex items-center gap-2">
                  <FileText size={13} className="text-primary" />
                  <span className="text-[11px] font-bold text-foreground">Report Preview — {selectedStage === 'all' ? 'Full Report' : stages.find(s => s.id === selectedStage)?.label || selectedStage}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-primary text-white text-[10px] font-black uppercase tracking-widest hover:bg-primary/90 transition-all disabled:opacity-50 active:scale-95"
                  >
                    {generating ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    Download
                  </button>
                  <button onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }} className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors">
                    <X size={14} />
                  </button>
                </div>
              </div>
              <iframe
                ref={iframeRef}
                src={previewUrl}
                className="flex-1 w-full border-0"
                title="Report Preview"
              />
            </div>
          ) : (
            /* Placeholder */
            <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center px-6">
              <div className="w-20 h-20 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center">
                <Printer size={32} className="text-primary/40" />
              </div>
              <div className="space-y-2 max-w-xs">
                <p className="text-sm font-bold text-foreground">Select a scope, then preview</p>
                <p className="text-xs text-muted-foreground">Choose a stage from the left panel and click Preview to see the report before downloading. The report will appear here inline — no popup.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePreview}
                  disabled={previewing}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border/60 bg-white hover:bg-muted text-foreground font-bold transition-all disabled:opacity-50 text-[11px] uppercase tracking-widest active:scale-95 shadow-sm"
                >
                  {previewing ? <Loader2 size={15} className="animate-spin text-primary" /> : <Eye size={15} className="text-primary" />}
                  {previewing ? 'Building preview...' : 'Preview Report'}
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold transition-all disabled:opacity-50 text-[11px] uppercase tracking-widest shadow-md active:scale-95"
                >
                  {generating ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  {generating ? 'Generating...' : 'Download'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PrintRecordPage;
