import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, Send, Loader2, ChevronDown, ArrowLeft, Paperclip, FileText, Eye, WifiOff, CloudUpload, CheckCircle, AlertTriangle } from 'lucide-react';
import { addRequisition, getDepartments, uploadAttachments } from '../lib/store';
import { reqAPI, settingsAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';

const CashRequestForm = ({ type = 'Cash', isOpen, onClose, editDraft = null }) => {
  const { user } = useAuth();
  const [departments, setDepartments] = useState([]);
  // Live sub-account routing privileges (refreshed from server on open, not from stale JWT)
  const [ownPriv, setOwnPriv] = useState({
    directRoute: user?.directRoute ?? false,
    allowedRouteDeptIds: user?.allowedRouteDeptIds || [],
  });
  // Admin-unlocked privileged depts — Super Admin can allow direct routing to Account/Audit/ICC/etc.
  const [directRouteAllowedIds, setDirectRouteAllowedIds] = useState([]);
  const [subject, setSubject] = useState('');
  const [comment, setComment] = useState('');
  const [urgency, setUrgency] = useState('normal');
  const [targetDeptId, setTargetDeptId] = useState('');
  const [items, setItems] = useState([{ qty: 1, description: '', amount: '' }]);
  const [files, setFiles] = useState([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('idle'); // 'idle' | 'uploading' | 'done' | 'queued' | 'error'
  const [submitStep, setSubmitStep] = useState(null); // null | 'creating' | 'uploading' | 'finalizing'
  const [uploadProgress, setUploadProgress] = useState(0);
  const [slowWarning, setSlowWarning] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const fileRef = useRef(null);
  const slowTimerRef = useRef(null);
  const skipUploadRef = useRef(null); // resolves the upload race to skip it

  useEffect(() => {
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  const isEditing = !!editDraft;

  // ── Creator role ──────────────────────────────────────────────────────────
  const creatorName = user?.name || '';
  const isChairmanCreator = /ceo|chairman/i.test(creatorName);
  const isGMCreator       = /general\s*manager|\bgm\b/i.test(creatorName);
  const isHRCreator       = /\bhr\b|human\s*resource/i.test(creatorName);
  const isExecutiveCreator = isChairmanCreator || isGMCreator || isHRCreator;

  // Privileged depts that regular creators cannot address directly at creation time.
  // They are only reachable after the request has passed through HR.
  const isPrivilegedDept = (name = '') =>
    /general\s*manager|\bgm\b|ceo|chairman|\bicc\b|internal.*control|control.*compliance|audit|account/i.test(name);

  // Allowed targets when creating:
  // • Sub-account, directRoute OFF → only parent dept (backend forces it anyway)
  // • Sub-account, directRoute ON, specific list → only those depts
  // • Sub-account, directRoute ON, no list → any non-privileged dept
  // • Chairman / HR / GM → anywhere (no restrictions)
  // • Regular dept → any dept EXCEPT GM, Chairman, ICC, Audit, Account
  const allowedTargets = (() => {
    if (user?.isSubAccount) {
      if (!ownPriv.directRoute) {
        // Route OFF — request will land on parent head regardless; show only them
        return departments.filter(d => d.id === user.parentDeptId);
      }
      const ids = ownPriv.allowedRouteDeptIds || [];
      if (ids.length > 0) {
        // Route ON with specific list — only those departments
        return departments.filter(d => ids.includes(d.id) && d.type !== 'Sub-Account');
      }
      // Route ON, no restriction — fall through to normal filter (minus sub-accounts)
    }
    return departments.filter(d => {
      if (d.id === user?.deptId) return false;
      if (d.type === 'Sub-Account') return false;
      if (isChairmanCreator || isGMCreator || isHRCreator) return true;
      // Super Admin can unlock specific privileged depts for direct routing
      if (directRouteAllowedIds.includes(d.id)) return true;
      return !isPrivilegedDept(d.name);
    });
  })();

  useEffect(() => {
    if (!isOpen) return;
    getDepartments().then(d => {
      if (user?.isSubAccount) {
        const ownDept = d.find(dept => dept.id === user.deptId || dept.id === parseInt(user.deptId));
        if (ownDept) {
          const freshIds = (() => {
            try {
              const raw = ownDept.allowedRouteDeptIds;
              if (Array.isArray(raw)) return raw;
              return JSON.parse(raw || 'null') || [];
            } catch { return []; }
          })();
          setOwnPriv({ directRoute: ownDept.directRoute ?? false, allowedRouteDeptIds: freshIds });
        }
      }
      const all = d.filter(dept => dept.id !== user?.deptId);
      setDepartments(all);
    });
    settingsAPI.get('direct_route_allowed_dept_ids').then(res => {
      if (res?.value) {
        try { setDirectRouteAllowedIds(JSON.parse(res.value)); } catch { setDirectRouteAllowedIds([]); }
      }
    }).catch(() => {});

    if (editDraft) {
      // Pre-populate from existing draft
      setSubject(editDraft.title || '');
      setUrgency(editDraft.urgency || 'normal');
      setTargetDeptId(editDraft.targetDepartmentId ? String(editDraft.targetDepartmentId) : '');
      try {
        const parsed = editDraft.content ? JSON.parse(editDraft.content) : {};
        setComment(parsed.comment || parsed.description || '');
        if (parsed.itemized && Array.isArray(parsed.items) && parsed.items.length > 0) {
          setItems(parsed.items.map(i => ({
            qty: i.qty ?? 1,
            description: i.description ?? '',
            amount: i.amount ?? ''
          })));
        } else {
          setItems([{ qty: 1, description: '', amount: '' }]);
        }
      } catch {
        setComment(''); setItems([{ qty: 1, description: '', amount: '' }]);
      }
    } else {
      setSubject(''); setComment(''); setItems([{ qty: 1, description: '', amount: '' }]); setTargetDeptId(''); setUrgency('normal');
    }
    setFiles([]);
  }, [isOpen, editDraft?.id]);

  const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — matches server limit

  const addFiles = (newFiles) => {
    const oversized = [];
    const valid = [];
    Array.from(newFiles).forEach(f => {
      if (f.size > MAX_FILE_BYTES) oversized.push(f.name);
      else valid.push(f);
    });
    if (oversized.length) {
      toast.error(`File${oversized.length > 1 ? 's' : ''} too large (max 10 MB): ${oversized.join(', ')}`);
    }
    if (valid.length) {
      setFiles(prev => {
        const existing = new Set(prev.map(f => f.name + f.size));
        return [...prev, ...valid.filter(f => !existing.has(f.name + f.size))];
      });
    }
    // Force-remount the input so the browser allows the dialog to open again next time
    setFileInputKey(k => k + 1);
  };
  const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx));

  // ── Auto-save ──────────────────────────────────────────────────────────────
  const lsKey = `rms_autosave_${type}_${user?.deptId || 'x'}`;

  const hasContent = subject.trim() || comment.trim() ||
    items.some(i => i.description.trim()) || files.length > 0;

  // Save form state to localStorage whenever content changes
  useEffect(() => {
    if (!isOpen || isEditing) return;
    if (!hasContent) return;
    const snapshot = { subject, comment, items, targetDeptId, urgency, savedAt: Date.now() };
    try { localStorage.setItem(lsKey, JSON.stringify(snapshot)); } catch { /* storage full */ }
  }, [subject, comment, items, targetDeptId, urgency, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // On open: restore from localStorage ONLY when user explicitly clicked "Continue editing"
  // (Continue sets sessionStorage flag rms_restore_${type}='1' before opening the form)
  useEffect(() => {
    if (!isOpen || isEditing) return;
    const restoreFlag = `rms_restore_${type}`;
    if (sessionStorage.getItem(restoreFlag) !== '1') return; // fresh new request — don't restore
    sessionStorage.removeItem(restoreFlag);
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) return;
      const snap = JSON.parse(raw);
      if (Date.now() - (snap.savedAt || 0) > 86400000) { localStorage.removeItem(lsKey); return; }
      if (snap.subject) setSubject(snap.subject);
      if (snap.comment) setComment(snap.comment);
      if (snap.items?.length) setItems(snap.items);
      if (snap.targetDeptId) setTargetDeptId(snap.targetDeptId);
      if (snap.urgency) setUrgency(snap.urgency);
      // Data is now in state — clear the localStorage key so the badge disappears
      localStorage.removeItem(lsKey);
      window.dispatchEvent(new CustomEvent('rms:draftSaved'));
    } catch { /* corrupt */ }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save to server as draft silently on back/close if content exists
  const handleClose = async () => {
    if (!hasContent || isEditing || submitting) { onClose(); return; }
    try {
      // Save ALL items (including partially filled) so content can be restored
      const allItems = items.map(i => ({
        qty: parseFloat(i.qty) || 1,
        description: String(i.description ?? ''),
        amount: parseFloat(i.amount) || 0,
        lineTotal: (parseFloat(i.qty) || 1) * (parseFloat(i.amount) || 0)
      }));
      const draftTotal = allItems.reduce((s, i) => s + i.lineTotal, 0);
      const content = type === 'Cash'
        ? JSON.stringify({ itemized: true, comment: comment.trim(), items: allItems, total: draftTotal })
        : JSON.stringify({ itemized: false, description: comment.trim() });
      const payload = {
        title: subject.trim() || `${type} Draft`,
        description: subject.trim() || `${type} Draft`,
        type, urgency, isDraft: true, content,
        ...(draftTotal > 0 && { amount: draftTotal }),
        ...(user?.deptId != null && { departmentId: user.deptId }),
        ...(targetDeptId && { targetDepartmentId: parseInt(targetDeptId) }),
      };
      const result = await addRequisition(payload);
      const savedId = Array.isArray(result) ? result[0]?.id : result?.id;
      localStorage.removeItem(lsKey);
      // Notify navbar badge to refresh
      window.dispatchEvent(new CustomEvent('rms:draftSaved'));
      toast('Progress auto-saved as draft.', { icon: '💾', duration: 3000 });
      // If there are files, open the draft immediately for the user to attach them
      if (files.length > 0 && savedId) {
        window.dispatchEvent(new CustomEvent('rms:openDraftEdit', { detail: { id: savedId, type } }));
      }
    } catch { /* network off — localStorage still has snapshot */ }
    onClose();
  };

  // Also clear localStorage on successful submit (inside handleSubmit after onClose)
  if (!isOpen) return null;

  const total = items.reduce((s, i) => s + (parseFloat(i.qty || 0) * parseFloat(i.amount || 0)), 0);

  const addItem = () => setItems(p => [...p, { qty: 1, description: '', amount: '' }]);
  const removeItem = i => setItems(p => p.filter((_, j) => j !== i));
  const updateItem = (i, field, val) => setItems(p => p.map((item, j) => j === i ? { ...item, [field]: val } : item));

  const handleSubmit = async (isDraft = false) => {
    if (!subject.trim()) { toast.error('Please enter a subject/purpose'); return; }

    const validItems = items.filter(i => i.description.trim());
    if (type === 'Cash' && !validItems.length) {
      toast.error('Please add at least one item'); return;
    }
    if (type === 'Material' && !comment.trim()) {
      toast.error('Please describe material needs in the description box'); return;
    }
    if (!isDraft && !targetDeptId) {
      toast.error('Please select a department to send this request to'); return;
    }

    // Sub-account privilege checks (client-side pre-flight — backend also validates)
    if (user?.isSubAccount && !isDraft) {
      if (type === 'Memo' && !user?.memoPrivilege) {
        toast.error('Your sub-account does not have permission to create memo requests. Contact your department head.'); return;
      }
      if (type === 'Material' && !user?.materialPrivilege) {
        toast.error('Your sub-account does not have permission to create material requests. Contact your department head.'); return;
      }
      if (type === 'Cash' && user?.privilegeAmount != null) {
        const limit = parseFloat(user.privilegeAmount);
        if (!isNaN(limit) && total > limit) {
          toast.error(`Your sub-account can only submit cash requests up to ₦${limit.toLocaleString()}. This request totals ₦${total.toLocaleString()}.`); return;
        }
      }
    }

    setSubmitting(true);
    setSlowWarning(false);
    setUploadProgress(0);
    slowTimerRef.current = setTimeout(() => setSlowWarning(true), 10000);

    try {
      const content = type === 'Cash'
        ? JSON.stringify({
          itemized: true,
          comment: comment.trim(),
          items: validItems.map(i => ({
            qty: parseFloat(i.qty) || 1,
            description: i.description.trim(),
            amount: parseFloat(i.amount) || 0,
            lineTotal: (parseFloat(i.qty) || 1) * (parseFloat(i.amount) || 0)
          })),
          total
        })
        : JSON.stringify({ itemized: false, description: comment.trim() });

      const reqDescription = type === 'Material' ? comment.trim() : subject;

      const payload = {
        title: subject,
        description: reqDescription,
        type,
        urgency,
        isDraft,
        content,
        ...(type === 'Cash' && total > 0 && { amount: total }),
        ...(user?.deptId != null && { departmentId: user.deptId }),
        ...(targetDeptId && { targetDepartmentId: parseInt(targetDeptId) }),
      };

      // Step 1 — create / update requisition (the only blocking step)
      setSubmitStep('creating');
      let savedId;
      if (isEditing) {
        await reqAPI.updateRequisition(editDraft.id, payload);
        savedId = editDraft.id;
      } else {
        const result = await addRequisition(payload);
        savedId = Array.isArray(result) ? result[0]?.id : result?.id;
      }

      // Requisition is on the server — clear autosave, reset spinner, close form immediately
      try { localStorage.removeItem(lsKey); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('rms:draftSaved'));
      clearTimeout(slowTimerRef.current);
      setSlowWarning(false);
      setSubmitting(false);
      setSubmitStep(null);
      toast.success(isDraft ? 'Draft saved.' : `${type} request submitted successfully.`);
      onClose(); // ← unblocks the user right away; file upload continues below

      // Step 2 — upload files in the background (non-blocking to the user)
      if (files.length > 0) {
        if (!savedId) {
          toast('Requisition saved offline. Re-attach your files once it syncs.', { icon: '📎', duration: 6000 });
        } else {
          const uploadToastId = toast.loading(`Uploading ${files.length} file(s)…`, { duration: Infinity });
          try {
            await uploadAttachments(savedId, files, {
              uploaderDept: user?.name,
              stageName: 'Initial Submission',
            });
            toast.dismiss(uploadToastId);
            toast.success('File(s) attached successfully.');
          } catch {
            toast.dismiss(uploadToastId);
            toast('File attachment failed. Open the request to re-attach.', { icon: '📎', duration: 6000 });
          }
        }
      }
    } catch (err) {
      clearTimeout(slowTimerRef.current);
      setSlowWarning(false);
      setSubmitting(false);
      setSubmitStep(null);
      const msg = err?.response?.data?.error || err?.message || 'Submission failed.';
      const status = err?.response?.status;
      if (status === 0 || !navigator.onLine) {
        toast.error('No connection — your request was saved offline and will sync automatically when you reconnect.');
      } else if (status >= 500) {
        toast.error(`Server error (${status}) — please try again in a moment.`);
      } else {
        toast.error(msg);
      }
    }
  };

  return (
    <div className="animate-in slide-in-from-right-4 duration-300 w-full min-h-full flex flex-col space-y-6 max-w-7xl mx-auto pb-10">

      {/* Header with Back Button */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleClose}
          className="px-4 py-2 bg-white border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl flex items-center gap-2 transition-all font-bold text-xs uppercase tracking-wider shadow-sm group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          Back to Directory
        </button>
      </div>

      <div className="glass bg-white/70 backdrop-blur-xl rounded-[2.5rem] border border-border/40 shadow-xl overflow-hidden flex flex-col">
        {/* Title Bar */}
        <div className="p-6 lg:p-10 border-b border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 bg-white/50">
          <div className="space-y-2">
            <h2 className="text-3xl sm:text-4xl font-black text-foreground tracking-tighter leading-tight flex items-center space-x-3">
              <Send size={28} className="text-primary" />
              <span>{isEditing ? `Edit ${type} Draft` : `New ${type} Request`}</span>
            </h2>
            <div className="flex items-center space-x-2 pt-1">
              <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-primary/80">
                {isEditing ? `Editing Draft #${editDraft.id}` : type === 'Cash' ? 'Itemized Financial Requisition' : 'Material & Supply Requisition'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 p-6 lg:p-10 space-y-8 bg-zinc-50/50">

          {/* Total at top — only for Cash */}
          {type === 'Cash' && (
            <div className="p-6 rounded-3xl bg-primary/5 border border-primary/20 flex items-center justify-between shadow-sm">
              <div>
                <p className="text-[10px] font-black text-primary uppercase tracking-widest">Grand Total</p>
                <p className="text-xs text-muted-foreground mt-0.5 font-medium">{items.filter(i => i.description).length} item(s)</p>
              </div>
              <span className="text-4xl font-black font-mono text-foreground tracking-tighter">
                ₦{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {/* Subject */}
          <div className="space-y-2.5">
            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest pl-2">Subject / Purpose *</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder={`Purpose of this ${type.toLowerCase()} request...`}
              className="w-full bg-white border border-border/60 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm transition-all"
            />
          </div>

          {/* Material vs Cash specifics */}
          {type === 'Material' ? (
            <div className="space-y-2.5">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest pl-2">Description / Needs *</label>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Describe your material needs, specifications, or comments..."
                rows={8}
                className="w-full bg-white border border-border/60 rounded-2xl p-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm resize-none transition-all"
              />
            </div>
          ) : (
            <>
              {/* Cash small comment */}
              <div className="space-y-2.5">
                <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest pl-2">Additional Comments </label>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Provide context or briefly describe the need before listing items..."
                  rows={2}
                  className="w-full bg-white border border-border/60 rounded-2xl p-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm resize-none transition-all"
                />
              </div>

              {/* Cash Items Table */}
              <div className="space-y-4 pt-4">
                <div className="pb-3 border-b border-border/40">
                  <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest pl-2">Itemized List *</label>
                </div>

                {/* Scrollable wrapper so the fixed-width columns don't crush the description input on narrow screens */}
                <div className="overflow-x-auto -mx-1 px-1 pb-1">
                  <div className="min-w-[560px]">

                {/* Column headers — match PDF layout: S/N | Item Description | Quantity | Unit Price | Total | (delete) */}
                <div className="grid grid-cols-[40px_1fr_90px_120px_110px_40px] gap-2 px-1">
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest text-center">S/N</span>
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Item Description</span>
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest text-center">Quantity</span>
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest text-right">Unit Price (₦)</span>
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest text-right">Total (₦)</span>
                  <span />
                </div>

                <div className="space-y-3 mt-2">
                  {items.map((item, i) => {
                    const lineTotal = (parseFloat(item.qty) || 0) * (parseFloat(item.amount) || 0);
                    return (
                      <div key={i} className="grid grid-cols-[40px_1fr_90px_120px_110px_40px] gap-2 items-center animate-in fade-in slide-in-from-top-1 duration-200">
                        {/* S/N */}
                        <span className="text-sm font-black text-muted-foreground text-center">{i + 1}</span>
                        {/* Description */}
                        <input
                          value={item.description}
                          onChange={e => updateItem(i, 'description', e.target.value)}
                          placeholder="Item description..."
                          className="bg-white border border-border/60 rounded-xl p-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm w-full transition-all"
                        />
                        {/* Quantity */}
                        <input
                          type="number" min="1"
                          value={item.qty}
                          onChange={e => updateItem(i, 'qty', e.target.value)}
                          className="bg-white border border-border/60 rounded-xl p-3 text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm w-full transition-all"
                        />
                        {/* Unit Price */}
                        <input
                          type="number" min="0" step="0.01"
                          value={item.amount}
                          onChange={e => updateItem(i, 'amount', e.target.value)}
                          placeholder="0.00"
                          className="bg-white border border-border/60 rounded-xl p-3 text-sm font-bold text-right font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm w-full transition-all"
                        />
                        {/* Line Total (read-only) */}
                        <div className="bg-muted/30 border border-border/40 rounded-xl p-3 text-sm font-black text-right font-mono text-foreground">
                          {lineTotal > 0 ? `₦${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                        </div>
                        {/* Delete */}
                        <button
                          onClick={() => removeItem(i)}
                          disabled={items.length === 1}
                          className="w-10 h-10 flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 rounded-xl disabled:opacity-20 transition-all shadow-sm border border-transparent hover:border-red-100 active:scale-95"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                  </div>{/* end min-w inner */}
                </div>{/* end overflow-x-auto */}

                {/* Add Item button — below the last row */}
                <button
                  onClick={addItem}
                  className="flex items-center gap-2 text-[11px] font-black text-primary px-4 py-2.5 rounded-xl bg-primary/10 hover:bg-primary/20 transition-all active:scale-95 shadow-sm border border-primary/20 w-full justify-center mt-1"
                >
                  <Plus size={14} /> Add Item
                </button>

                {/* Line totals summary */}
                {items.some(i => parseFloat(i.amount) > 0 && parseFloat(i.qty) > 0) && (
                  <div className="mt-4 p-5 rounded-2xl bg-muted/30 border border-border/40 space-y-3 shadow-inner">
                    <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest border-b border-border/40 pb-2 mb-2">Line Summary</p>
                    {items.filter(i => i.description && parseFloat(i.amount) > 0).map((item, i) => (
                      <div key={i} className="flex justify-between text-xs text-muted-foreground font-medium">
                        <span className="truncate max-w-[250px]">{item.description} × {item.qty}</span>
                        <span className="font-mono font-bold text-foreground">
                          ₦{((parseFloat(item.qty) || 1) * (parseFloat(item.amount) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Attachments */}
          <div className="space-y-3 pt-6 border-t border-border/40">
            <div className="flex items-center justify-between pl-2 pr-1">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Attachments (optional)</label>
              {/* Live network badge */}
              {!isOnline ? (
                <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  <WifiOff size={10} /> Offline — files saved locally
                </span>
              ) : uploadStatus === 'uploading' ? (
                <span className="flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full animate-pulse">
                  <CloudUpload size={10} /> Uploading…
                </span>
              ) : uploadStatus === 'done' ? (
                <span className="flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                  <CheckCircle size={10} /> Uploaded
                </span>
              ) : uploadStatus === 'queued' ? (
                <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  <AlertTriangle size={10} /> Queued — will upload when online
                </span>
              ) : uploadStatus === 'error' ? (
                <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                  <AlertTriangle size={10} /> Upload failed — retry on submit
                </span>
              ) : null}
            </div>

            {/* Offline notice when files are staged but network is down */}
            {!isOnline && files.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
                <WifiOff size={14} className="shrink-0 mt-0.5" />
                <p className="text-[11px] font-medium leading-snug">
                  You're offline. Your files are staged and will upload automatically once the requisition syncs to the server. Keep this draft open or save it.
                </p>
              </div>
            )}

            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((f, i) => {
                  const ext = f.name.split('.').pop()?.toUpperCase() || '?';
                  const extColor = ['PDF'].includes(ext) ? 'bg-red-100 text-red-700'
                    : ['JPG','JPEG','PNG','GIF','WEBP'].includes(ext) ? 'bg-blue-100 text-blue-700'
                    : ['DOC','DOCX'].includes(ext) ? 'bg-indigo-100 text-indigo-700'
                    : ['XLS','XLSX'].includes(ext) ? 'bg-green-100 text-green-700'
                    : 'bg-muted text-muted-foreground';
                  const sizeLabel = f.size >= 1048576
                    ? `${(f.size / 1048576).toFixed(1)} MB`
                    : `${Math.max(1, Math.round(f.size / 1024))} KB`;
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 bg-muted/40 rounded-xl border border-border/50 animate-in fade-in slide-in-from-top-1 duration-200">
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
            <input
              key={fileInputKey}
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv"
              onChange={e => addFiles(e.target.files)}
            />
            <button
              type="button"
              disabled={submitting}
              onClick={() => fileRef.current?.click()}
              className={`flex items-center gap-2 text-xs font-bold text-primary hover:text-primary/80 px-3 py-2 rounded-xl border border-dashed border-primary/30 hover:border-primary/60 hover:bg-primary/5 transition-all w-full justify-center cursor-pointer select-none ${submitting ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <Paperclip size={14} /> {files.length > 0 ? 'Add more files' : 'Attach supporting documents'}
            </button>

            {/* Staged files notice — files upload when request is submitted */}
            {files.length > 0 && uploadStatus === 'idle' && (
              <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl text-[11px] text-primary font-medium">
                <CheckCircle size={12} className="shrink-0 text-primary" />
                {files.length} file{files.length !== 1 ? 's' : ''} staged — will upload automatically when you submit
              </div>
            )}
          </div>

          {/* Target dept + Urgency */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-border/40">
            <div className="space-y-2.5">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest pl-2">Send To</label>
              <div className="relative group">
                <select
                  value={targetDeptId}
                  onChange={e => setTargetDeptId(e.target.value)}
                  className="w-full bg-white border border-border/60 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none pr-10 shadow-sm transition-all cursor-pointer group-hover:border-primary/40"
                >
                  <option value="">— Select Department —</option>
                  {allowedTargets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <ChevronDown size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
              {user?.isSubAccount && !ownPriv.directRoute ? (
                <p className="text-[10px] text-muted-foreground/70 italic pl-1 mt-1">
                  All requests from your unit are routed through your department head first.
                </p>
              ) : !isExecutiveCreator && !user?.isSubAccount && (() => {
                // Work out which privileged depts are still gated (not unlocked by admin)
                const stillGated = departments.filter(d =>
                  isPrivilegedDept(d.name) && !directRouteAllowedIds.includes(d.id)
                );
                if (stillGated.length === 0) return null;
                return (
                  <p className="text-[10px] text-muted-foreground/70 italic pl-1 mt-1">
                    {stillGated.map(d => d.name).join(', ')} {stillGated.length === 1 ? 'is' : 'are'} not available here — {stillGated.length === 1 ? 'it' : 'they'} must be reached through HR.
                  </p>
                );
              })()}
            </div>
            <div className="space-y-2.5">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest pl-2">Priority</label>
              <div className="relative group">
                <select
                  value={urgency}
                  onChange={e => setUrgency(e.target.value)}
                  className="w-full bg-white border border-border/60 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none pr-10 shadow-sm transition-all cursor-pointer group-hover:border-primary/40"
                >
                  <option value="normal" className="text-muted-foreground">Normal Priority</option>
                  <option value="urgent" className="text-amber-600">Urgent</option>
                  <option value="critical" className="text-red-600">Critical</option>
                </select>
                <ChevronDown size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none transition-transform group-hover:translate-y-0" />
              </div>
            </div>
          </div>

        </div>

        {/* Submit progress panel — only visible while submitting */}
        {submitting && (
          <div className="px-6 lg:px-8 pb-4 space-y-3 animate-in fade-in duration-300">
            {/* Step indicators */}
            <div className="flex items-center gap-3">
              {[
                { key: 'creating',   label: isEditing ? 'Updating request…' : 'Creating request…' },
                { key: 'uploading',  label: `Uploading ${files.length} file${files.length !== 1 ? 's' : ''}…` },
                { key: 'finalizing', label: 'Finalizing…' },
              ].filter(s => files.length > 0 || s.key !== 'uploading').map((s, idx, arr) => {
                const stepOrder = ['creating', 'uploading', 'finalizing'];
                const currentIdx = stepOrder.indexOf(submitStep);
                const sIdx = stepOrder.indexOf(s.key);
                const done = currentIdx > sIdx;
                const active = submitStep === s.key;
                return (
                  <React.Fragment key={s.key}>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black transition-all ${done ? 'bg-emerald-500 text-white' : active ? 'bg-primary text-white animate-pulse' : 'bg-muted text-muted-foreground'}`}>
                        {done ? '✓' : idx + 1}
                      </div>
                      <span className={`text-[10px] font-bold ${active ? 'text-primary' : done ? 'text-emerald-600' : 'text-muted-foreground'}`}>{s.label}</span>
                    </div>
                    {idx < arr.length - 1 && <div className="flex-1 h-px bg-border/50" />}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Upload progress bar */}
            {submitStep === 'uploading' && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span className="font-bold text-primary">{uploadProgress >= 100 ? 'Processing…' : 'Uploading…'}</span>
                  <span className="font-mono">{uploadProgress}%</span>
                </div>
                <div className="w-full bg-muted/40 rounded-full h-2 overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-200" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}

            {/* Slow network warning */}
            {slowWarning && (
              <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 animate-in fade-in duration-500">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <p className="text-[11px] font-medium leading-snug">
                    This is taking longer than expected — your network may be slow.
                    {submitStep === 'uploading' && ' Your request is already saved. You can skip the upload and attach files later.'}
                  </p>
                  {submitStep === 'uploading' && (
                    <button
                      onClick={() => skipUploadRef.current?.()}
                      className="text-[10px] font-black text-amber-700 underline hover:text-amber-900 transition-colors"
                    >
                      Skip upload &amp; close now →
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="p-6 lg:p-8 border-t border-border/50 flex flex-col-reverse sm:flex-row gap-4 shrink-0 bg-white">
          <button
            onClick={() => handleSubmit(true)}
            disabled={submitting}
            className="py-4 px-8 rounded-2xl border-2 border-border/60 text-sm font-black text-muted-foreground hover:bg-muted hover:text-foreground transition-all disabled:opacity-50 active:scale-95"
          >
            Save Draft
          </button>
          <button
            onClick={() => handleSubmit(false)}
            disabled={submitting}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-primary text-white text-sm font-black transition-all disabled:opacity-50 shadow-xl shadow-primary/30 hover:bg-primary/90 hover:shadow-primary/40 active:scale-95"
          >
            {submitting
              ? <><Loader2 size={20} className="animate-spin" /> {!isOnline ? 'Saving offline…' : 'Please wait…'}</>
              : <><Send size={20} /> {isEditing ? 'Update & Submit' : `Submit ${type} Request`}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
};

export default CashRequestForm;
