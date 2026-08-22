import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, Send, Save, CreditCard, Package, FileText, AlertTriangle, CheckCircle2, Loader2, ArrowLeft, MessageSquare, Eye } from 'lucide-react';
import { addRequisition, getDepartments, getRequisitionTypes, uploadAttachments } from '../lib/store';
import api, { deptAPI, aiAPI, settingsAPI } from '../lib/api';
import { useNetwork } from '../App';
import { toast } from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import VoiceDictation from './VoiceDictation';
import { useAIFeatures } from '../context/AIFeaturesContext';

// Departments whose members may route to Super Admin
const SUPER_ADMIN_PRIVILEGED_CODES = ['GMR', 'CEO', 'HRD'];

const RequisitionForm = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { isOnline } = useNetwork();
  const { aiEnabled } = useAIFeatures();

  const [types, setTypes] = useState([]);
  const [selectedType, setSelectedType] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [refining, setRefining] = useState(false);
  const [aiPreview, setAiPreview] = useState(null);

  // Activation check state for target department
  const [activation, setActivation] = useState(null);   // null | { activated, headName }
  const [checkingActivation, setCheckingActivation] = useState(false);

  // Chairman/CEO routing — IDs of departments allowed to route there
  const [chairmanAllowedIds, setChairmanAllowedIds] = useState([]);

  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    urgency: 'normal',
    targetDepartmentId: ''
  });

  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const load = async () => {
      const [allDepts, allTypes] = await Promise.all([getDepartments(), getRequisitionTypes()]);
      setDepartments(allDepts);
      setTypes(allTypes);
      if (allTypes.length > 0) setSelectedType(allTypes[0]);
    };
    load();
    // Load chairman/CEO routing access setting
    settingsAPI.get('chairman_ceo_allowed_depts').then(res => {
      if (res?.value) setChairmanAllowedIds(JSON.parse(res.value));
    }).catch(() => {});
    // reset form when opened
    setFormData({ description: '', amount: '', urgency: 'normal', targetDepartmentId: '' });
    setFiles([]);
    setActivation(null);
    setSubmitting(false);
    setRefining(false);
    setAiPreview(null);
  }, [isOpen]);

  if (!isOpen) return null;

  // Determine which departments are selectable as "Send To" targets
  const senderCode = user?.deptCode || '';
  const isPrivileged = SUPER_ADMIN_PRIVILEGED_CODES.includes(senderCode) || user?.role === 'global_admin';

  // Helpers for restricted departments
  const isSuperAdmin  = (dept) => dept?.name?.toLowerCase() === 'super admin';
  const isChairmanCEO = (dept) => /ceo|chairman/i.test(dept?.name || '');
  const canRouteToChairman = chairmanAllowedIds.includes(user?.deptId);

  // Filter: exclude sender's own dept; hide Chairman/CEO unless this dept is whitelisted
  const targetableDepts = departments.filter(d => {
    if (d.id === user?.deptId) return false;
    if (isChairmanCEO(d) && !canRouteToChairman) return false;
    return true;
  });

  const handleTargetChange = async (deptIdStr) => {
    setFormData(prev => ({ ...prev, targetDepartmentId: deptIdStr }));
    setActivation(null);
    if (!deptIdStr) return;

    const deptId = parseInt(deptIdStr);
    setCheckingActivation(true);
    try {
      const result = await deptAPI.checkActivation(deptId);
      setActivation(result);
    } catch {
      setActivation(null);
    } finally {
      setCheckingActivation(false);
    }
  };

  const handleRefine = async (e) => {
    e.preventDefault();
    if (!formData.description.trim() || formData.description.length < 5) {
      toast.error('Please describe your request in more detail before refining.');
      return;
    }
    setRefining(true);
    try {
      const res = await aiAPI.refineDraft(formData.description);

      // AI blocked the content as invalid/gibberish
      if (res.blocked) {
        toast.error(res.validationMessage || 'Your input was not recognised as a valid request. Please describe your request clearly.', { duration: 6000 });
        if (res.actionReason) toast(res.actionReason, { icon: 'ℹ️', duration: 5000 });
        return;
      }

      const newTypeStr = res.documentType?.toLowerCase() || 'cash';
      const matchedType = types.find(t =>
        newTypeStr === 'memo' ? t.name.toLowerCase().includes('memo') : t.name.toLowerCase().includes('cash')
      ) || types[0];

      setSelectedType(matchedType);
      setAiPreview({
        description: res.refinedDescription,
        amount: res.totalAmount,
        typeLabel: matchedType?.name || 'Requisition',
        recommendedAction: res.recommendedAction,
        actionReason: res.actionReason,
        validationMessage: res.validationMessage
      });

      const actionMsgs = {
        submit: 'Ready to submit — AI has refined your request.',
        forward: 'AI suggests forwarding this to another department for processing.',
        draft: 'Saved as draft — AI recommends adding more detail before submitting.',
      };
      toast.success(actionMsgs[res.recommendedAction] || 'AI refinement complete. Please review.', { duration: 5000 });
    } catch (err) {
      const msg = err?.response?.data?.validationMessage || err?.response?.data?.error || 'AI refinement failed. Please try again.';
      toast.error(msg, { duration: 5000 });
    } finally {
      setRefining(false);
    }
  };

  const handleSubmit = async (e, isDraft = false) => {
    e.preventDefault();
    if (!selectedType || submitting) return;

    if (!formData.description.trim()) {
      toast.error('Please enter a purpose / description.');
      return;
    }

    // Block if target department chosen but not activated (and not draft) - Bypass for Global Admin
    const isGlobalAdmin = user?.role === 'global_admin';
    if (!isDraft && formData.targetDepartmentId && activation && !activation.activated && !isGlobalAdmin) {
      toast.error('Selected target department has not activated their dashboard. Please choose another.');
      return;
    }

    setSubmitting(true);
    try {
      const finalDesc = aiPreview ? aiPreview.description : formData.description;
      const isMemoType = selectedType?.name?.toLowerCase().includes('memo');
      const finalAmount = isMemoType ? null : (aiPreview ? aiPreview.amount : null);

      const payload = {
        description: finalDesc,
        title: finalDesc,
        type: selectedType.name,
        urgency: formData.urgency,
        isDraft,
        ...(finalAmount != null && { amount: finalAmount }),
        ...(user?.deptId   != null && { departmentId: user.deptId }),
        ...(formData.targetDepartmentId && { targetDepartmentId: parseInt(formData.targetDepartmentId) }),
      };

      const result = await addRequisition(payload);

      // Upload attachments — if upload fails, roll back the whole submission
      if (result && result.length > 0 && files.length > 0) {
        const reqId = result[0].id;
        try {
          setUploadProgress(0);
          await uploadAttachments(reqId, files, { onProgress: setUploadProgress, uploaderDept: user?.name, stageName: 'Initial Submission' });
          setUploadProgress(100);
        } catch (uploadErr) {
          // Roll back: delete the just-created requisition so nothing is half-submitted
          try { await api.delete(`/requisitions/${reqId}`); } catch { /* ignore rollback errors */ }
          setTimeout(() => setUploadProgress(null), 200);
          const detail = uploadErr?.response?.data?.error || uploadErr?.message || 'Unknown error';
          toast.error(`Submission failed — file could not be uploaded (${detail}). Please try again.`, { duration: 7000 });
          return;
        } finally {
          setTimeout(() => setUploadProgress(null), 400);
        }
      }

      toast.success(isDraft ? 'Draft saved.' : 'Requisition submitted successfully.');
      onClose();
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Submission failed';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-5 animate-in fade-in duration-500 pb-10">

      {/* Top Header / Back Button Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={!submitting ? onClose : undefined}
          disabled={submitting}
          className="px-4 py-2 bg-white border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl flex items-center gap-2 transition-all font-bold text-xs uppercase tracking-wider shadow-sm group disabled:opacity-40"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          Cancel Creation
        </button>
      </div>

      <div className="glass bg-white/95 w-full flex-1 rounded-[2rem] border border-border/40 shadow-[0_4px_40px_rgba(0,0,0,0.03)] relative flex flex-col overflow-hidden min-h-[85vh]">

        {/* Header */}
        <div className="p-6 lg:p-8 border-b border-border/50 flex flex-col sm:flex-row items-start justify-between gap-4 shrink-0 bg-white/50">
          <div className="space-y-1">
            <h2 className="text-2xl sm:text-3xl font-black text-foreground tracking-tighter leading-tight">Create New Requisition</h2>
            <div className="flex items-center gap-2 pt-2">
              <div className="px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-[9px] font-black text-primary uppercase tracking-widest flex items-center gap-1">
                <div className="w-1 h-1 bg-primary rounded-full animate-pulse" />
                Neural Processor Active
              </div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                Originating Dept: {user?.name || user?.department || 'CSS Group'}
              </p>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-8 custom-scrollbar">

          {/* Type selector (Removed - Handled by AI) */}

          {/* Description */}
          {!aiPreview ? (
            <div className="space-y-3 border-b border-border/50 pb-6">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-1">
                  Rough Draft (What do you need?) *
                </label>
                <span className="text-[9px] text-muted-foreground/60 font-medium tracking-wide">Type or use voice ↓</span>
              </div>

              {/* Voice Dictation — only when AI features enabled */}
              {aiEnabled && (
                <VoiceDictation
                  disabled={submitting || refining}
                  onTranscript={(text) => {
                    setFormData(p => ({
                      ...p,
                      description: p.description
                        ? p.description.trimEnd() + ' ' + text
                        : text
                    }));
                  }}
                />
              )}

              <textarea
                value={formData.description}
                onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
                placeholder="Type your request here, or use Voice Dictation above to speak it…"
                disabled={submitting || refining}
                className="w-full bg-white border border-border rounded-2xl p-4 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[120px] transition-all disabled:opacity-60 resize-none shadow-inner"
                required
              />

              {/* AI Refine inline button — only when AI features enabled */}
              {aiEnabled && formData.description.trim().length >= 5 && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleRefine}
                    disabled={refining || !selectedType}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50"
                  >
                    {refining ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />}
                    {refining ? 'AI Analyzing…' : '✨ Refine with AI'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 border border-primary/20 bg-primary/5 rounded-2xl p-5 relative">
              {/* Type badge */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase font-black text-primary tracking-widest px-2 py-1 bg-primary/10 rounded-full flex items-center gap-1">
                  <CheckCircle2 size={12} /> {aiPreview.typeLabel}
                </span>
                {aiPreview.recommendedAction && (
                  <span className={`text-[10px] uppercase font-black tracking-widest px-2 py-1 rounded-full flex items-center gap-1 ${aiPreview.recommendedAction === 'submit' ? 'bg-emerald-100 text-emerald-700' :
                      aiPreview.recommendedAction === 'forward' ? 'bg-blue-100 text-blue-700' :
                        aiPreview.recommendedAction === 'draft' ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                    }`}>
                    AI: {aiPreview.recommendedAction === 'submit' ? '✓ Ready to Submit' :
                      aiPreview.recommendedAction === 'forward' ? '→ Forward Recommended' :
                        aiPreview.recommendedAction === 'draft' ? '✎ Needs More Detail' : '✗ Blocked'}
                  </span>
                )}
              </div>

              {/* AI reason */}
              {aiPreview.actionReason && (
                <p className="text-[11px] text-muted-foreground italic leading-relaxed border-l-2 border-primary/30 pl-3">
                  {aiPreview.actionReason}
                </p>
              )}

              <div>
                <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                  Professional Request
                </label>
                <div className="mt-1 text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {aiPreview.description}
                </div>
              </div>

              <div className="pt-3 border-t border-primary/10 flex justify-between items-center">
                {aiPreview.typeLabel?.toLowerCase().includes('memo') ? (
                  <p className="text-[10px] text-muted-foreground font-semibold italic">
                    Administrative request — no monetary amount applicable.
                  </p>
                ) : (
                  <div className="space-y-0.5">
                    <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                      Automatically Calculated Total
                    </label>
                    <p className="text-xl font-mono font-bold text-foreground">
                      ₦ {(aiPreview.amount || 0).toLocaleString()}
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setAiPreview(null)}
                  disabled={submitting}
                  className="text-xs font-bold text-primary hover:underline disabled:opacity-50"
                >
                  Edit Draft
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Removed Manual Amount input block */}

            {/* Urgency */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-1">
                Urgency Level
              </label>
              <select
                value={formData.urgency}
                onChange={e => setFormData(p => ({ ...p, urgency: e.target.value }))}
                disabled={submitting}
                className="w-full bg-white/80 border border-border rounded-2xl p-4 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none cursor-pointer transition-all disabled:opacity-60"
              >
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
                <option value="critical">Critical / Emergency</option>
              </select>
            </div>
          </div>

          {/* ── Send To Department ── */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-1">
              Send To Department
            </label>
            <select
              value={formData.targetDepartmentId}
              onChange={e => handleTargetChange(e.target.value)}
              disabled={submitting}
              className="w-full bg-white/80 border border-border rounded-2xl p-4 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none cursor-pointer transition-all disabled:opacity-60"
            >
              <option value="">— Route through normal workflow —</option>
              {targetableDepts.map(d => {
                const superAdmin = isSuperAdmin(d);
                const blocked = superAdmin && !isPrivileged;
                return (
                  <option
                    key={d.id}
                    value={d.id}
                    disabled={blocked}
                    className={blocked ? 'text-muted-foreground' : ''}
                  >
                    {d.name}{d.type === 'Strategic' ? ' ★' : ''}
                    {superAdmin ? ' (Admin — restricted)' : ''}
                  </option>
                );
              })}
            </select>

            {/* Activation feedback */}
            {checkingActivation && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse px-1">
                <Loader2 size={12} className="animate-spin" />
                Checking department status…
              </div>
            )}
            {!checkingActivation && formData.targetDepartmentId && activation !== null && (
              activation.activated ? (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                  <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-emerald-600" />
                  <span>
                    <strong>{activation.departmentName || 'Department'}</strong> is activated and will receive an email notification.
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" />
                  <span>
                    This department <strong>has not activated</strong> their dashboard yet (no head email configured).
                    Please ask them to complete their profile, or choose another department.
                  </span>
                </div>
              )
            )}
          </div>

          {/* File upload */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-1">
              Supporting Documents (FIRS Compliant)
            </label>
            <input
              id="req-file-input"
              type="file"
              multiple
              className="sr-only"
              ref={fileInputRef}
              onChange={e => {
                const MAX = 10 * 1024 * 1024;
                const picked = Array.from(e.target.files);
                const oversized = picked.filter(f => f.size > MAX);
                if (oversized.length) {
                  toast.error(`File too large (max 10 MB): ${oversized.map(f => f.name).join(', ')}`);
                }
                const valid = picked.filter(f => f.size <= MAX);
                if (valid.length) setFiles(prev => [...prev, ...valid]);
                e.target.value = '';
              }}
              tabIndex={-1}
            />
            <label
              htmlFor="req-file-input"
              className={`border-2 border-dashed border-border/50 rounded-2xl p-6 flex flex-col items-center justify-center space-y-2 transition-all ${isOnline && !submitting
                  ? 'bg-white/40 hover:bg-white/80 cursor-pointer'
                  : 'bg-muted/30 opacity-50 cursor-not-allowed pointer-events-none'
                }`}
            >
              <Upload size={22} className="text-muted-foreground" />
              <p className="text-xs text-foreground font-medium text-center">Click to upload · PDF, JPG, PNG, DOC (max 10 MB)</p>
              {!isOnline && (
                <p className="text-[10px] text-destructive uppercase font-bold">Attachments require online connection</p>
              )}
            </label>

            {files.length > 0 && (
              <div className="space-y-1.5">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 p-2.5 bg-white/60 rounded-xl border border-border/40 text-xs">
                    <FileText size={12} className="text-primary shrink-0" />
                    <span className="font-medium truncate flex-1">{f.name}</span>
                    <span className="text-muted-foreground shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                    {uploadProgress === null && (
                      <>
                        <button
                          type="button"
                          title="Preview"
                          onClick={() => {
                            const url = URL.createObjectURL(f);
                            window.open(url, '_blank', 'noopener,noreferrer');
                            setTimeout(() => URL.revokeObjectURL(url), 10000);
                          }}
                          className="text-muted-foreground hover:text-primary p-0.5 transition-colors"
                        >
                          <Eye size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-muted-foreground hover:text-destructive p-0.5"
                        >
                          <X size={12} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {uploadProgress !== null && (
                  <div className="space-y-1 pt-1 animate-in fade-in duration-300">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-black text-primary uppercase tracking-widest flex items-center gap-1.5">
                        <Loader2 size={10} className="animate-spin" />
                        {uploadProgress >= 100 ? 'Processing…' : 'Uploading…'}
                      </span>
                      <span className="font-mono text-muted-foreground">{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-muted/40 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-200"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="p-5 border-t border-border/50 flex items-center gap-3 bg-muted/10 shrink-0">
          <button
            type="button"
            onClick={e => handleSubmit(e, true)}
            disabled={submitting || refining || !selectedType}
            className="flex-1 border border-border bg-white hover:bg-muted text-foreground font-bold py-3.5 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save Draft
          </button>

          <button
            type="button"
            onClick={e => handleSubmit(e, false)}
            disabled={submitting || refining || !selectedType || !(aiPreview ? aiPreview.description : formData.description?.trim()) || (formData.targetDepartmentId && activation && !activation.activated)}
            className="flex-[2] bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-2xl transition-all shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <><Loader2 size={16} className="animate-spin" /> Submitting…</>
            ) : refining ? (
              <><Loader2 size={16} className="animate-spin" /> AI Analyzing…</>
            ) : (
              <><Send size={16} /> Confirm & Submit Request</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RequisitionForm;
