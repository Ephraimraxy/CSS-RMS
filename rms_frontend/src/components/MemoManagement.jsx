import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getMemoRecords, getDepartments, getRequisitionDetail, uploadAttachments } from '../lib/store';
import { forwardAPI, memoAPI, reqAPI, settingsAPI } from '../lib/api';
import { toast } from 'react-hot-toast';
import ConfirmModal from './ConfirmModal';
import {
  FileText, Send, Clock, CheckCircle2, Plus, X,
  ArrowRightCircle, Globe, ChevronRight, Loader2,
  ArrowLeft, RotateCcw, EyeOff, Calendar, Paperclip, Eye, Trash2
} from 'lucide-react';

const statusColors = {
  pending:  'bg-amber-50 border-amber-200 text-amber-700',
  approved: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  rejected: 'bg-red-50 border-red-200 text-red-700',
  draft:    'bg-muted border-border text-muted-foreground',
};

// ── Memo Create Form ──────────────────────────────────────────────────────────
const MemoCreateForm = ({ user, departments, onClose, onCreated, editDraft = null }) => {
  const deptName = user?.name || '';
  const isHR  = /\bhr\b|human\s*resource/i.test(deptName);
  const isGM  = /general\s*manager|\bgm\b/i.test(deptName);
  const isCEO = /ceo|chairman/i.test(deptName);
  const isPublisher = isHR || isGM || isCEO;
  const isEditing = !!editDraft;

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [targetMode, setTargetMode] = useState('dept'); // 'dept' | 'publish'
  const [targetDeptId, setTargetDeptId] = useState('');
  const [files, setFiles] = useState([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef(null);

  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const addFiles = (newFiles) => {
    const oversized = [];
    const valid = [];
    Array.from(newFiles).forEach(f => {
      if (f.size > MAX_FILE_BYTES) oversized.push(f.name);
      else valid.push(f);
    });
    if (oversized.length) toast.error(`File${oversized.length > 1 ? 's' : ''} too large (max 10 MB): ${oversized.join(', ')}`);
    if (valid.length) {
      setFiles(prev => {
        const existing = new Set(prev.map(f => f.name + f.size));
        return [...prev, ...valid.filter(f => !existing.has(f.name + f.size))];
      });
    }
    setFileInputKey(k => k + 1);
  };
  const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx));

  // Autosave key (skipped when editing a server draft)
  const lsKey = `rms_autosave_Memo_${user?.deptId || 'x'}`;

  // Save to localStorage on every change (new forms only)
  useEffect(() => {
    if (isEditing) return;
    if (!subject.trim() && !message.trim()) return;
    try { localStorage.setItem(lsKey, JSON.stringify({ subject, message, targetMode, targetDeptId, savedAt: Date.now() })); }
    catch { /* storage full */ }
  }, [subject, message, targetMode, targetDeptId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore only when user explicitly clicked "Continue editing" (flag set by Layout)
  useEffect(() => {
    if (isEditing) return;
    if (sessionStorage.getItem('rms_restore_Memo') !== '1') return;
    sessionStorage.removeItem('rms_restore_Memo');
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) return;
      const snap = JSON.parse(raw);
      if (Date.now() - (snap.savedAt || 0) > 86400000) { localStorage.removeItem(lsKey); return; }
      if (snap.subject) setSubject(snap.subject);
      if (snap.message) setMessage(snap.message);
      if (snap.targetMode) setTargetMode(snap.targetMode);
      if (snap.targetDeptId) setTargetDeptId(snap.targetDeptId);
      localStorage.removeItem(lsKey);
      window.dispatchEvent(new CustomEvent('rms:draftSaved'));
    } catch { /* corrupt */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter target options per routing rules
  const targetOptions = departments.filter(d => {
    if (d.id === user?.deptId) return false;
    if (!isPublisher) return /\bhr\b|human\s*resource/i.test(d.name); // regular → HR only
    if (isHR)  return /general\s*manager|\bgm\b|ceo|chairman/i.test(d.name);
    if (isGM)  return /ceo|chairman/i.test(d.name);
    return false; // CEO/Chairman can only publish
  });

  // Pre-populate from draft or auto-select single target
  useEffect(() => {
    if (editDraft) {
      setSubject(editDraft.title || '');
      setMessage(editDraft.description || '');
      if (editDraft.targetDepartmentId) setTargetDeptId(String(editDraft.targetDepartmentId));
    } else if (!isPublisher && targetOptions.length === 1 && !targetDeptId) {
      setTargetDeptId(String(targetOptions[0].id));
    }
  }, [departments, editDraft?.id]);

  const handleSubmit = async () => {
    if (!subject.trim()) { toast.error('Subject is required'); return; }
    if (!message.trim()) { toast.error('Message body is required'); return; }
    if (targetMode === 'dept' && !targetDeptId && !isCEO) {
      toast.error('Please select a target department'); return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: subject, description: message, type: 'Memo',
        ...(user?.deptId != null && { departmentId: user.deptId }),
        ...(targetMode === 'dept' && targetDeptId ? { targetDepartmentId: parseInt(targetDeptId) } : {}),
      };

      let savedId;
      if (isEditing) {
        await reqAPI.updateRequisition(editDraft.id, payload);
        savedId = editDraft.id;
      } else {
        const { addRequisition } = await import('../lib/store');
        const result = await addRequisition(payload);
        savedId = Array.isArray(result) ? result[0]?.id : result?.id;
      }

      if (savedId && files.length > 0) {
        try { await uploadAttachments(savedId, files, { uploaderDept: user?.name, stageName: 'Initial Submission' }); }
        catch { toast.error('Memo submitted but some attachments failed to upload.'); }
      }

      if (targetMode === 'publish') {
        if (savedId) {
          try { await memoAPI.publish(savedId); toast.success('Memo published to all departments!'); }
          catch { toast.success('Memo created. You can publish from the detail view.'); }
        }
      } else {
        toast.success(isEditing ? 'Draft updated successfully.' : 'Memo submitted successfully.');
      }
      try { localStorage.removeItem(lsKey); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('rms:draftSaved'));
      onCreated();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to create memo');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="animate-in slide-in-from-right-4 duration-300 w-full min-h-full flex flex-col space-y-6 max-w-7xl mx-auto pb-10">
      <div className="flex items-center justify-between">
        <button 
          onClick={onClose} 
          className="px-4 py-2 bg-white border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl flex items-center gap-2 transition-all font-bold text-xs uppercase tracking-wider shadow-sm group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          Back to Memos
        </button>
      </div>

      <div className="glass bg-white/70 backdrop-blur-xl rounded-[2.5rem] border border-border/40 shadow-xl overflow-hidden flex flex-col">
        <div className="p-6 lg:p-10 border-b border-border/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0 bg-white/50">
          <div className="space-y-2">
            <h2 className="text-3xl sm:text-4xl font-black text-foreground tracking-tighter leading-tight flex items-center space-x-3">
              <Send size={28} className="text-primary" />
              <span>{isEditing ? 'Edit Memo Draft' : 'New Memo'}</span>
            </h2>
            <div className="flex items-center space-x-2 pt-1">
              <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-primary/80">
                {isEditing ? `Editing Draft #${editDraft.id}` : 'Official Administrative Communication'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 p-6 lg:p-10 space-y-8 bg-zinc-50/50">
          <div className="space-y-2.5">
            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest pl-2">Subject *</label>
            <input
              value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Memo subject..."
              className="w-full bg-white border border-border/60 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm transition-all"
            />
          </div>

          <div className="space-y-2.5">
            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest pl-2">Message *</label>
            <textarea
              value={message} onChange={e => setMessage(e.target.value)}
              placeholder="Write the memo content here..."
              rows={10}
              className="w-full bg-white border border-border/60 rounded-2xl p-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm resize-none transition-all"
            />
          </div>

          {/* Attachments */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest pl-2">Attachments (optional)</label>
            <input
              key={fileInputKey}
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv"
              onChange={e => addFiles(e.target.files)}
            />
            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((f, i) => {
                  const ext = f.name.split('.').pop()?.toUpperCase() || '?';
                  const extColor = ['PDF'].includes(ext) ? 'bg-red-100 text-red-700'
                    : ['JPG','JPEG','PNG','GIF','WEBP'].includes(ext) ? 'bg-blue-100 text-blue-700'
                    : ['DOC','DOCX'].includes(ext) ? 'bg-indigo-100 text-indigo-700'
                    : ['XLS','XLSX'].includes(ext) ? 'bg-green-100 text-green-700'
                    : 'bg-muted text-muted-foreground';
                  const sizeLabel = f.size >= 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`;
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 bg-muted/40 rounded-xl border border-border/50 animate-in fade-in duration-200">
                      <FileText size={13} className="text-primary shrink-0" />
                      <span className="flex-1 truncate text-xs font-bold text-foreground">{f.name}</span>
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md shrink-0 ${extColor}`}>{ext}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0 font-mono">{sizeLabel}</span>
                      <button onClick={() => { const url = URL.createObjectURL(f); window.open(url, '_blank'); }} className="p-1 text-muted-foreground hover:text-primary rounded shrink-0" title="Preview">
                        <Eye size={12} />
                      </button>
                      <button onClick={() => removeFile(i)} className="p-1 text-muted-foreground hover:text-destructive rounded shrink-0" title="Remove">
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              disabled={submitting}
              onClick={() => fileRef.current?.click()}
              className={`flex items-center gap-2 text-xs font-bold text-primary hover:text-primary/80 px-3 py-2 rounded-xl border border-dashed border-primary/30 hover:border-primary/60 hover:bg-primary/5 transition-all w-full justify-center cursor-pointer ${submitting ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <Paperclip size={14} /> {files.length > 0 ? 'Add more files' : 'Attach supporting documents'}
            </button>
          </div>

          {/* Routing */}
          <div className="space-y-4 pt-4 border-t border-border/40">
            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest pl-2">Send To</label>

            {isPublisher && (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setTargetMode('dept')}
                  className={`py-4 rounded-xl border-2 text-xs font-black uppercase tracking-wider transition-all ${targetMode === 'dept' ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 text-muted-foreground hover:bg-muted'}`}
                >
                  Specific Department
                </button>
                <button
                  onClick={() => setTargetMode('publish')}
                  className={`py-4 rounded-xl border-2 text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${targetMode === 'publish' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-border/60 text-muted-foreground hover:bg-muted'}`}
                >
                  <Globe size={16} /> Broadcast to All
                </button>
              </div>
            )}

            {(targetMode === 'dept' || !isPublisher) && (
              <div className="animate-in fade-in duration-300">
                {!isPublisher ? (
                  <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200 text-xs font-bold text-blue-800 shadow-sm">
                    This memo will be routed to the <strong>HR Department</strong> for review and executive publishing.
                  </div>
                ) : targetOptions.length > 0 ? (
                  <div className="relative group">
                    <select
                      value={targetDeptId}
                      onChange={e => setTargetDeptId(e.target.value)}
                      className="w-full bg-white border border-border/60 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none pr-10 shadow-sm transition-all cursor-pointer group-hover:border-primary/40"
                    >
                      <option value="">— Select Target Department —</option>
                      {targetOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <ChevronRight size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none transition-transform group-hover:rotate-45" />
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl bg-muted/30 border border-border/30 text-xs text-muted-foreground italic">
                    No individual departments available for direct routing. Use "Broadcast to All" to reach the entire group.
                  </div>
                )}
              </div>
            )}

            {targetMode === 'publish' && (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center gap-3 text-xs font-bold text-emerald-800 animate-in slide-in-from-top-2 duration-200">
                <Globe size={18} className="shrink-0 text-emerald-600" />
                This communication will be broadcast to ALL departments instantly across the RMS neural network.
              </div>
            )}
          </div>
        </div>

        <div className="p-6 lg:p-8 border-t border-border/50 flex flex-col-reverse sm:flex-row gap-4 shrink-0 bg-white">
          <button onClick={onClose} className="py-4 px-8 rounded-2xl border-2 border-border/60 text-sm font-black text-muted-foreground hover:bg-muted hover:text-foreground transition-all active:scale-95">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-primary text-white text-sm font-black disabled:opacity-50 shadow-xl shadow-primary/30 hover:bg-primary/90 hover:shadow-primary/40 active:scale-95 transition-all"
          >
            {submitting ? <Loader2 size={20} className="animate-spin" /> : (targetMode === 'publish' ? <Globe size={20} /> : <Send size={20} />)}
            {isEditing ? 'Update & Submit' : targetMode === 'publish' ? 'Broadcast Memo to All' : 'Submit for Review'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Memo Detail View ──────────────────────────────────────────────────────────
const MemoDetailView = ({ memo, user, departments, onBack, onRefresh, onEditDraft }) => {
  const [detail, setDetail]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [acting, setActing]     = useState(false);
  const [note, setNote]         = useState('');
  const [fwdDeptId, setFwdDeptId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Publish scheduling
  const [publishStartAt, setPublishStartAt] = useState('');
  const [publishEndAt,   setPublishEndAt]   = useState('');

  const deptName  = user?.name || '';
  const isHR      = /\bhr\b|human\s*resource/i.test(deptName);
  const isGM      = /general\s*manager|\bgm\b/i.test(deptName);
  const isCEO     = /ceo|chairman/i.test(deptName);
  const isAdmin   = user?.role === 'global_admin';
  const isPublisher = isHR || isAdmin;
  const isCreatorDept = Number(user?.deptId) === Number(memo.departmentId);
  const isFinalized = ['treated', 'published', 'approved'].includes(memo.finalApprovalStatus);
  const canDelete = isAdmin || (isCreatorDept && !isFinalized);

  const isIncoming = user?.deptId && detail?.targetDepartmentId === user.deptId;

  const handleDelete = async () => {
    setActing(true);
    try {
      await reqAPI.deleteRequisition(memo.id);
      toast.success(`Memo #${memo.id} deleted.`);
      onRefresh();
      onBack();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not delete this memo.');
    } finally { setActing(false); }
  };

  // Compute display status from finalApprovalStatus + publish dates
  const fas = detail?.finalApprovalStatus || memo.finalApprovalStatus;
  const publishEnd = detail?.publishEndAt || null;
  const isExpired = fas === 'published' && publishEnd && new Date(publishEnd) < new Date();
  const isUnpublished = fas === 'unpublished';
  const isPublished   = fas === 'published' && !isExpired;

  useEffect(() => {
    getRequisitionDetail(memo.id).then(d => { setDetail(d); setLoading(false); });
  }, [memo.id]);

  const handlePublish = async () => {
    setActing(true);
    try {
      await memoAPI.publish(memo.id, {
        startAt: publishStartAt || undefined,
        endAt:   publishEndAt   || undefined,
      });
      toast.success('Memo published to all departments!');
      onRefresh(); onBack();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to publish memo');
    } finally { setActing(false); }
  };

  const handleUnpublish = async () => {
    setActing(true);
    try {
      await memoAPI.unpublish(memo.id);
      toast.success('Memo unpublished.');
      onRefresh(); onBack();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to unpublish memo');
    } finally { setActing(false); }
  };

  const handleReturn = async () => {
    if (!note.trim()) { toast.error('Please add a note explaining the return reason.'); return; }
    setActing(true);
    try {
      await memoAPI.returnToCreator(memo.id, note);
      toast.success('Memo returned to creator.');
      onRefresh(); onBack();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Return failed');
    } finally { setActing(false); }
  };

  const handleForward = async () => {
    if (!fwdDeptId) { toast.error('Select a department to forward to'); return; }
    setActing(true);
    try {
      await forwardAPI.forward(memo.id, { targetDepartmentId: parseInt(fwdDeptId), note });
      toast.success('Memo forwarded for comment.');
      onRefresh(); onBack();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Forward failed');
    } finally { setActing(false); }
  };

  // HR can forward to GM or Chairman for comment before publishing
  const fwdOptions = departments.filter(d => {
    if (d.id === user?.deptId) return false;
    if (isHR) return /general\s*manager|\bgm\b|ceo|chairman/i.test(d.name);
    return false;
  });

  // Status badge config
  const statusBadge = (() => {
    if (isPublished)   return { label: 'Published', cls: 'bg-emerald-500 text-white' };
    if (isExpired)     return { label: 'Expired',   cls: 'bg-gray-400 text-white' };
    if (isUnpublished) return { label: 'Unpublished', cls: 'bg-red-400 text-white' };
    if (memo.status === 'pending') return { label: 'Pending HR', cls: 'bg-amber-100 border border-amber-300 text-amber-800' };
    return { label: memo.status, cls: statusColors[memo.status] || statusColors.pending };
  })();

  return (
    <div className="space-y-6 animate-in fade-in duration-300 w-full max-w-7xl mx-auto pb-10">
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="flex items-center gap-2 text-xs font-black text-muted-foreground hover:text-foreground transition-all px-4 py-2 rounded-xl bg-white border border-border/50 shadow-sm uppercase tracking-wider group">
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          Back to Memos
        </button>
        {canDelete && (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={acting}
            className="flex items-center gap-2 text-xs font-black text-red-600 bg-red-50 hover:bg-red-500 hover:text-white transition-all px-4 py-2 rounded-xl shadow-sm uppercase tracking-wider border border-red-200 disabled:opacity-40"
          >
            {acting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Delete Memo
          </button>
        )}
        <ConfirmModal
          isOpen={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={handleDelete}
          isProcessing={acting}
          title="Delete Memo"
          message={`Delete memo "${memo.title}"? It will be removed from all processing records.`}
        />
        {memo.status === 'draft' && onEditDraft && (
          <button
            onClick={() => onEditDraft(memo)}
            className="flex items-center gap-2 text-xs font-black text-white bg-amber-500 hover:bg-amber-600 transition-all px-4 py-2 rounded-xl shadow-sm uppercase tracking-wider"
          >
            <FileText size={16} />
            Continue Editing
          </button>
        )}
      </div>

      <div className="glass bg-white/95 rounded-[2.5rem] border border-border/40 shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 lg:p-10 border-b border-border/40 space-y-4 bg-white/50">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase border tracking-widest ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
            {isPublished && (
              <span className="px-3 py-1 rounded-xl text-[10px] font-black uppercase bg-emerald-500 text-white flex items-center gap-1.5 shadow-md shadow-emerald-500/20">
                <Globe size={12} /> Broadcast Active
              </span>
            )}
            {detail?.publishStartAt && (
              <span className="px-2 py-1 rounded-lg text-[9px] font-mono text-muted-foreground bg-muted border border-border/50 flex items-center gap-1">
                <Calendar size={10} /> {new Date(detail.publishStartAt).toLocaleString()} — {detail.publishEndAt ? new Date(detail.publishEndAt).toLocaleString() : '∞'}
              </span>
            )}
          </div>
          <h2 className="text-3xl font-black text-foreground tracking-tighter leading-tight">{memo.title}</h2>
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground font-black uppercase tracking-widest opacity-80">
            <span>From: <strong className="text-foreground">{memo.department}</strong></span>
            <span>·</span>
            <span>Ref: <strong className="text-foreground font-mono">#{memo.id}</strong></span>
            <span>·</span>
            <span>{new Date(memo.createdAt).toLocaleString()}</span>
          </div>
        </div>

        {/* Body — read-only once published */}
        <div className="p-6 lg:p-10 bg-zinc-50/50">
          <div className="bg-white rounded-[2rem] p-8 text-base font-medium text-foreground leading-relaxed whitespace-pre-wrap border border-border/30 shadow-inner min-h-[300px]">
            {memo.description}
          </div>
          {isPublished && (
            <p className="mt-4 text-[10px] text-center text-muted-foreground font-bold uppercase tracking-widest italic">
              This memo is published and read-only. No routing or approval actions are available.
            </p>
          )}
        </div>

        {/* ── HR Unpublish (when already published) ── */}
        {!loading && isPublisher && isPublished && (
          <div className="p-6 lg:p-8 border-t border-border/40 bg-white flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-xs font-black text-foreground uppercase tracking-wide">Memo is Live</p>
              <p className="text-[11px] text-muted-foreground">You can unpublish at any time — even before the scheduled end date.</p>
            </div>
            <button onClick={handleUnpublish} disabled={acting}
              className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-red-50 border border-red-200 hover:bg-red-100 text-red-700 text-xs font-black uppercase tracking-widest disabled:opacity-50 transition-all active:scale-95">
              {acting ? <Loader2 size={14} className="animate-spin" /> : <EyeOff size={14} />}
              Unpublish
            </button>
          </div>
        )}

        {/* ── HR/Incoming Actions (when at HR's desk, not yet published) ── */}
        {!loading && isIncoming && !isPublished && !isUnpublished && (
          <div className="p-6 lg:p-10 border-t border-border/40 space-y-6 bg-white">
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] pl-2">
              {isPublisher ? 'HR Review & Publish Controls' : 'Executive Review & Comment'}
            </p>

            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="Add remarks, observations, or reason for return..."
              rows={3}
              className="w-full bg-zinc-50 border border-border/60 rounded-2xl p-5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none transition-all shadow-inner"
            />

            {/* Publish scheduling — HR only */}
            {isPublisher && (
              <div className="space-y-3 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
                <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest flex items-center gap-1.5">
                  <Calendar size={12} /> Publish Schedule <span className="font-normal normal-case text-emerald-600 ml-1">(optional — leave blank to publish immediately)</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">Start Date & Time</label>
                    <input type="datetime-local" value={publishStartAt} onChange={e => setPublishStartAt(e.target.value)}
                      className="w-full bg-white border border-emerald-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 shadow-sm font-mono text-foreground"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">End Date & Time</label>
                    <input type="datetime-local" value={publishEndAt} onChange={e => setPublishEndAt(e.target.value)}
                      className="w-full bg-white border border-emerald-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 shadow-sm font-mono text-foreground"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {/* Publish */}
              {isPublisher && (
                <button onClick={handlePublish} disabled={acting}
                  className="flex items-center gap-2 px-8 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-widest disabled:opacity-50 shadow-xl shadow-emerald-600/20 active:scale-95 transition-all">
                  {acting ? <Loader2 size={16} className="animate-spin" /> : <Globe size={16} />}
                  {publishStartAt ? 'Schedule Broadcast' : 'Broadcast to All Units'}
                </button>
              )}

              {/* Forward to GM/Chairman for comment — HR only */}
              {isHR && fwdOptions.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <select value={fwdDeptId} onChange={e => setFwdDeptId(e.target.value)}
                      className="border border-border/60 rounded-xl p-3.5 text-[11px] font-black uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none bg-white pr-10 min-w-[180px]">
                      <option value="">Get comment from...</option>
                      {fwdOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <ChevronRight size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  </div>
                  <button onClick={handleForward} disabled={acting || !fwdDeptId}
                    className="flex items-center gap-2 px-5 py-3.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-[11px] font-black uppercase tracking-widest disabled:opacity-50 transition-all active:scale-95 shadow-lg shadow-primary/20">
                    {acting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightCircle size={14} />}
                    Forward
                  </button>
                </div>
              )}

              {/* Return to creator — HR only */}
              {isPublisher && (
                <button onClick={handleReturn} disabled={acting}
                  className="flex items-center gap-2 px-6 py-3.5 rounded-2xl border-2 border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-black uppercase tracking-widest disabled:opacity-50 transition-all active:scale-95">
                  {acting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  Return to Creator
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
const MemoManagement = ({ onViewChange }) => {
  const { user } = useAuth();
  const [memos, setMemos]         = useState([]);
  const [departments, setDepts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [draftToEdit, setDraftToEdit] = useState(null);
  const [pendingDeleteMemo, setPendingDeleteMemo] = useState(null);
  const [deletingMemo, setDeletingMemo] = useState(false);
  const [selectedMemo, setSelectedMemo] = useState(null);
  const [tab, setTab]             = useState('all'); // 'all' | 'incoming' | 'published'
  // Super Admin's "Generate Memo" button defaults OFF and starts `null` (hidden) until the
  // real setting resolves — flash-free, since the safe default is "hidden".
  const [adminCreateMemoEnabled, setAdminCreateMemoEnabled] = useState(null);

  useEffect(() => {
    if (user?.role !== 'global_admin') return;
    settingsAPI.get('admin_create_memo_enabled').then(r => setAdminCreateMemoEnabled(r?.value === 'true')).catch(() => setAdminCreateMemoEnabled(false));
  }, [user?.role]);

  const loadMemos = useCallback(async () => {
    setLoading(true);
    const [all, depts] = await Promise.all([getMemoRecords(), getDepartments()]);
    setMemos(all);
    setDepts(depts);
    setLoading(false);
  }, []);

  useEffect(() => { loadMemos(); }, [loadMemos]);

  useEffect(() => {
    const handler = () => loadMemos();
    window.addEventListener('globalHardRefresh', handler);
    return () => window.removeEventListener('globalHardRefresh', handler);
  }, [loadMemos]);

  // Open new Memo form when triggered by local-draft "Continue editing" in navbar
  useEffect(() => {
    const handle = (e) => {
      if ((e.detail?.type || 'Memo') === 'Memo') {
        setDraftToEdit(null);
        setShowCreate(true);
      }
    };
    window.addEventListener('rms:openNewRequest', handle);
    // Also check sessionStorage fallback (component was lazy-loaded after event fired)
    const pending = sessionStorage.getItem('rms_pending_open_request');
    if (pending === 'Memo') {
      sessionStorage.removeItem('rms_pending_open_request');
      setDraftToEdit(null);
      setShowCreate(true);
    }
    return () => window.removeEventListener('rms:openNewRequest', handle);
  }, []);

  const filteredMemos = memos.filter(m => {
    if (tab === 'incoming') return user?.deptId && m.targetDepartmentId === user.deptId;
    if (tab === 'published') return m.finalApprovalStatus === 'published';
    return true;
  });

  // Compute display status for each memo card
  const getMemoDisplayStatus = (m) => {
    const fas = m.finalApprovalStatus;
    const endAt = m.publishEndAt;
    if (fas === 'published' && endAt && new Date(endAt) < new Date()) return 'expired';
    if (fas === 'published')   return 'published';
    if (fas === 'unpublished') return 'unpublished';
    if (m.status === 'pending') return 'pending_hr';
    return m.status || 'draft';
  };

  const statusIcon = {
    pending_hr:  <Clock size={13} className="text-amber-500" />,
    pending:     <Clock size={13} className="text-amber-500" />,
    published:   <Globe size={13} className="text-emerald-500" />,
    unpublished: <EyeOff size={13} className="text-red-400" />,
    expired:     <Clock size={13} className="text-gray-400" />,
    approved:    <CheckCircle2 size={13} className="text-emerald-500" />,
    draft:       <FileText size={13} className="text-muted-foreground" />,
  };

  const statusLabel = {
    pending_hr:  'Pending HR',
    pending:     'Pending',
    published:   'Published',
    unpublished: 'Unpublished',
    expired:     'Expired',
    approved:    'Approved',
    draft:       'Draft',
  };

  return (
    <>
    <div className="w-full mx-auto pb-20 px-1 animate-slide-up">
        {showCreate ? (
          <MemoCreateForm
            user={user}
            departments={departments}
            editDraft={draftToEdit}
            onClose={() => { setShowCreate(false); setDraftToEdit(null); }}
            onCreated={() => { setShowCreate(false); setDraftToEdit(null); loadMemos(); }}
          />
        ) : selectedMemo ? (
          <MemoDetailView
            memo={selectedMemo}
            user={user}
            departments={departments}
            onBack={() => setSelectedMemo(null)}
            onRefresh={loadMemos}
            onEditDraft={(m) => { setSelectedMemo(null); setDraftToEdit(m); setShowCreate(true); }}
          />
        ) : (
          <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="px-3 py-1 rounded-xl bg-primary/10 border border-primary/20 text-[10px] font-black text-primary uppercase tracking-widest w-fit flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                  Internal Registry
                </div>
                <h1 className="text-4xl font-black text-foreground tracking-tighter leading-tight">
                  Memo <span className="text-primary italic font-serif">Exchange</span>
                </h1>
                <p className="text-sm text-muted-foreground font-medium max-w-lg">
                  Orchestrate and monitor official communications across the CSS Group modular network.
                </p>
              </div>
              {(user?.role !== 'global_admin' || adminCreateMemoEnabled) && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="group bg-primary hover:bg-primary/90 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-xl shadow-primary/20 flex items-center gap-3 w-fit active:scale-95"
                >
                  <Plus size={20} className="group-hover:rotate-90 transition-transform" />
                  <span className="text-xs uppercase tracking-widest font-black">Generate Memo</span>
                </button>
              )}
            </div>

            {/* Unified Search & Filters Row */}
            <div className="flex items-center gap-1.5 p-1.5 bg-muted/40 rounded-[1.25rem] w-fit">
              {[
                { key: 'all', label: 'All Comm' },
                { key: 'incoming', label: 'Incoming' },
                { key: 'published', label: 'Broadcasts' },
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === t.key ? 'bg-white text-foreground shadow-md' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Memo List Cards */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-4 opacity-50">
                <Loader2 size={32} className="text-primary animate-spin" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Synchronizing Records...</p>
              </div>
            ) : filteredMemos.length === 0 ? (
              <div className="glass bg-white/60 rounded-[3rem] border border-border/50 p-20 text-center animate-in zoom-in-95 duration-500">
                <div className="w-20 h-20 bg-muted/30 rounded-full flex items-center justify-center mx-auto mb-6">
                  <FileText size={32} className="text-muted-foreground/30" />
                </div>
                <h3 className="text-xl font-black text-foreground tracking-tight">Registry Empty</h3>
                <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto font-medium">
                  {tab === 'incoming' ? 'No incoming communications detected for your unit.' :
                   tab === 'published' ? 'No official broadcasts have been released yet.' :
                   'Start an official communication thread above.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredMemos.map(memo => {
                  const isIncoming  = user?.deptId && memo.targetDepartmentId === user.deptId;
                  const displayStatus = getMemoDisplayStatus(memo);
                  const isPublished   = displayStatus === 'published';
                  const isExpiredCard = displayStatus === 'expired';
                  return (
                    <div
                      key={memo.id}
                      onClick={() => setSelectedMemo(memo)}
                      className="glass bg-white/70 rounded-[2.5rem] border border-border/40 p-6 hover:border-primary/40 hover:shadow-2xl hover:shadow-primary/5 transition-all cursor-pointer group relative overflow-hidden flex flex-col h-full"
                    >
                      <div className="flex-1 space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-primary tracking-[0.2em]">#{memo.id}</span>
                          <div className="flex items-center gap-2">
                            {isIncoming && !isPublished && (
                              <span className="px-2 py-0.5 rounded-lg bg-blue-500 text-white text-[8px] font-black uppercase shadow-sm">Incoming</span>
                            )}
                            {isPublished && (
                              <span className="px-2 py-0.5 rounded-lg bg-emerald-500 text-white text-[8px] font-black uppercase flex items-center gap-1 shadow-sm">
                                <Globe size={8} /> Live
                              </span>
                            )}
                            {isExpiredCard && (
                              <span className="px-2 py-0.5 rounded-lg bg-gray-300 text-gray-700 text-[8px] font-black uppercase shadow-sm">Expired</span>
                            )}
                            <div className="flex items-center gap-1">
                              {statusIcon[displayStatus] || statusIcon.draft}
                            </div>
                          </div>
                        </div>
                        
                        <div>
                          <h3 className="text-lg font-black text-foreground tracking-tight line-clamp-2 leading-tight group-hover:text-primary transition-colors">{memo.title}</h3>
                          <p className="text-xs text-muted-foreground mt-2 line-clamp-2 font-medium leading-relaxed">{memo.description}</p>
                        </div>
                      </div>

                      <div className="mt-6 pt-5 border-t border-border/30 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                           <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black text-[10px]">
                              {memo.department.charAt(0)}
                           </div>
                           <div className="flex flex-col">
                              <span className="text-[10px] font-black text-foreground uppercase tracking-wider leading-none">{memo.department}</span>
                              <span className="text-[9px] text-muted-foreground font-medium mt-1 uppercase tracking-tighter">{new Date(memo.createdAt).toLocaleDateString()}</span>
                           </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {(user?.role === 'global_admin' || (Number(user?.deptId) === Number(memo.departmentId) && !['treated','published','approved'].includes(memo.finalApprovalStatus))) && (
                            <button
                              onClick={e => { e.stopPropagation(); setPendingDeleteMemo(memo); }}
                              className="w-8 h-8 rounded-full bg-red-50 border border-red-100 flex items-center justify-center text-red-400 hover:bg-red-500 hover:text-white transition-all shadow-sm"
                              title="Delete memo"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                          <div className="w-8 h-8 rounded-full bg-white border border-border/50 flex items-center justify-center text-muted-foreground group-hover:bg-primary group-hover:text-white transition-all transform group-hover:scale-110 shadow-sm">
                             <ChevronRight size={16} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={!!pendingDeleteMemo}
        onClose={() => setPendingDeleteMemo(null)}
        isProcessing={deletingMemo}
        title="Delete Memo"
        message={`Delete memo "${pendingDeleteMemo?.title}"?`}
        onConfirm={async () => {
          setDeletingMemo(true);
          try {
            await reqAPI.deleteRequisition(pendingDeleteMemo.id);
            toast.success(`Memo #${pendingDeleteMemo.id} deleted.`);
            setPendingDeleteMemo(null);
            loadMemos();
          } catch (err) {
            toast.error(err?.response?.data?.error || 'Could not delete memo.');
          } finally { setDeletingMemo(false); }
        }}
      />
    </>
  );
};

export default MemoManagement;
