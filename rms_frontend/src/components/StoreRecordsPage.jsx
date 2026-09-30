import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { storeAPI } from '../lib/api';
import { toast } from 'react-hot-toast';
import {
  Package, Plus, Trash2, Edit3, Printer, ChevronLeft,
  Search, Loader2, Save, X, Building2, Users, Calendar,
  ChevronDown, FileText, BarChart2, RefreshCw, Filter
} from 'lucide-react';

// ── Pure helpers ──────────────────────────────────────────────────────────────
const fmt = (n) => (parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s) => {
  if (!s) return '';
  try { return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return s; }
};

// Cascade-recalc all rows: row 0 opens at carriedForward, each subsequent opens at previous stockBalance
const recalcAll = (rows, cf) => {
  const base = parseFloat(cf) || 0;
  return rows.map((row, i) => {
    const ob = i === 0 ? base : parseFloat(rows[i - 1]?.stockBalance ?? 0);
    const sb = ob + (parseFloat(row.qtyReceived) || 0) - (parseFloat(row.quantityIssued) || 0);
    return { ...row, openingBalance: ob, stockBalance: sb };
  });
};

const emptyRow = () => ({
  _key: Math.random(), date: '', openingBalance: 0, qtyReceived: '',
  quantityIssued: '', requisitionSlipNo: '', stockBalance: 0, materialsTaken: '', remarks: ''
});

const RANGES = [
  { label: 'All Time', value: 'all' },
  { label: 'Today',    value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
  { label: 'This Year', value: 'year' },
  { label: 'Custom',   value: 'custom' },
];

const getRangeDates = (range) => {
  const now = new Date();
  const toStr = (d) => d.toISOString().split('T')[0];
  if (range === 'today')  return { startDate: toStr(now), endDate: toStr(now) };
  if (range === 'week')   { const s = new Date(now); s.setDate(now.getDate() - now.getDay()); return { startDate: toStr(s), endDate: toStr(now) }; }
  if (range === 'month')  return { startDate: toStr(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: toStr(now) };
  if (range === 'year')   return { startDate: toStr(new Date(now.getFullYear(), 0, 1)), endDate: toStr(now) };
  return {};
};

// ── Print helper ──────────────────────────────────────────────────────────────
const printRecord = (record) => {
  const dept = record.department?.name || '';
  const headName = record.department?.headName || '';
  const rows = record.entries || [];
  const rowsHtml = rows.map(e => `
    <tr>
      <td>${e.date || ''}</td>
      <td class="num">${fmt(e.openingBalance)}</td>
      <td class="num">${fmt(e.qtyReceived)}</td>
      <td class="num">${fmt(e.quantityIssued)}</td>
      <td>${e.requisitionSlipNo || ''}</td>
      <td class="num"><strong>${fmt(e.stockBalance)}</strong></td>
      <td>${e.materialsTaken || ''}</td>
      <td>${e.remarks || ''}</td>
    </tr>`).join('');

  const win = window.open('', '_blank', 'width=1000,height=700');
  win.document.write(`<!DOCTYPE html><html><head><title>Store Record — ${record.code}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; color: #111; }
    .letterhead { text-align: center; margin-bottom: 16px; border-bottom: 2px solid #333; padding-bottom: 12px; }
    .letterhead h1 { font-size: 16px; margin: 0 0 2px; text-transform: uppercase; letter-spacing: 1px; }
    .letterhead p  { margin: 1px 0; font-size: 10px; color: #444; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin: 12px 0; border: 1px solid #999; padding: 8px 12px; }
    .meta-grid span { font-size: 10px; }
    .meta-grid strong { font-size: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: #333; color: #fff; padding: 5px 4px; font-size: 9px; text-align: center; border: 1px solid #555; }
    td { border: 1px solid #bbb; padding: 4px; font-size: 9px; vertical-align: middle; }
    td.num { text-align: right; }
    tr:nth-child(even) td { background: #f7f7f7; }
    @media print { @page { size: A4 landscape; margin: 12mm; } }
  </style></head><body>
  <div class="letterhead">
    <h1>CSS Farms — Store Record</h1>
    <p>${dept}${headName ? ' · ' + headName : ''}</p>
    <p>Printed: ${new Date().toLocaleString()}</p>
  </div>
  <div class="meta-grid">
    <span><strong>CODE:</strong> ${record.code}</span>
    <span><strong>DESCRIPTION:</strong> ${record.description}</span>
    <span><strong>LOCATION:</strong> ${record.location || '—'}</span>
    <span><strong>CARRIED FORWARD:</strong> ${fmt(record.carriedForward)}</span>
  </div>
  <table>
    <thead><tr>
      <th>Date</th><th>Opening<br/>Balance</th><th>Qty<br/>Rec.</th>
      <th>Qty<br/>Issued</th><th>Requisition<br/>Slip No.</th>
      <th>Stock<br/>Balance</th><th>Materials<br/>Taken</th><th>Remarks</th>
    </tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#888">No entries</td></tr>'}</tbody>
  </table>
  <script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>
  </body></html>`);
  win.document.close();
};

// ── Record card ───────────────────────────────────────────────────────────────
const RecordCard = ({ record, isHead, onEdit, onDelete, onPrint }) => {
  const dept = record.department;
  const lastEntry = record.entries?.at(-1);
  const [confirmDel, setConfirmDel] = useState(false);

  return (
    <div className="bg-white/80 border border-border/50 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-primary/20 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-black uppercase tracking-widest">{record.code}</span>
            {isHead && dept?.isSubAccount && (
              <span className="flex items-center gap-1 text-[10px] text-violet-600 font-semibold">
                <Building2 size={9}/> {dept.name}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-bold text-foreground leading-snug">{record.description}</p>
          {record.location && <p className="text-[11px] text-muted-foreground mt-0.5">📍 {record.location}</p>}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground">{record.entries?.length || 0} entr{record.entries?.length === 1 ? 'y' : 'ies'}</span>
            {lastEntry && <span className="text-[10px] text-muted-foreground">Stock Bal: <strong className="text-foreground">{fmt(lastEntry.stockBalance)}</strong></span>}
            <span className="text-[10px] text-muted-foreground">{fmtDate(record.updatedAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => onPrint(record)} title="Print" className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"><Printer size={14}/></button>
          <button onClick={() => onEdit(record)} title="Edit" className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"><Edit3 size={14}/></button>
          <button onClick={() => setConfirmDel(true)} title="Delete" className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"><Trash2 size={14}/></button>
        </div>
      </div>
      {confirmDel && (
        <div className="mt-3 p-3 bg-destructive/5 border border-destructive/20 rounded-xl flex items-center justify-between gap-3">
          <p className="text-xs text-destructive font-medium">Delete this record and all its entries?</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDel(false)} className="px-3 py-1 rounded-lg text-xs border border-border hover:bg-muted/50">Cancel</button>
            <button onClick={() => { setConfirmDel(false); onDelete(record.id); }} className="px-3 py-1 rounded-lg text-xs bg-destructive text-white hover:bg-destructive/90">Delete</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Entry table editor ────────────────────────────────────────────────────────
const EntryTable = ({ entries, carriedForward, onChange }) => {
  const updateRow = (i, field, value) => {
    const updated = entries.map((r, idx) => idx === i ? { ...r, [field]: value } : r);
    onChange(recalcAll(updated, carriedForward));
  };

  const addRow = () => onChange(recalcAll([...entries, emptyRow()], carriedForward));

  const removeRow = (i) => onChange(recalcAll(entries.filter((_, idx) => idx !== i), carriedForward));

  const cellCls = "border-r border-border/40 last:border-r-0";
  const inputCls = "w-full bg-transparent px-1.5 py-1 text-xs focus:outline-none focus:bg-primary/5 rounded transition-colors";

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[860px]">
          <thead>
            <tr className="bg-slate-700 text-white">
              <th className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-wider w-[100px] border-r border-slate-600">Date</th>
              <th className="px-2 py-2 text-right font-bold text-[10px] uppercase tracking-wider w-[90px] border-r border-slate-600">Opening Bal.</th>
              <th className="px-2 py-2 text-right font-bold text-[10px] uppercase tracking-wider w-[80px] border-r border-slate-600">Qty Rec.</th>
              <th className="px-2 py-2 text-right font-bold text-[10px] uppercase tracking-wider w-[80px] border-r border-slate-600">Qty Issued</th>
              <th className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-wider w-[110px] border-r border-slate-600">Req. Slip No.</th>
              <th className="px-2 py-2 text-right font-bold text-[10px] uppercase tracking-wider w-[90px] border-r border-slate-600">Stock Bal.</th>
              <th className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-wider w-[130px] border-r border-slate-600">Materials Taken</th>
              <th className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-wider border-r border-slate-600">Remarks</th>
              <th className="px-2 py-2 w-[32px]"></th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={9} className="py-6 text-center text-muted-foreground text-xs italic">No entries yet — click "Add Row" below</td></tr>
            )}
            {entries.map((row, i) => (
              <tr key={row._key ?? i} className={`border-t border-border/30 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-primary/3`}>
                <td className={cellCls}>
                  <input type="date" value={row.date || ''} onChange={e => updateRow(i, 'date', e.target.value)} className={inputCls}/>
                </td>
                <td className={cellCls + " text-right pr-2 font-medium text-muted-foreground text-[11px]"}>{fmt(row.openingBalance)}</td>
                <td className={cellCls}>
                  <input type="number" min="0" value={row.qtyReceived === '' ? '' : row.qtyReceived} onChange={e => updateRow(i, 'qtyReceived', e.target.value)} className={inputCls + " text-right"}/>
                </td>
                <td className={cellCls}>
                  <input type="number" min="0" value={row.quantityIssued === '' ? '' : row.quantityIssued} onChange={e => updateRow(i, 'quantityIssued', e.target.value)} className={inputCls + " text-right"}/>
                </td>
                <td className={cellCls}>
                  <input type="text" value={row.requisitionSlipNo || ''} onChange={e => updateRow(i, 'requisitionSlipNo', e.target.value)} className={inputCls} placeholder="—"/>
                </td>
                <td className={cellCls + " text-right pr-2"}>
                  <span className={`font-black text-[11px] ${row.stockBalance < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmt(row.stockBalance)}</span>
                </td>
                <td className={cellCls}>
                  <input type="text" value={row.materialsTaken || ''} onChange={e => updateRow(i, 'materialsTaken', e.target.value)} className={inputCls} placeholder="—"/>
                </td>
                <td className={cellCls}>
                  <input type="text" value={row.remarks || ''} onChange={e => updateRow(i, 'remarks', e.target.value)} className={inputCls} placeholder="—"/>
                </td>
                <td className="px-1 text-center">
                  <button onClick={() => removeRow(i)} className="p-0.5 text-muted-foreground hover:text-destructive transition-colors"><X size={12}/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border/40 p-2 bg-muted/20">
        <button onClick={addRow} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary hover:bg-primary/10 transition-colors">
          <Plus size={13}/> Add Row
        </button>
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
const StoreRecordsPage = ({ onViewChange }) => {
  const { user } = useAuth();
  const isAdmin   = user?.role === 'global_admin';
  const isHead    = !user?.isSubAccount;
  const canManage = isAdmin || isHead;

  // List state
  const [view, setView]             = useState('list'); // 'list' | 'form' | 'report'
  const [records, setRecords]       = useState([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [filterSubId, setFilterSubId]   = useState('');
  const [range, setRange]           = useState('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd]   = useState('');
  const [subAccounts, setSubAccounts] = useState([]);
  const [rangeOpen, setRangeOpen]   = useState(false);

  // Form state
  const [editingId, setEditingId]   = useState(null);
  const [formCode, setFormCode]     = useState('');
  const [formDesc, setFormDesc]     = useState('');
  const [formLoc, setFormLoc]       = useState('');
  const [formCF, setFormCF]         = useState('0');
  const [formEntries, setFormEntries] = useState([]);
  const [saving, setSaving]         = useState(false);
  const [cfLoading, setCfLoading]   = useState(false);

  // Load sub-accounts list for head/admin filter
  useEffect(() => {
    if (!canManage) return;
    storeAPI.subAccounts().then(data => setSubAccounts(Array.isArray(data) ? data : [])).catch(() => {});
  }, [canManage]);

  const getDateParams = useCallback(() => {
    if (range === 'custom') return { startDate: customStart, endDate: customEnd };
    return getRangeDates(range);
  }, [range, customStart, customEnd]);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = { search: search || undefined, ...getDateParams() };
      if (filterSubId) params.subAccountId = filterSubId;
      const res = await storeAPI.list(params);
      setRecords(res.data || []);
      setTotal(res.total || 0);
    } catch { toast.error('Failed to load records.'); }
    finally { setLoading(false); }
  }, [search, filterSubId, getDateParams]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  useEffect(() => {
    const handler = () => loadRecords();
    window.addEventListener('globalHardRefresh', handler);
    return () => window.removeEventListener('globalHardRefresh', handler);
  }, [loadRecords]);

  // ── Form helpers ─────────────────────────────────────────────────────────────
  const openNew = async () => {
    setEditingId(null);
    setFormCode(''); setFormDesc(''); setFormLoc('');
    setCfLoading(true);
    setFormEntries([emptyRow()]);
    setView('form');
    try {
      const { carriedForward } = await storeAPI.carriedForward(user.deptId);
      const cf = parseFloat(carriedForward) || 0;
      setFormCF(String(cf));
      setFormEntries(rows => recalcAll(rows, cf));
    } catch { setFormCF('0'); }
    finally { setCfLoading(false); }
  };

  const openEdit = (record) => {
    setEditingId(record.id);
    setFormCode(record.code);
    setFormDesc(record.description);
    setFormLoc(record.location || '');
    const cf = record.carriedForward ?? 0;
    setFormCF(String(cf));
    const rows = (record.entries || []).map(e => ({ ...e, _key: Math.random() }));
    setFormEntries(recalcAll(rows.length ? rows : [emptyRow()], cf));
    setView('form');
  };

  const handleCFChange = (val) => {
    setFormCF(val);
    setFormEntries(rows => recalcAll(rows, val));
  };

  const saveForm = async () => {
    if (!formCode.trim() || !formDesc.trim()) { toast.error('Code and description are required.'); return; }
    setSaving(true);
    try {
      const payload = {
        code: formCode.trim(), description: formDesc.trim(),
        location: formLoc.trim() || null,
        carriedForward: parseFloat(formCF) || 0,
        entries: formEntries.map(({ _key, ...e }) => ({
          ...e,
          qtyReceived: parseFloat(e.qtyReceived) || 0,
          quantityIssued: parseFloat(e.quantityIssued) || 0,
        }))
      };
      if (editingId) { await storeAPI.update(editingId, payload); toast.success('Record updated.'); }
      else           { await storeAPI.create(payload); toast.success('Record created.'); }
      setView('list');
      loadRecords();
    } catch (err) { toast.error(err?.message || 'Failed to save.'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    try {
      await storeAPI.remove(id);
      toast.success('Record deleted.');
      loadRecords();
    } catch { toast.error('Failed to delete.'); }
  };

  // ── Report print (all filtered records) ─────────────────────────────────────
  const printReport = () => {
    if (records.length === 0) { toast('No records to print.'); return; }
    const blocksHtml = records.map(record => {
      const dept = record.department?.name || '';
      const rows = record.entries || [];
      const rowsHtml = rows.map(e => `
        <tr>
          <td>${e.date || ''}</td><td class="num">${fmt(e.openingBalance)}</td>
          <td class="num">${fmt(e.qtyReceived)}</td><td class="num">${fmt(e.quantityIssued)}</td>
          <td>${e.requisitionSlipNo || ''}</td><td class="num"><strong>${fmt(e.stockBalance)}</strong></td>
          <td>${e.materialsTaken || ''}</td><td>${e.remarks || ''}</td>
        </tr>`).join('');
      return `
        <div class="record-block">
          <div class="record-header">
            <span><strong>CODE:</strong> ${record.code}</span>
            <span><strong>DESCRIPTION:</strong> ${record.description}</span>
            <span><strong>LOCATION:</strong> ${record.location || '—'}</span>
            <span><strong>C/F:</strong> ${fmt(record.carriedForward)}</span>
            ${dept ? `<span><strong>DEPT:</strong> ${dept}</span>` : ''}
          </div>
          <table>
            <thead><tr>
              <th>Date</th><th>Opening Bal.</th><th>Qty Rec.</th><th>Qty Issued</th>
              <th>Req. Slip No.</th><th>Stock Bal.</th><th>Materials Taken</th><th>Remarks</th>
            </tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#888;font-style:italic">No entries</td></tr>'}</tbody>
          </table>
        </div>`;
    }).join('<div class="page-break"></div>');

    const win = window.open('', '_blank', 'width=1000,height=700');
    win.document.write(`<!DOCTYPE html><html><head><title>Store Report</title>
    <style>
      body { font-family: Arial,sans-serif; font-size: 10px; margin: 16px; color: #111; }
      .letterhead { text-align:center; border-bottom:2px solid #333; padding-bottom:10px; margin-bottom:14px; }
      .letterhead h1 { font-size:15px; margin:0 0 2px; text-transform:uppercase; letter-spacing:1px; }
      .letterhead p { margin:1px 0; font-size:9px; color:#444; }
      .record-block { margin-bottom: 20px; }
      .record-header { display:grid; grid-template-columns:1fr 1fr; gap:3px 24px; border:1px solid #bbb; padding:6px 10px; margin-bottom:4px; font-size:9px; }
      table { width:100%; border-collapse:collapse; }
      th { background:#333; color:#fff; padding:4px 3px; font-size:8px; text-align:center; border:1px solid #555; }
      td { border:1px solid #ccc; padding:3px 4px; font-size:8px; vertical-align:middle; }
      td.num { text-align:right; }
      tr:nth-child(even) td { background:#f7f7f7; }
      .page-break { page-break-after: always; }
      @media print { @page { size: A4 landscape; margin:10mm; } }
    </style></head><body>
    <div class="letterhead">
      <h1>CSS Farms — Store Records Report</h1>
      <p>Printed: ${new Date().toLocaleString()}</p>
    </div>
    ${blocksHtml}
    <script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>
    </body></html>`);
    win.document.close();
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  // Form view
  if (view === 'form') {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
        {/* Top bar */}
        <div className="flex items-center gap-3">
          <button onClick={() => setView('list')} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft size={15}/> Back
          </button>
          <div className="h-4 w-px bg-border"/>
          <div className="flex items-center gap-2">
            <Package size={15} className="text-amber-600"/>
            <h2 className="text-sm font-black text-foreground">{editingId ? 'Edit Record' : 'New Store Record'}</h2>
          </div>
        </div>

        {/* Header card */}
        <div className="bg-white/80 border border-border/50 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block mb-1">Code *</label>
              <input value={formCode} onChange={e => setFormCode(e.target.value)} placeholder="e.g. STR-001"
                className="w-full border border-border/60 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-background"/>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block mb-1">Description *</label>
              <input value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Item description"
                className="w-full border border-border/60 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-background"/>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block mb-1">Location</label>
              <input value={formLoc} onChange={e => setFormLoc(e.target.value)} placeholder="e.g. Block A, Shelf 2"
                className="w-full border border-border/60 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-background"/>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block mb-1">
                Carried Forward {cfLoading && <span className="text-primary animate-pulse ml-1">auto-filling…</span>}
              </label>
              <input type="number" value={formCF} onChange={e => handleCFChange(e.target.value)}
                className="w-full border border-border/60 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-background"/>
              <p className="text-[10px] text-muted-foreground mt-1">Auto-filled from last stock balance. Edit if needed.</p>
            </div>
          </div>
        </div>

        {/* Table editor */}
        <div className="bg-white/80 border border-border/50 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-primary"/>
            <h3 className="text-xs font-black uppercase tracking-wider text-foreground/80">Stock Entries</h3>
            <span className="text-[10px] text-muted-foreground">· Opening Balance and Stock Balance are auto-calculated</span>
          </div>
          <EntryTable entries={formEntries} carriedForward={formCF} onChange={setFormEntries}/>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-1">
          <button onClick={() => setView('list')} className="px-4 py-2 rounded-xl border border-border/60 text-xs font-semibold hover:bg-muted/50 transition-colors">Cancel</button>
          <button onClick={saveForm} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-black uppercase tracking-wider hover:bg-primary/90 transition-all disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin"/> : <Save size={13}/>}
            {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Record'}
          </button>
        </div>
      </div>
    );
  }

  // List / Report view
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center">
            <Package size={17} className="text-amber-600"/>
          </div>
          <div>
            <h1 className="text-base font-black text-foreground">Store Records</h1>
            <p className="text-[11px] text-muted-foreground">{total} record{total !== 1 ? 's' : ''} · {user?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManage && view === 'list' && (
            <button onClick={() => setView('report')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/60 text-xs font-semibold hover:bg-muted/50 transition-colors">
              <BarChart2 size={13}/> Report
            </button>
          )}
          {view === 'report' && (
            <>
              <button onClick={printReport} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-700 text-xs font-semibold hover:bg-amber-100 transition-colors">
                <Printer size={13}/> Print Report
              </button>
              <button onClick={() => setView('list')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/60 text-xs font-semibold hover:bg-muted/50 transition-colors">
                <FileText size={13}/> Records
              </button>
            </>
          )}
          <button onClick={openNew}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-black uppercase tracking-wider hover:bg-primary/90 transition-all shadow-sm shadow-primary/20">
            <Plus size={13}/> New Record
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white/70 border border-border/40 rounded-2xl p-3 flex items-center gap-3 flex-wrap shadow-sm">
        {/* Search */}
        <div className="relative flex-1 min-w-[160px]">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code or description…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border/50 bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"/>
        </div>

        {/* Sub-account filter (head/admin only) */}
        {canManage && subAccounts.length > 0 && (
          <select value={filterSubId} onChange={e => setFilterSubId(e.target.value)}
            className="border border-border/50 rounded-lg px-2 py-1.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary/30">
            <option value="">All Units</option>
            {subAccounts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}

        {/* Date range */}
        <div className="relative" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setRangeOpen(false); }}>
          <button onClick={() => setRangeOpen(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border/50 rounded-lg text-xs bg-background hover:bg-muted/40 transition-colors">
            <Calendar size={11}/> {RANGES.find(r => r.value === range)?.label || 'All Time'}
            <ChevronDown size={10} className={`transition-transform ${rangeOpen ? 'rotate-180' : ''}`}/>
          </button>
          {rangeOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-background border border-border rounded-xl shadow-xl w-44 py-1">
              {RANGES.map(r => (
                <button key={r.value} onClick={() => { setRange(r.value); setRangeOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors ${range === r.value ? 'text-primary font-semibold' : ''}`}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Custom date inputs */}
        {range === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="border border-border/50 rounded-lg px-2 py-1.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"/>
            <span className="text-xs text-muted-foreground">—</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="border border-border/50 rounded-lg px-2 py-1.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"/>
          </div>
        )}

        <button onClick={loadRecords} className="p-1.5 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/>
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 size={24} className="animate-spin text-primary"/>
          <p className="text-xs text-muted-foreground">Loading records…</p>
        </div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
            <Package size={24} className="text-amber-400"/>
          </div>
          <p className="text-sm font-semibold text-foreground/70">No records found</p>
          <p className="text-xs text-muted-foreground">Create your first stock record using the button above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map(r => (
            <RecordCard key={r.id} record={r} isHead={canManage}
              onEdit={openEdit} onDelete={handleDelete} onPrint={printRecord}/>
          ))}
        </div>
      )}
    </div>
  );
};

export default StoreRecordsPage;
