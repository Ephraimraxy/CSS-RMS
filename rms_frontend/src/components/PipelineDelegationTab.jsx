import { useState } from 'react';
import { Plus, Trash2, Save, AlertCircle, ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';

const URGENCY_LABELS = [
  { key: 'timerCritical', label: 'Critical', color: 'red',   placeholder: 'e.g. 30' },
  { key: 'timerUrgent',   label: 'Urgent',   color: 'amber', placeholder: 'e.g. 120' },
  { key: 'timerNormal',   label: 'Normal',   color: 'slate', placeholder: 'e.g. 480' },
];

function newStage() {
  return {
    id:               `stage_${Date.now()}`,
    deptId:           '',
    timerCritical:    '',
    timerUrgent:      '',
    timerNormal:      '',
    onExpiry:         'alert',
    escalationDeptIds: [],
  };
}

export default function PipelineDelegationTab({ allDepts, pipelineStages, setPipelineStages, onSave }) {
  const [saving, setSaving] = useState(false);

  function addStage() {
    setPipelineStages(prev => [...prev, newStage()]);
  }

  function removeStage(id) {
    setPipelineStages(prev => prev.filter(s => s.id !== id));
  }

  function updateStage(id, patch) {
    setPipelineStages(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }

  function moveStage(id, dir) {
    setPipelineStages(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }

  function toggleEscalationDept(stageId, deptId) {
    setPipelineStages(prev => prev.map(s => {
      if (s.id !== stageId) return s;
      const ids = s.escalationDeptIds || [];
      return {
        ...s,
        escalationDeptIds: ids.includes(deptId)
          ? ids.filter(id => id !== deptId)
          : [...ids, deptId],
      };
    }));
  }

  function moveEscalationDept(stageId, deptId, dir) {
    setPipelineStages(prev => prev.map(s => {
      if (s.id !== stageId) return s;
      const ids = [...(s.escalationDeptIds || [])];
      const idx = ids.indexOf(deptId);
      if (idx < 0) return s;
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= ids.length) return s;
      [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
      return { ...s, escalationDeptIds: ids };
    }));
  }

  async function handleSave() {
    setSaving(true);
    try { await onSave(); } finally { setSaving(false); }
  }

  const mainDepts = (allDepts || []).filter(d => !d.isSubAccount);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-foreground tracking-tight">Pipeline &amp; Delegation</h3>
          <p className="text-sm text-muted-foreground mt-1 font-medium leading-relaxed max-w-2xl">
            Configure per-department stage timers for the entire request journey. Each stage can alert or escalate
            to a custom list of departments when the timer expires. Priority level determines the timer that applies.
            Drag stages up/down to reorder them. Delegation (internal assignment to sub-accounts) is always on — no toggle needed.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-black uppercase tracking-widest hover:opacity-90 transition-all shrink-0 disabled:opacity-50"
        >
          <Save size={13} />
          {saving ? 'Saving…' : 'Save Stages'}
        </button>
      </div>

      {/* Info box */}
      <div className="p-4 rounded-2xl border-2 border-blue-200 bg-blue-50/40 flex gap-3 text-[11px] text-blue-800 leading-relaxed">
        <AlertCircle size={14} className="shrink-0 mt-0.5 text-blue-500" />
        <div>
          <strong>How it works:</strong> When a request arrives at a configured stage department, the clock starts.
          If no action is taken within the timer for the request&apos;s urgency level, the system either
          <strong> alerts only</strong> (Super Admin + dept head notified) or <strong>escalates</strong> (forwarded
          to the first department in the escalation queue). All actions are trailed. The timer pauses if the request
          is ICC-frozen, in a vetting detour, or awaiting re-approval.
        </div>
      </div>

      {/* Stage list */}
      <div className="space-y-5">
        {pipelineStages.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm border-2 border-dashed border-border/40 rounded-2xl">
            No stages configured yet. Click &quot;Add Stage&quot; to begin.
          </div>
        )}

        {pipelineStages.map((stage, idx) => {
          const deptName = mainDepts.find(d => String(d.id) === String(stage.deptId))?.name || '';
          return (
            <div key={stage.id} className="p-5 rounded-2xl border-2 border-border/50 bg-white/80 space-y-5">
              {/* Stage header */}
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-0.5">
                  <button type="button" onClick={() => moveStage(stage.id, 'up')} disabled={idx === 0}
                    className="p-1 rounded-lg hover:bg-muted disabled:opacity-20 transition-all">
                    <ArrowUp size={12} />
                  </button>
                  <button type="button" onClick={() => moveStage(stage.id, 'down')} disabled={idx === pipelineStages.length - 1}
                    className="p-1 rounded-lg hover:bg-muted disabled:opacity-20 transition-all">
                    <ArrowDown size={12} />
                  </button>
                </div>
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-black shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Stage Department</label>
                  <select
                    value={stage.deptId}
                    onChange={e => updateStage(stage.id, { deptId: e.target.value })}
                    className="w-full sm:w-72 bg-white border border-border/60 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 mt-1"
                  >
                    <option value="">— Select department —</option>
                    {mainDepts.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
                  </select>
                </div>
                <button type="button" onClick={() => removeStage(stage.id)}
                  className="ml-auto p-2 rounded-xl hover:bg-red-50 hover:text-red-600 text-muted-foreground transition-all">
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Timers per urgency */}
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Timer per urgency level (minutes)</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {URGENCY_LABELS.map(({ key, label, color, placeholder }) => {
                    const val    = stage[key] || '';
                    const parsed = parseFloat(val);
                    const active = val !== '' && !isNaN(parsed) && parsed > 0;
                    return (
                      <div key={key} className={`p-3 rounded-xl border-2 space-y-1.5 bg-white transition-all ${active ? `border-${color}-300` : 'border-border/40'}`}>
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${key === 'timerCritical' ? 'bg-red-500 animate-pulse' : key === 'timerUrgent' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                          <p className="text-[9px] font-black text-foreground uppercase tracking-widest">{label}</p>
                        </div>
                        <input
                          type="number" min="0" step="1"
                          value={val}
                          onChange={e => updateStage(stage.id, { [key]: e.target.value })}
                          placeholder={placeholder}
                          className={`w-full bg-muted/20 border rounded-xl px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 placeholder:text-[10px] placeholder:text-muted-foreground/50 ${active ? `border-${color}-300 focus:ring-${color}-200` : 'border-border/60 focus:ring-muted'}`}
                        />
                        <p className={`text-[9px] ${active ? `text-${color === 'red' ? 'red' : color === 'amber' ? 'amber' : 'slate'}-700 font-semibold` : 'text-muted-foreground'}`}>
                          {active ? `Fires after ${Math.round(parsed) >= 60 ? `${Math.floor(parsed/60)}h ${parsed%60>0?`${Math.round(parsed%60)}m`:''}`.trim() : `${Math.round(parsed)}m`}` : 'Off for this level'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* On expiry action */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">When timer expires</p>
                <div className="flex gap-3">
                  {[
                    { val: 'alert',   label: 'Alert Only',  desc: 'Notify Super Admin + dept head. Request stays put.' },
                    { val: 'escalate', label: 'Escalate',   desc: 'Forward to first department in the escalation queue below.' },
                  ].map(({ val, label, desc }) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => updateStage(stage.id, { onExpiry: val })}
                      className={`flex-1 p-3 rounded-xl border-2 text-left transition-all ${stage.onExpiry === val ? 'border-primary bg-primary/5' : 'border-border/40 bg-white hover:border-primary/30'}`}
                    >
                      <p className={`text-[10px] font-black uppercase tracking-widest ${stage.onExpiry === val ? 'text-primary' : 'text-muted-foreground'}`}>{label}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Escalation queue (only shown when onExpiry === 'escalate') */}
              {stage.onExpiry === 'escalate' && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    Escalation queue — request goes to the first department listed
                  </p>
                  {/* Selected queue with reorder */}
                  {(stage.escalationDeptIds || []).length > 0 && (
                    <div className="space-y-1">
                      {(stage.escalationDeptIds || []).map((dId, eIdx) => {
                        const d = mainDepts.find(x => String(x.id) === String(dId));
                        return (
                          <div key={dId} className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-xl px-3 py-1.5">
                            <span className="text-[9px] font-black text-primary w-4">{eIdx + 1}.</span>
                            <span className="text-xs font-semibold text-foreground flex-1">{d?.name || `Dept #${dId}`}</span>
                            <div className="flex gap-0.5">
                              <button type="button" onClick={() => moveEscalationDept(stage.id, dId, 'up')} disabled={eIdx === 0}
                                className="p-1 rounded hover:bg-primary/10 disabled:opacity-20"><ArrowUp size={10} /></button>
                              <button type="button" onClick={() => moveEscalationDept(stage.id, dId, 'down')} disabled={eIdx === (stage.escalationDeptIds || []).length - 1}
                                className="p-1 rounded hover:bg-primary/10 disabled:opacity-20"><ArrowDown size={10} /></button>
                              <button type="button" onClick={() => toggleEscalationDept(stage.id, dId)}
                                className="p-1 rounded hover:bg-red-50 hover:text-red-600 text-muted-foreground"><Trash2 size={10} /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Add from available depts */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {mainDepts
                      .filter(d => String(d.id) !== String(stage.deptId) && !(stage.escalationDeptIds || []).includes(d.id) && !(stage.escalationDeptIds || []).map(String).includes(String(d.id)))
                      .map(d => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => toggleEscalationDept(stage.id, d.id)}
                          className="px-2.5 py-1 rounded-lg border border-border/50 text-[10px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-primary transition-all bg-white"
                        >
                          <ChevronRight size={9} className="inline mr-0.5" />{d.name}
                        </button>
                    ))}
                  </div>
                  <p className="text-[9px] text-muted-foreground">Click a department above to add it to the queue. Use arrows to reorder.</p>
                </div>
              )}

              {/* Summary badge */}
              {deptName && (
                <div className="text-[9px] text-muted-foreground bg-muted/30 rounded-lg px-3 py-1.5">
                  <strong>{deptName}</strong> — timers: critical {stage.timerCritical||'off'}, urgent {stage.timerUrgent||'off'}, normal {stage.timerNormal||'off'} min
                  {stage.onExpiry === 'escalate' && (stage.escalationDeptIds||[]).length > 0
                    ? ` → escalates to ${mainDepts.find(d=>String(d.id)===String(stage.escalationDeptIds[0]))?.name||'?'}`
                    : ' → alert only'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add stage button */}
      <button
        type="button"
        onClick={addStage}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-dashed border-primary/30 text-primary text-sm font-bold hover:border-primary/60 hover:bg-primary/5 transition-all"
      >
        <Plus size={15} />
        Add Stage
      </button>

      {/* Delegation info */}
      <div className="p-5 rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 space-y-3">
        <p className="text-sm font-black text-foreground flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
          Internal Department Delegation
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed max-w-2xl">
          Department heads can assign any request they hold to one of their sub-accounts. The sub-account
          can add notes and attachments, then mark the work as done. The head reviews the submission and
          confirms before proceeding. The stage timer keeps running against the head — delegation is
          internal and does not pause the clock. Every assignment, submission, and confirmation is
          permanently trailed on the request.
        </p>
        <p className="text-[10px] text-emerald-700 font-semibold">
          Always active — no configuration needed. The &quot;Assign&quot; button appears on any request a
          department head currently holds.
        </p>
      </div>

      {/* Save button at bottom */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground text-xs font-black uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50"
        >
          <Save size={13} />
          {saving ? 'Saving…' : 'Save Pipeline Stages'}
        </button>
      </div>
    </div>
  );
}
