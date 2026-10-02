import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRef } from 'react';
import {
  Plus, Trash2, Building2, Briefcase, Search,
  Eye, EyeOff, Pencil, X, Save, Loader2, KeyRound,
  CheckCircle2, RotateCcw, Info, User, Mail, Phone, Hash, BadgeCheck, Download,
  Upload, PenTool, AlertTriangle, ShieldAlert, ShieldCheck, FileSpreadsheet, FileDown,
  ChevronDown, ChevronUp, Filter, Send
} from 'lucide-react';
import { getDepartments, addDepartment, deleteDepartment } from '../lib/store';
import { deptAPI, reqAPI, adminAPI } from '../lib/api';
import { loadFeatureFlag } from '../lib/featureFlag';
import { toast } from 'react-hot-toast';
import ConfirmModal from './ConfirmModal';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';

// ── Auto-generated Department Seal SVG ────────────────────────────────────────
const DepartmentSeal = ({ name, id = '' }) => {
  const cx = 125, cy = 125;
  const color = '#1a5c1a';
  const date = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  }).toUpperCase();

  const uid = id ? `${id}` : name.replace(/[^a-zA-Z0-9]/g, '_');
  const arcR = 93;
  const topId = `sealTop_${uid}`;
  const botId = `sealBot_${uid}`;

  const len = name.length;
  const fontSize = len <= 14 ? 12.5 : len <= 22 ? 11 : 9.5;
  const letterSpacing = len <= 14 ? 2 : len <= 22 ? 1.2 : 0.8;

  return (
    <svg viewBox="0 0 250 250" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <defs>
        {/* Top arc: sweep=1 → path goes over the top, text reads left-to-right outward */}
        <path id={topId} d={`M ${cx - arcR},${cy} a ${arcR},${arcR} 0 0,1 ${arcR * 2},0`} />
        {/* Bottom arc: sweep=0 → path goes under the bottom, text reads left-to-right inward */}
        <path id={botId} d={`M ${cx - arcR},${cy} a ${arcR},${arcR} 0 0,0 ${arcR * 2},0`} />
      </defs>

      {/* White background */}
      <circle cx={cx} cy={cy} r={120} fill="white" />

      {/* Outer double rings */}
      <circle cx={cx} cy={cy} r={116} fill="none" stroke={color} strokeWidth="4.5" />
      <circle cx={cx} cy={cy} r={107} fill="none" stroke={color} strokeWidth="1.5" />

      {/* Inner ring */}
      <circle cx={cx} cy={cy} r={72} fill="none" stroke={color} strokeWidth="1.5" />

      {/* Department name on top arc */}
      <text fontSize={fontSize} fontWeight="bold" fontFamily="Arial, sans-serif"
        letterSpacing={letterSpacing} fill={color}>
        <textPath href={`#${topId}`} startOffset="50%" textAnchor="middle">
          {name.toUpperCase()}
        </textPath>
      </text>

      {/* "DEPARTMENT" on bottom arc */}
      <text fontSize="10" fontWeight="bold" fontFamily="Arial, sans-serif"
        letterSpacing="2.5" fill={color}>
        <textPath href={`#${botId}`} startOffset="50%" textAnchor="middle">
          DEPARTMENT
        </textPath>
      </text>

      {/* Diamond separators at equator */}
      <text x={cx - arcR - 4} y={cy + 4} fontSize="8" fill={color} textAnchor="middle">◆</text>
      <text x={cx + arcR + 4} y={cy + 4} fontSize="8" fill={color} textAnchor="middle">◆</text>

      {/* CSS Farms logo centered */}
      <image href="/CSS_Group.png" x={cx - 45} y={cy - 32} width="90" height="50"
        preserveAspectRatio="xMidYMid meet" />

      {/* Thin divider below logo */}
      <line x1={cx - 44} y1={cy + 22} x2={cx + 44} y2={cy + 22} stroke={color} strokeWidth="0.8" />

      {/* Date below divider */}
      <text x={cx} y={cy + 35} textAnchor="middle" fontSize="8" fontFamily="Arial, sans-serif"
        fontWeight="bold" letterSpacing="1" fill={color}>{date}</text>
    </svg>
  );
};

// ── Seal View Modal ────────────────────────────────────────────────────────────
const SealViewModal = ({ dept, onClose }) => {
  const handleDownload = async () => {
    const svgEl = document.getElementById('seal-svg-export');
    if (!svgEl) return;

    // Inline CSS_Group.png as base64 so the downloaded SVG is self-contained
    let logoDataUrl = null;
    try {
      const res = await fetch('/CSS_Group.png');
      const blob = await res.blob();
      logoDataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch { /* logo unavailable — download without it */ }

    const clone = svgEl.cloneNode(true);
    if (logoDataUrl) {
      const imgEl = clone.querySelector('image');
      if (imgEl) imgEl.setAttribute('href', logoDataUrl);
    }

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(clone);
    const dlBlob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(dlBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dept.name.replace(/\s+/g, '_')}_Seal.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border/30">
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-foreground">Department Seal</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">{dept.name} · Auto-generated · Live Date</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl text-muted-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Seal preview */}
        <div className="p-8 flex items-center justify-center">
          <div id="seal-svg-export" className="w-60 h-60 drop-shadow-xl">
            <DepartmentSeal name={dept.name} id={String(dept.id)} />
          </div>
        </div>

        {/* Info strip */}
        <div className="mx-6 mb-4 p-3 bg-primary/5 rounded-xl flex items-start gap-2">
          <Info size={12} className="text-primary shrink-0 mt-0.5" />
          <p className="text-[10px] text-primary/80 font-medium leading-relaxed">
            This seal is auto-generated for <strong>{dept.name}</strong>. The date shown is always today's date. It appears as a watermark on official PDF documents from this department.
          </p>
        </div>

        {/* Download button */}
        <div className="px-6 pb-6">
          <button
            onClick={handleDownload}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-primary/30 text-primary font-bold text-xs uppercase tracking-widest hover:bg-primary/5 transition-all active:scale-[0.98]"
          >
            <Download size={14} />
            Download Seal (SVG)
          </button>
        </div>
      </div>
    </div>
  );
};


// ── Critical-name detector — kept in sync with isCriticalDeptName() in serve.js ─
const CRITICAL_DEPT_PATTERNS = [
  /ceo|chairman/i,
  /general\s*manager|\bgm\b/i,
  /\bhr\b|human\s*resource/i,
  /account/i,
];
function isCriticalDeptName(name) {
  const n = (name || '').trim();
  if (n.toLowerCase() === 'super admin') return true;
  return CRITICAL_DEPT_PATTERNS.some(re => re.test(n));
}


// ── Edit Department Modal ─────────────────────────────────────────────────────
const EditDeptModal = ({ dept, onClose, onSaved }) => {
  const isCritical = isCriticalDeptName(dept.name);

  // Parse existing headName into surname / firstName / otherName parts
  const existingParts = (dept.headName || '').trim().split(/\s+/);
  const [form, setForm] = useState({
    name: dept.name || '',
    type: dept.type || 'Operational',
    headStaffId:   dept.staffId || '',
    headSurname:   existingParts[0] || '',
    headFirstName: existingParts[1] || '',
    headOtherName: existingParts.slice(2).join(' ') || '',
    headTitle: dept.headTitle || '',
    headEmail: dept.headEmail || '',
    phone: dept.phone || '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.headStaffId.trim()) { toast.error('Staff ID is required.'); return; }
    if (!form.headSurname.trim()) { toast.error('Surname is required.'); return; }
    if (!form.headFirstName.trim()) { toast.error('First name is required.'); return; }
    if (!form.headTitle.trim()) { toast.error('Designation / Title is required — the dashboard treats a profile without one as incomplete and will keep asking the department to set it.'); return; }
    if (!form.headEmail.trim()) { toast.error('Official email is required.'); return; }
    if (!form.phone.trim()) { toast.error('Contact phone is required — used to SMS the access code.'); return; }
    const combinedName = [form.headSurname, form.headFirstName, form.headOtherName].map(s => s.trim()).filter(Boolean).join(' ');
    // Always send the original name for critical depts so the server value never drifts
    const nameToSend = isCritical ? dept.name : form.name.trim();
    if (!nameToSend) { toast.error('Department name is required.'); return; }
    setSaving(true);
    try {
      await deptAPI.updateDepartment(dept.id, { ...form, name: nameToSend, headName: combinedName, staffId: form.headStaffId.trim().toUpperCase() });
      toast.success(`${nameToSend} updated successfully.`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update department.');
    } finally { setSaving(false); }
  };

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="sticky top-0 bg-white rounded-t-3xl px-6 pt-6 pb-4 border-b border-border/30 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isCritical ? 'bg-amber-500/10 text-amber-600' : 'bg-primary/10 text-primary'}`}>
                <Building2 size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black uppercase tracking-widest text-foreground">Edit Department</h3>
                  {isCritical && (
                    <span className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20">
                      <KeyRound size={9} /> System-Critical
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate max-w-[220px]">{dept.name}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl text-muted-foreground transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Critical dept notice */}
        {isCritical && (
          <div className="mx-6 mt-4 flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
            <KeyRound size={13} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700 font-medium leading-relaxed">
              <strong>Name is locked.</strong> This department's name is tied to the system's approval routing and workflow logic. You can update the Head Official's details freely, but the department name cannot be changed.
            </p>
          </div>
        )}

        <form onSubmit={handleSave} className="p-6 space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <p className="text-[9px] font-black text-muted-foreground/50 uppercase tracking-[0.25em]">Basic Information</p>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                Department Name
                {isCritical && <KeyRound size={10} className="text-amber-500" />}
              </label>
              {isCritical ? (
                <div className="flex items-center gap-2 w-full border border-amber-200 bg-amber-50/60 rounded-xl px-4 py-3">
                  <span className="flex-1 text-sm font-bold text-foreground">{dept.name}</span>
                  <span className="text-[9px] font-black text-amber-600 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full uppercase tracking-widest shrink-0">Locked</span>
                </div>
              ) : (
                <input
                  value={form.name}
                  onChange={set('name')}
                  className="w-full border border-border/50 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {['Operational', 'Strategic'].map(t => (
                <button key={t} type="button" onClick={() => setForm(f => ({ ...f, type: t }))}
                  className={`py-2.5 rounded-xl border text-xs font-bold uppercase tracking-tight transition-all ${form.type === t ? 'bg-primary/10 border-primary/50 text-primary' : 'border-border/50 text-muted-foreground hover:border-border'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Head Info */}
          <div className="space-y-4">
            <p className="text-[9px] font-black text-muted-foreground/50 uppercase tracking-[0.25em]">Head Official</p>
            {[
              { key: 'headStaffId',   label: 'Staff ID',            icon: Hash,       placeholder: 'e.g. CSS001', required: true },
              { key: 'headSurname',   label: 'Surname',             icon: User,       placeholder: 'e.g. Musa', required: true },
              { key: 'headFirstName', label: 'First Name',           icon: User,       placeholder: 'e.g. Chindo', required: true },
              { key: 'headOtherName', label: 'Other Name',           icon: User,       placeholder: 'e.g. James (optional)' },
              { key: 'headTitle',     label: 'Designation / Title',  icon: BadgeCheck, placeholder: 'General Manager', required: true },
              { key: 'headEmail',     label: 'Official Email',       icon: Mail,       placeholder: 'head@cssgroup.internal', type: 'email', required: true },
              { key: 'phone',         label: 'Contact Phone',        icon: Phone,      placeholder: '+234 800 000 0000', required: true },
            ].map(({ key, label, icon: Icon, placeholder, type, required }) => (
              <div key={key} className="relative">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">
                  {label}{required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                <div className="flex items-center border border-border/50 rounded-xl focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 bg-white">
                  <Icon size={14} className="text-muted-foreground ml-3 shrink-0" />
                  <input value={form[key]} onChange={set(key)} type={type || 'text'} placeholder={placeholder} required={required}
                    className="flex-1 px-3 py-3 text-sm font-medium bg-transparent outline-none" />
                </div>
              </div>
            ))}
          </div>

          <button type="submit" disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground font-bold py-3 rounded-xl text-xs uppercase tracking-widest hover:bg-primary/90 transition-all disabled:opacity-50 shadow-lg shadow-primary/20 active:scale-95">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save Department'}
          </button>
        </form>
      </div>
    </div>
  );
};


// ── Onboarding Export Columns ─────────────────────────────────────────────────
const OB_EXPORT_COLUMNS = [
  { key: 'surname',       label: 'Surname',          defaultOn: true  },
  { key: 'firstName',     label: 'First Name',       defaultOn: true  },
  { key: 'middleName',    label: 'Other Name',       defaultOn: true  },
  { key: 'staffId',       label: 'Staff ID',         defaultOn: true  },
  { key: 'deptName',      label: 'Department',       defaultOn: true  },
  { key: 'role',          label: 'Role',             defaultOn: true  },
  { key: 'phone',         label: 'Phone',            defaultOn: true  },
  { key: 'personalEmail', label: 'Personal Email',   defaultOn: true  },
  { key: 'officialEmail', label: 'Official Email',   defaultOn: true  },
  { key: 'status',        label: 'Status',           defaultOn: true  },
  { key: 'submittedAt',   label: 'Submitted Date',   defaultOn: true  },
];

const OB_COL_WEIGHTS = {
  surname: 4, firstName: 4, middleName: 3, staffId: 3, deptName: 5,
  role: 3, phone: 4, personalEmail: 6, officialEmail: 6, status: 3, submittedAt: 4,
};

// ── Onboarding Export Modal ───────────────────────────────────────────────────
const OnboardingExportModal = ({ submissions, currentFilter, onClose }) => {
  const [format, setFormat]         = useState('excel');
  const [colVisible, setColVisible] = useState(() =>
    Object.fromEntries(OB_EXPORT_COLUMNS.map(c => [c.key, c.defaultOn]))
  );
  const [statusFilter, setStatusFilter] = useState('current'); // 'current' | 'ALL' | specific status
  const [exporting, setExporting]   = useState(false);

  const STATUS_OPTIONS = ['PENDING', 'DEPT_PENDING', 'APPROVED', 'REJECTED', 'ALL'];
  const visibleCols = OB_EXPORT_COLUMNS.filter(c => colVisible[c.key]);

  const toggleCol = (key) => setColVisible(v => ({ ...v, [key]: !v[key] }));

  const filteredSubs = statusFilter === 'current'
    ? submissions
    : statusFilter === 'ALL'
      ? submissions // already all when fetched with ALL
      : submissions.filter(s => s.status === statusFilter);

  const buildRows = () => filteredSubs.map(s => ({
    surname:       s.surname       || '',
    firstName:     s.firstName     || '',
    middleName:    s.middleName    || '',
    staffId:       s.staffId       || '',
    deptName:      s.deptName      || '',
    role:          s.role === 'HEAD' ? 'Head of Dept' : s.role === 'ASSISTANT' ? 'Assistant' : s.role || '',
    phone:         s.phone         || '',
    personalEmail: s.personalEmail || '',
    officialEmail: s.officialEmail || '',
    status:        s.status        || '',
    submittedAt:   s.submittedAt ? new Date(s.submittedAt).toLocaleDateString('en-GB') : '',
  }));

  const handleExport = async () => {
    if (visibleCols.length === 0) { toast.error('Select at least one column.'); return; }
    if (filteredSubs.length === 0) { toast.error('No submissions to export.'); return; }
    setExporting(true);
    try {
      const rows = buildRows();
      const headers = visibleCols.map(c => c.label);
      const data = rows.map(r => visibleCols.map(c => r[c.key] ?? ''));
      const dateStr = new Date().toISOString().slice(0, 10);

      if (format === 'excel') {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
        ws['!cols'] = headers.map((h, i) => ({
          wch: Math.max(h.length, ...data.map(r => String(r[i] || '').length)) + 2
        }));
        XLSX.utils.book_append_sheet(wb, ws, 'Onboarding Submissions');
        XLSX.writeFile(wb, `Onboarding_Export_${dateStr}.xlsx`);
        toast.success('Excel file downloaded.');
      } else {
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 10;
        const usable = pageW - margin * 2;
        const FONT_SIZE = 6.5;
        const LINE_H = 3.8;
        const CELL_PAD_V = 2.5;
        const HEADER_H = 8;

        const totalWeight = visibleCols.reduce((s, c) => s + (OB_COL_WEIGHTS[c.key] || 3), 0);
        const colWidths = visibleCols.map(c => Math.floor(usable * (OB_COL_WEIGHTS[c.key] || 3) / totalWeight));
        const widthSum = colWidths.reduce((a, b) => a + b, 0);
        colWidths[colWidths.length - 1] += usable - widthSum;

        const colX = colWidths.reduce((acc, w, i) => {
          acc.push(i === 0 ? margin : acc[i - 1] + colWidths[i - 1]);
          return acc;
        }, []);

        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text('Onboarding Submissions', margin, 12);
        doc.setFontSize(8);
        doc.setFont(undefined, 'normal');
        const filterLabel = statusFilter === 'current' ? `Filter: ${currentFilter || 'Current'}` : `Filter: ${statusFilter}`;
        doc.text(`Generated: ${new Date().toLocaleString()}  ·  ${filteredSubs.length} record(s)  ·  ${filterLabel}`, margin, 18);

        let y = 24;

        const drawHeader = () => {
          doc.setFillColor(25, 70, 140);
          doc.rect(margin, y, usable, HEADER_H, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(FONT_SIZE - 0.5);
          doc.setFont(undefined, 'bold');
          headers.forEach((h, i) => {
            doc.text(h.toUpperCase(), colX[i] + 1.5, y + 5.2, { maxWidth: colWidths[i] - 3 });
          });
          doc.setTextColor(0, 0, 0);
          doc.setFont(undefined, 'normal');
          y += HEADER_H;
        };
        drawHeader();

        data.forEach((row, ri) => {
          doc.setFontSize(FONT_SIZE);
          const splitCells = row.map((cell, i) =>
            doc.splitTextToSize(String(cell || '—'), colWidths[i] - 3)
          );
          const maxLines = Math.max(...splitCells.map(lines => lines.length));
          const dynH = Math.max(6, maxLines * LINE_H + CELL_PAD_V * 2);

          if (y + dynH > pageH - margin) {
            doc.addPage();
            y = margin;
            drawHeader();
          }

          if (ri % 2 === 0) {
            doc.setFillColor(240, 244, 252);
            doc.rect(margin, y, usable, dynH, 'F');
          }

          doc.setFontSize(FONT_SIZE);
          splitCells.forEach((lines, i) => {
            doc.text(lines, colX[i] + 1.5, y + CELL_PAD_V + LINE_H * 0.8);
          });

          doc.setDrawColor(210, 218, 235);
          doc.setLineWidth(0.1);
          doc.line(margin, y + dynH, margin + usable, y + dynH);

          y += dynH;
        });

        doc.save(`Onboarding_Export_${dateStr}.pdf`);
        toast.success('PDF file downloaded.');
      }
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Export failed: ' + err.message);
    } finally { setExporting(false); }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-600">
              <FileDown size={16} />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-foreground">Export Onboarding Data</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">Choose format and columns to include in the export</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl text-muted-foreground transition-colors"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-6">

          {/* Format */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Export Format</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'excel', label: 'Excel (.xlsx)', icon: FileSpreadsheet, color: 'emerald' },
                { id: 'pdf',   label: 'PDF Document',  icon: FileDown,        color: 'red'     },
              ].map(({ id, label, icon: Icon, color }) => (
                <button key={id} onClick={() => setFormat(id)}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all ${format === id ? `border-${color}-500 bg-${color}-50 text-${color}-700` : 'border-border/50 text-muted-foreground hover:border-border'}`}>
                  <Icon size={18} className={format === id ? `text-${color}-600` : 'text-muted-foreground'} />
                  <span className="text-xs font-bold">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Status scope */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Records to Include</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { val: 'current', label: `Current view (${submissions.length})` },
                { val: 'PENDING',     label: 'Pending only' },
                { val: 'APPROVED',    label: 'Approved only' },
                { val: 'REJECTED',    label: 'Rejected only' },
                { val: 'DEPT_PENDING',label: 'Dept Pending' },
                { val: 'ALL',         label: 'All statuses' },
              ].map(({ val, label }) => (
                <button key={val} onClick={() => setStatusFilter(val)}
                  className={`px-3 py-2 rounded-xl border text-[11px] font-bold transition-all ${statusFilter === val ? 'bg-blue-600 text-white border-blue-600' : 'border-border/50 text-muted-foreground hover:border-blue-300'}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">{filteredSubs.length} record{filteredSubs.length !== 1 ? 's' : ''} will be exported</p>
          </div>

          {/* Columns */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Columns to Export</p>
              <div className="flex gap-3">
                <button onClick={() => setColVisible(Object.fromEntries(OB_EXPORT_COLUMNS.map(c => [c.key, true])))}
                  className="text-[9px] font-black text-primary hover:underline uppercase tracking-widest">All</button>
                <button onClick={() => setColVisible(Object.fromEntries(OB_EXPORT_COLUMNS.map(c => [c.key, false])))}
                  className="text-[9px] font-black text-muted-foreground hover:text-destructive hover:underline uppercase tracking-widest">None</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {OB_EXPORT_COLUMNS.map(col => (
                <label key={col.key} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition-all ${colVisible[col.key] ? 'bg-blue-500/5 border border-blue-500/20' : 'border border-border/40 hover:border-border'}`}>
                  <input type="checkbox" checked={!!colVisible[col.key]} onChange={() => toggleCol(col.key)}
                    className="w-3.5 h-3.5 accent-blue-600 rounded shrink-0" />
                  <span className={`text-[11px] font-bold ${colVisible[col.key] ? 'text-foreground' : 'text-muted-foreground/50 line-through'}`}>{col.label}</span>
                </label>
              ))}
            </div>
            <p className="text-[9px] text-muted-foreground/60 font-medium">{visibleCols.length} of {OB_EXPORT_COLUMNS.length} columns selected</p>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/20 bg-muted/10 shrink-0 flex items-center justify-between gap-3">
          <p className="text-[10px] text-muted-foreground">{filteredSubs.length} records · {visibleCols.length} columns</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border text-xs font-bold text-muted-foreground hover:bg-muted transition-all">Cancel</button>
            <button onClick={handleExport} disabled={exporting || visibleCols.length === 0 || filteredSubs.length === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-widest transition-all disabled:opacity-50 shadow-sm active:scale-95">
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
              {exporting ? 'Exporting…' : `Export ${filteredSubs.length} Records`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Export Columns definition (shared) ────────────────────────────────────────
const EXPORT_COLUMNS = [
  { key: 'name',        label: 'Department Name',  defaultOn: true },
  { key: 'type',        label: 'Category',         defaultOn: true },
  { key: 'staffId',     label: 'Staff ID',         defaultOn: true },
  { key: 'surname',     label: 'Surname',          defaultOn: true },
  { key: 'firstName',   label: 'First Name',       defaultOn: true },
  { key: 'otherName',   label: 'Other Name',       defaultOn: true },
  { key: 'headTitle',   label: 'Designation',      defaultOn: true },
  { key: 'headEmail',   label: 'Official Email',   defaultOn: true },
  { key: 'phone',       label: 'Contact Phone',    defaultOn: true },
  { key: 'accessCode',  label: 'Login Code',       defaultOn: false },
  { key: 'parentName',  label: 'Parent Department', defaultOn: false },
];

// ── Export Modal ──────────────────────────────────────────────────────────────
const ExportModal = ({ departments, onClose }) => {
  const mainDepts = departments.filter(d => !d.isSubAccount);
  const subAccounts = departments.filter(d => d.isSubAccount);

  const [format, setFormat] = useState('excel');
  const [includeSubAccounts, setIncludeSubAccounts] = useState(false);
  const [excludeEmpty, setExcludeEmpty] = useState(false);
  const [colVisible, setColVisible] = useState(() =>
    Object.fromEntries(EXPORT_COLUMNS.map(c => [c.key, c.defaultOn]))
  );
  const [selectedDepts, setSelectedDepts] = useState(() => new Set(mainDepts.map(d => d.id)));
  const [deptSearch, setDeptSearch] = useState('');
  const [deptListOpen, setDeptListOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const hasRecords = (d) => !!(d.headName?.trim() || d.staffId?.trim() || d.headEmail?.trim());

  const toggleCol = (key) => setColVisible(v => ({ ...v, [key]: !v[key] }));
  const toggleDept = (id) => setSelectedDepts(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectAllDepts = () => setSelectedDepts(new Set(mainDepts.map(d => d.id)));
  const clearAllDepts = () => setSelectedDepts(new Set());
  const selectWithRecords = () => setSelectedDepts(new Set(mainDepts.filter(hasRecords).map(d => d.id)));

  const visibleCols = EXPORT_COLUMNS.filter(c => colVisible[c.key]);

  // Build the rows to export
  const buildRows = () => {
    const rows = [];
    const chosen = mainDepts.filter(d => selectedDepts.has(d.id) && (!excludeEmpty || hasRecords(d)));
    const allRaw = includeSubAccounts
      ? departments
      : departments.filter(d => !d.isSubAccount);

    for (const dept of chosen) {
      const nameParts = (dept.headName || '').trim().split(/\s+/).filter(Boolean);
      rows.push({
        name:       dept.name,
        type:       dept.type || '',
        staffId:    dept.staffId || '',
        surname:    nameParts[0] || '',
        firstName:  nameParts[1] || '',
        otherName:  nameParts.slice(2).join(' ') || '',
        headTitle:  dept.headTitle || '',
        headEmail:  dept.headEmail || '',
        phone:      dept.phone || '',
        accessCode: dept.accessCodeLabel || dept.accessCode || '',
        parentName: '',
        _isMain: true,
      });
      if (includeSubAccounts) {
        const subs = subAccounts.filter(s => s.parentId === dept.id);
        for (const sub of subs) {
          const sp = (sub.headName || '').trim().split(/\s+/).filter(Boolean);
          rows.push({
            name:       `  ↳ ${sub.name}`,
            type:       sub.type || '',
            staffId:    sub.staffId || '',
            surname:    sp[0] || '',
            firstName:  sp[1] || '',
            otherName:  sp.slice(2).join(' ') || '',
            headTitle:  sub.headTitle || '',
            headEmail:  sub.headEmail || '',
            phone:      sub.phone || '',
            accessCode: sub.accessCodeLabel || sub.accessCode || '',
            parentName: dept.name,
            _isMain: false,
          });
        }
      }
    }
    return rows;
  };

  const handleExport = async () => {
    if (visibleCols.length === 0) { toast.error('Select at least one column.'); return; }
    if (selectedDepts.size === 0) { toast.error('Select at least one department.'); return; }
    setExporting(true);
    try {
      const rows = buildRows();
      const headers = visibleCols.map(c => c.label);
      const data = rows.map(r => visibleCols.map(c => r[c.key] ?? ''));

      if (format === 'excel') {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
        // Column widths
        ws['!cols'] = headers.map((h, i) => ({ wch: Math.max(h.length, ...data.map(r => String(r[i] || '').length)) + 2 }));
        XLSX.utils.book_append_sheet(wb, ws, 'Enrolled HODs');
        XLSX.writeFile(wb, `Dept_HOD_Export_${new Date().toISOString().slice(0,10)}.xlsx`);
        toast.success('Excel file downloaded.');
      } else {
        // PDF — always landscape for best fit
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth(); // 297mm
        const pageH = doc.internal.pageSize.getHeight(); // 210mm
        const margin = 10;
        const usable = pageW - margin * 2; // 277mm
        const FONT_SIZE = 6.5;
        const LINE_H = 3.8; // mm per text line at 6.5pt
        const CELL_PAD_V = 2.5; // top+bottom padding per cell
        const HEADER_H = 8;

        // Weighted column widths — proportional to expected content
        const COL_WEIGHTS = {
          name: 5, type: 3, staffId: 3, surname: 4, firstName: 4,
          otherName: 4, headTitle: 5, headEmail: 7, phone: 4,
          accessCode: 3, parentName: 4,
        };
        const totalWeight = visibleCols.reduce((s, c) => s + (COL_WEIGHTS[c.key] || 3), 0);
        const colWidths = visibleCols.map(c => Math.floor(usable * (COL_WEIGHTS[c.key] || 3) / totalWeight));
        // Distribute any rounding remainder to last column
        const widthSum = colWidths.reduce((a, b) => a + b, 0);
        colWidths[colWidths.length - 1] += usable - widthSum;

        // X positions
        const colX = colWidths.reduce((acc, w, i) => {
          acc.push(i === 0 ? margin : acc[i - 1] + colWidths[i - 1]);
          return acc;
        }, []);

        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text('Enrolled Heads of Department', margin, 12);
        doc.setFontSize(8);
        doc.setFont(undefined, 'normal');
        doc.text(`Generated: ${new Date().toLocaleString()}  ·  ${rows.length} record(s)${excludeEmpty ? '  ·  Empty depts excluded' : ''}`, margin, 18);

        let y = 24;

        const drawHeader = () => {
          doc.setFillColor(30, 92, 30);
          doc.rect(margin, y, usable, HEADER_H, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(FONT_SIZE - 0.5);
          doc.setFont(undefined, 'bold');
          headers.forEach((h, i) => {
            doc.text(h.toUpperCase(), colX[i] + 1.5, y + 5.2, { maxWidth: colWidths[i] - 3 });
          });
          doc.setTextColor(0, 0, 0);
          doc.setFont(undefined, 'normal');
          y += HEADER_H;
        };
        drawHeader();

        data.forEach((row, ri) => {
          // Pre-split each cell and find the tallest cell in this row
          doc.setFontSize(FONT_SIZE);
          const splitCells = row.map((cell, i) =>
            doc.splitTextToSize(String(cell || '—'), colWidths[i] - 3)
          );
          const maxLines = Math.max(...splitCells.map(lines => lines.length));
          const dynH = Math.max(6, maxLines * LINE_H + CELL_PAD_V * 2);

          if (y + dynH > pageH - margin) {
            doc.addPage();
            y = margin;
            drawHeader();
          }

          // Row background
          if (ri % 2 === 0) {
            doc.setFillColor(245, 248, 245);
            doc.rect(margin, y, usable, dynH, 'F');
          }

          // Cell text
          doc.setFontSize(FONT_SIZE);
          splitCells.forEach((lines, i) => {
            doc.text(lines, colX[i] + 1.5, y + CELL_PAD_V + LINE_H * 0.8);
          });

          // Bottom border
          doc.setDrawColor(220, 225, 220);
          doc.setLineWidth(0.1);
          doc.line(margin, y + dynH, margin + usable, y + dynH);

          y += dynH;
        });

        doc.save(`Dept_HOD_Export_${new Date().toISOString().slice(0,10)}.pdf`);
        toast.success('PDF file downloaded.');
      }
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Export failed. Please try again.');
    } finally { setExporting(false); }
  };

  const filteredMainDepts = mainDepts.filter(d =>
    d.name.toLowerCase().includes(deptSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <FileDown size={16} />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-foreground">Export HOD Directory</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">Choose format, columns, and departments to include</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl text-muted-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-6">

          {/* Format selector */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Export Format</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'excel', label: 'Excel (.xlsx)', icon: FileSpreadsheet, color: 'emerald' },
                { id: 'pdf',   label: 'PDF Document',  icon: FileDown,        color: 'red' },
              ].map(({ id, label, icon: Icon, color }) => (
                <button
                  key={id}
                  onClick={() => setFormat(id)}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all ${format === id ? `border-${color}-500 bg-${color}-50 text-${color}-700` : 'border-border/50 text-muted-foreground hover:border-border'}`}
                >
                  <Icon size={18} className={format === id ? `text-${color}-600` : 'text-muted-foreground'} />
                  <span className="text-xs font-bold">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Sub-accounts + empty toggles */}
          <div className="space-y-2">
            <label className="flex items-center gap-3 p-3.5 rounded-xl border border-border/50 cursor-pointer hover:border-primary/30 transition-all">
              <input type="checkbox" checked={includeSubAccounts} onChange={e => setIncludeSubAccounts(e.target.checked)} className="w-4 h-4 accent-primary rounded" />
              <div className="flex-1">
                <p className="text-xs font-bold text-foreground">Include Sub-Accounts</p>
                <p className="text-[10px] text-muted-foreground">Sub-accounts will appear indented beneath their parent department</p>
              </div>
              <span className="text-[9px] font-black text-muted-foreground/50 bg-muted px-2 py-0.5 rounded-full">{subAccounts.length} sub-accounts</span>
            </label>
            <label className="flex items-center gap-3 p-3.5 rounded-xl border border-border/50 cursor-pointer hover:border-amber-300 transition-all">
              <input type="checkbox" checked={excludeEmpty} onChange={e => setExcludeEmpty(e.target.checked)} className="w-4 h-4 accent-amber-500 rounded" />
              <div className="flex-1">
                <p className="text-xs font-bold text-foreground">Exclude departments with no records</p>
                <p className="text-[10px] text-muted-foreground">Skip departments that have no head assigned (no name, staff ID, or email)</p>
              </div>
              <span className="text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                {mainDepts.filter(d => !hasRecords(d)).length} empty
              </span>
            </label>
          </div>

          {/* Column visibility */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Columns to Export</p>
            <div className="grid grid-cols-2 gap-1.5">
              {EXPORT_COLUMNS.map(col => (
                <label key={col.key} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition-all ${colVisible[col.key] ? 'bg-primary/5 border border-primary/20' : 'border border-border/40 hover:border-border'}`}>
                  <input
                    type="checkbox"
                    checked={!!colVisible[col.key]}
                    onChange={() => toggleCol(col.key)}
                    className="w-3.5 h-3.5 accent-primary rounded shrink-0"
                  />
                  <span className={`text-[11px] font-bold ${colVisible[col.key] ? 'text-foreground' : 'text-muted-foreground/50 line-through'}`}>{col.label}</span>
                  {!col.defaultOn && <span className="ml-auto text-[8px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1 rounded shrink-0">Sensitive</span>}
                </label>
              ))}
            </div>
            <p className="text-[9px] text-muted-foreground/60 font-medium">{visibleCols.length} of {EXPORT_COLUMNS.length} columns selected</p>
          </div>

          {/* Department filter */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Departments to Include</p>
              <div className="flex items-center gap-2">
                <button onClick={selectAllDepts} className="text-[9px] font-black text-primary hover:underline uppercase tracking-widest">All</button>
                <span className="text-muted-foreground/40">·</span>
                <button onClick={selectWithRecords} className="text-[9px] font-black text-amber-600 hover:underline uppercase tracking-widest">With Records</button>
                <span className="text-muted-foreground/40">·</span>
                <button onClick={clearAllDepts} className="text-[9px] font-black text-muted-foreground hover:text-destructive hover:underline uppercase tracking-widest">None</button>
              </div>
            </div>

            {/* Search + dropdown toggle */}
            <div className="border border-border/50 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30">
                <Search size={13} className="text-muted-foreground shrink-0" />
                <input
                  value={deptSearch}
                  onChange={e => setDeptSearch(e.target.value)}
                  placeholder="Search departments..."
                  className="flex-1 text-xs bg-transparent outline-none text-foreground placeholder-muted-foreground/50"
                />
                <span className="text-[9px] font-black text-muted-foreground/50 bg-muted px-2 py-0.5 rounded-full shrink-0">{selectedDepts.size} selected</span>
                <button onClick={() => setDeptListOpen(o => !o)} className="text-muted-foreground hover:text-primary transition-colors">
                  {deptListOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              </div>
              {deptListOpen && (
                <div className="max-h-48 overflow-y-auto divide-y divide-border/20">
                  {filteredMainDepts.map(d => {
                    const subCount = subAccounts.filter(s => s.parentId === d.id).length;
                    return (
                      <label key={d.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-all ${selectedDepts.has(d.id) ? 'bg-primary/5' : 'hover:bg-muted/30'}`}>
                        <input
                          type="checkbox"
                          checked={selectedDepts.has(d.id)}
                          onChange={() => toggleDept(d.id)}
                          className="w-3.5 h-3.5 accent-primary rounded shrink-0"
                        />
                        <span className="flex-1 text-xs font-medium text-foreground">{d.name}</span>
                        {d.type && <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full shrink-0 ${d.type === 'Strategic' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{d.type}</span>}
                        {subCount > 0 && <span className="text-[8px] text-muted-foreground/60 shrink-0">{subCount} sub</span>}
                      </label>
                    );
                  })}
                  {filteredMainDepts.length === 0 && (
                    <p className="px-3 py-4 text-xs text-muted-foreground text-center italic">No departments match.</p>
                  )}
                </div>
              )}
              {/* Selected chips (shown when list closed) */}
              {!deptListOpen && selectedDepts.size > 0 && selectedDepts.size < mainDepts.length && (
                <div className="px-3 py-2 flex flex-wrap gap-1.5">
                  {mainDepts.filter(d => selectedDepts.has(d.id)).slice(0, 8).map(d => (
                    <span key={d.id} className="flex items-center gap-1 text-[9px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      {d.name}
                      <button onClick={() => toggleDept(d.id)} className="hover:text-destructive transition-colors"><X size={8} /></button>
                    </span>
                  ))}
                  {selectedDepts.size > 8 && <span className="text-[9px] text-muted-foreground/60 font-medium self-center">+{selectedDepts.size - 8} more</span>}
                </div>
              )}
              {!deptListOpen && selectedDepts.size === mainDepts.length && (
                <p className="px-3 py-2 text-[10px] text-muted-foreground font-medium">All {mainDepts.length} departments selected</p>
              )}
              {!deptListOpen && selectedDepts.size === 0 && (
                <p className="px-3 py-2 text-[10px] text-amber-600 font-medium">No departments selected — nothing to export</p>
              )}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/20 bg-muted/10 shrink-0 flex items-center justify-between gap-3">
          <p className="text-[10px] text-muted-foreground font-medium">
            {selectedDepts.size === 0 ? 'Select departments above' : `${(() => {
            let depts = mainDepts.filter(d => selectedDepts.has(d.id) && (!excludeEmpty || hasRecords(d)));
            let n = depts.length;
            if (includeSubAccounts) depts.forEach(d => { n += subAccounts.filter(s => s.parentId === d.id).length; });
            return n;
          })()} rows · ${visibleCols.length} columns · ${format.toUpperCase()}`}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border/50 text-xs font-bold text-muted-foreground hover:bg-muted transition-all">Cancel</button>
            <button
              onClick={handleExport}
              disabled={exporting || selectedDepts.size === 0 || visibleCols.length === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold text-xs uppercase tracking-widest transition-all disabled:opacity-50 shadow-sm active:scale-95"
            >
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {exporting ? 'Exporting...' : `Export ${format === 'excel' ? 'Excel' : 'PDF'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


// ── Import HOD Modal ─────────────────────────────────────────────────────────
const ImportHODModal = ({ onClose, onDone }) => {
  const [step, setStep] = useState('pick'); // pick | preview | result
  const [preview, setPreview] = useState([]); // parsed rows
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [notify, setNotify] = useState(false);
  const [conflicts, setConflicts] = useState({});         // { deptName: [{id,name,staffId,status,role}] }
  const [conflictChoices, setConflictChoices] = useState({}); // { deptName: 'skip' | 'reject_pending' }
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [conflictError, setConflictError] = useState(null);
  const fileRef = React.useRef(null);

  const TEMPLATE_HEADERS = ['Department Name', 'Category', 'Staff ID', 'Surname', 'First Name', 'Other Name', 'Designation', 'Official Email', 'Contact Phone', 'Email'];

  const EXPECTED_COLS = {
    deptName:    ['department name', 'department', 'dept', 'unit name'],
    type:        ['category', 'type'],
    staffId:     ['staff id', 'staffid', 'id'],
    surname:     ['surname', 'last name', 'lastname'],
    firstName:   ['first name', 'firstname'],
    otherName:   ['other name', 'othername', 'middle name'],
    headTitle:   ['designation', 'title', 'position'],
    headEmail:   ['official email'],
    phone:       ['contact phone', 'phone', 'mobile'],
    normalEmail: ['email'],
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
    ws['!cols'] = TEMPLATE_HEADERS.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws, 'HOD Template');
    XLSX.writeFile(wb, 'HOD_Import_Template.xlsx');
  };

  const parseFile = async (file) => {
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (raw.length < 2) { toast.error('File appears empty.'); return; }

      // Map header row to field keys
      const headerRow = raw[0].map(h => (h || '').toString().toLowerCase().trim());
      const colMap = {};
      for (const [field, aliases] of Object.entries(EXPECTED_COLS)) {
        const idx = headerRow.findIndex(h => aliases.some(a => h.includes(a)));
        if (idx >= 0) colMap[field] = idx;
      }
      if (colMap.deptName === undefined) { toast.error('Could not find a "Department Name" column in the file.'); return; }

      // Reset conflict state for fresh parse
      setConflicts({});
      setConflictChoices({});
      setConflictError(null);

      const rows = raw.slice(1).map((row, ri) => {
        const get = (field) => (colMap[field] !== undefined ? String(row[colMap[field]] || '').trim() : '');
        const deptName = get('deptName');
        const staffId  = get('staffId');
        const surname  = get('surname');
        const firstName = get('firstName');
        const otherName = get('otherName');
        const headTitle = get('headTitle');
        const headEmail = get('headEmail');
        const phone    = get('phone');
        const type     = get('type');
        const normalEmail = get('normalEmail');
        const hasData  = staffId || surname || firstName || headEmail || phone || headTitle;
        const isProtected = /^super\s*admin$/i.test(deptName);
        let status = 'ready';
        if (!deptName)    status = 'skip-empty';
        else if (isProtected) status = 'skip-protected';
        else if (!hasData)    status = 'skip-nodata';
        return { _ri: ri, deptName, staffId, surname, firstName, otherName, headTitle, headEmail, phone, type, normalEmail, status };
      }).filter(r => r.deptName || r.status === 'skip-empty');

      setPreview(rows);
      setStep('preview');

      // Async conflict check for all ready rows
      const readyNames = rows.filter(r => r.status === 'ready').map(r => r.deptName);
      if (readyNames.length > 0) {
        setCheckingConflicts(true);
        try {
          const cr = await fetch('/api/admin/departments/import-conflicts', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ deptNames: readyNames }),
          });
          if (!cr.ok) throw new Error(`Server error ${cr.status}`);
          const cd = await cr.json();
          const detected = cd.conflicts || {};
          setConflicts(detected);
          // Default all conflicts to 'skip' (safe)
          const defaults = {};
          Object.keys(detected).forEach(k => { defaults[k] = 'skip'; });
          setConflictChoices(defaults);
        } catch (e) {
          setConflictError('Could not check for pending submission conflicts: ' + e.message);
        } finally {
          setCheckingConflicts(false);
        }
      }
    } catch (err) {
      toast.error('Failed to read file: ' + err.message);
    }
  };

  const handleFilePick = (e) => { const f = e.target.files?.[0]; if (f) parseFile(f); };
  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); parseFile(e.dataTransfer.files?.[0]); };

  const readyRows = preview.filter(r => r.status === 'ready');
  const skipRows  = preview.filter(r => r.status !== 'ready');

  const conflictNames = Object.keys(conflicts);
  const unresolvedConflicts = conflictNames.filter(n => !conflictChoices[n]);
  const willUpdateCount = readyRows.filter(r => !conflicts[r.deptName] || conflictChoices[r.deptName] === 'reject_pending').length;
  const willSkipConflictCount = conflictNames.filter(n => conflictChoices[n] === 'skip').length;
  const willRejectPendingCount = conflictNames.filter(n => conflictChoices[n] === 'reject_pending').length;

  const setAllConflicts = (choice) => {
    const next = {};
    conflictNames.forEach(k => { next[k] = choice; });
    setConflictChoices(next);
  };

  const handleImport = async () => {
    if (willUpdateCount === 0 && willSkipConflictCount === conflictNames.length && readyRows.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch('/api/admin/departments/import-hods', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: readyRows, notify, conflictResolutions: conflictChoices })
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || 'Import failed.'); return; }
      setResult(d.results);
      setStep('result');
      onDone();
    } catch (err) { toast.error('Network error: ' + err.message); }
    finally { setImporting(false); }
  };

  const statusBadge = (s) => {
    if (s === 'ready')           return <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">WILL UPDATE</span>;
    if (s === 'skip-empty')      return <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">SKIP — empty</span>;
    if (s === 'skip-protected')  return <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">SKIP — Super Admin</span>;
    if (s === 'skip-nodata')     return <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">SKIP — no data</span>;
    return null;
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-600">
              <Upload size={16} />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest">Import HOD Data</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">Upload an Excel file to bulk-update department head records</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl text-muted-foreground"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1">

          {/* Step 1: Pick file */}
          {step === 'pick' && (
            <div className="p-8 flex flex-col items-center gap-6">
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={`w-full max-w-lg border-2 border-dashed rounded-3xl p-12 flex flex-col items-center gap-4 cursor-pointer transition-all ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-border/50 hover:border-blue-400 hover:bg-blue-50/30'}`}
              >
                <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center">
                  <FileSpreadsheet size={28} className="text-blue-600" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-foreground">Drop your Excel file here</p>
                  <p className="text-[11px] text-muted-foreground mt-1">or click to browse — .xlsx or .xls</p>
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFilePick} />
              </div>

              <div className="w-full max-w-lg space-y-3 text-[11px] text-muted-foreground">
                <div className="flex items-center justify-between">
                  <p className="font-black text-[9px] uppercase tracking-widest text-foreground/50">Expected column headers (any order):</p>
                  <button
                    onClick={downloadTemplate}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] uppercase tracking-widest transition-all shadow-sm active:scale-95"
                  >
                    <FileSpreadsheet size={11} />
                    Download Template
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    ['Department Name', 'required — matches the department'],
                    ['Category', 'Strategic or Operational'],
                    ['Staff ID', 'head\'s staff ID'],
                    ['Surname', 'head\'s surname'],
                    ['First Name', 'head\'s first name'],
                    ['Other Name', 'optional'],
                    ['Designation', 'job title / position'],
                    ['Official Email', 'head\'s official/company email'],
                    ['Contact Phone', 'phone number'],
                    ['Email', 'personal email (for unactivated accounts)'],
                  ].map(([col, desc]) => (
                    <div key={col} className="flex items-start gap-1.5 p-2 rounded-xl bg-muted/30">
                      <span className="font-bold text-foreground">{col}</span>
                      <span className="text-muted-foreground/70">— {desc}</span>
                    </div>
                  ))}
                </div>
                <label className="flex items-center gap-2.5 p-3 rounded-xl border border-border bg-muted/20 cursor-pointer hover:bg-muted/40 transition-all">
                  <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} className="w-4 h-4 rounded accent-blue-600" />
                  <div>
                    <p className="font-bold text-foreground text-[11px]">Send notifications to all HODs after import</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Email (official + personal) and SMS will be sent to each updated record</p>
                  </div>
                </label>
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-700 font-medium">
                    <strong>Super Admin</strong> rows are automatically protected and will never be modified, even if present in the file. Rows with no head data (no name, staff ID, or email) are also skipped automatically.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Preview */}
          {step === 'preview' && (
            <div className="p-6 space-y-4">
              {/* Summary badges */}
              <div className="flex flex-wrap gap-2 items-center">
                {checkingConflicts ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl">
                    <Loader2 size={12} className="text-blue-500 animate-spin" />
                    <span className="text-[11px] font-bold text-blue-700">Checking for conflicts…</span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <CheckCircle2 size={13} className="text-emerald-600" />
                      <span className="text-[11px] font-bold text-emerald-700">{willUpdateCount} will update</span>
                    </div>
                    {conflictNames.length > 0 && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-xl">
                        <AlertTriangle size={13} className="text-orange-500" />
                        <span className="text-[11px] font-bold text-orange-700">{conflictNames.length} conflict{conflictNames.length !== 1 ? 's' : ''} — needs review</span>
                      </div>
                    )}
                    {skipRows.length > 0 && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-border rounded-xl">
                        <Info size={13} className="text-muted-foreground" />
                        <span className="text-[11px] font-bold text-muted-foreground">{skipRows.length} skipped</span>
                      </div>
                    )}
                  </>
                )}
                <button onClick={() => { setPreview([]); setConflicts({}); setConflictChoices({}); setStep('pick'); }} className="ml-auto text-[11px] font-bold text-muted-foreground hover:text-foreground px-3 py-2 rounded-xl hover:bg-muted transition-all">
                  ← Choose different file
                </button>
              </div>

              {/* Conflict error */}
              {conflictError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <X size={13} className="text-red-500 shrink-0 mt-0.5" />
                  <span className="text-[11px] text-red-700">{conflictError} — you can still import but conflicts won't be detected automatically.</span>
                </div>
              )}

              {/* Conflict resolution panel */}
              {!checkingConflicts && conflictNames.length > 0 && (
                <div className="rounded-2xl border-2 border-orange-200 bg-orange-50/50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-orange-100/60 border-b border-orange-200">
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={14} className="text-orange-600" />
                      <span className="text-[11px] font-black text-orange-800 uppercase tracking-widest">
                        {conflictNames.length} Conflict{conflictNames.length !== 1 ? 's' : ''} — Pending Onboarding Submissions Found
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-[10px] text-orange-600 font-bold mr-1">Resolve all:</span>
                      <button onClick={() => setAllConflicts('skip')} className="px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-white border border-orange-300 text-orange-700 hover:bg-orange-100 transition-all">Skip All</button>
                      <button onClick={() => setAllConflicts('reject_pending')} className="px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-orange-600 text-white hover:bg-orange-700 transition-all">Import + Reject All</button>
                    </div>
                  </div>
                  <div className="divide-y divide-orange-200/60">
                    {conflictNames.map(deptName => {
                      const subs = conflicts[deptName] || [];
                      const choice = conflictChoices[deptName] || 'skip';
                      return (
                        <div key={deptName} className="px-4 py-3 flex flex-wrap items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-black text-orange-900">{deptName}</p>
                            <div className="mt-1 space-y-1">
                              {subs.map(s => (
                                <div key={s.id} className="flex items-center gap-2 text-[10px] text-orange-700">
                                  <span className={`px-1.5 py-0.5 rounded-full font-black text-[8px] ${s.status === 'DEPT_PENDING' ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>{s.status}</span>
                                  <span className="font-bold">{s.name || '(no name)'}</span>
                                  {s.staffId && <span className="font-mono text-orange-500">#{s.staffId}</span>}
                                  {s.role && <span className="text-orange-400">· {s.role}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              onClick={() => setConflictChoices(c => ({ ...c, [deptName]: 'skip' }))}
                              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${choice === 'skip' ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
                            >
                              Skip
                            </button>
                            <button
                              onClick={() => setConflictChoices(c => ({ ...c, [deptName]: 'reject_pending' }))}
                              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${choice === 'reject_pending' ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-orange-600 border-orange-200 hover:border-orange-400'}`}
                            >
                              Import + Reject
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-4 py-2 bg-orange-100/40 border-t border-orange-200 flex flex-wrap gap-4 text-[10px] text-orange-700">
                    {willRejectPendingCount > 0 && <span>✓ <strong>{willRejectPendingCount}</strong> dept{willRejectPendingCount !== 1 ? 's' : ''} will import + pending submissions will be rejected</span>}
                    {willSkipConflictCount > 0 && <span>⊘ <strong>{willSkipConflictCount}</strong> dept{willSkipConflictCount !== 1 ? 's' : ''} will be skipped (pending submission kept)</span>}
                  </div>
                </div>
              )}


              <div className="rounded-2xl border border-border/50 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/40 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Department</th>
                        <th className="py-2.5 px-3">Staff ID</th>
                        <th className="py-2.5 px-3">Name</th>
                        <th className="py-2.5 px-3">Designation</th>
                        <th className="py-2.5 px-3">Official Email</th>
                        <th className="py-2.5 px-3">Personal Email</th>
                        <th className="py-2.5 px-3">Phone</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/10">
                      {preview.map((row, i) => {
                        const isConflict = row.status === 'ready' && !!conflicts[row.deptName];
                        const choice = isConflict ? (conflictChoices[row.deptName] || 'skip') : null;
                        return (
                        <tr key={i} className={`${row.status === 'ready' && !isConflict ? '' : isConflict ? 'bg-orange-50/40' : 'opacity-40'}`}>
                          <td className="py-2 px-3">
                            {isConflict ? (
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${choice === 'reject_pending' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                                {choice === 'reject_pending' ? 'IMPORT + REJECT' : 'SKIP — conflict'}
                              </span>
                            ) : statusBadge(row.status)}
                          </td>
                          <td className="py-2 px-3 text-xs font-bold text-foreground">{row.deptName || '—'}</td>
                          <td className="py-2 px-3 text-xs font-mono text-foreground">{row.staffId || '—'}</td>
                          <td className="py-2 px-3 text-xs text-foreground">{[row.surname, row.firstName, row.otherName].filter(Boolean).join(' ') || '—'}</td>
                          <td className="py-2 px-3 text-[10px] text-muted-foreground max-w-[150px] truncate">{row.headTitle || '—'}</td>
                          <td className="py-2 px-3 text-[10px] text-blue-600 max-w-[160px] truncate">{row.headEmail || '—'}</td>
                          <td className="py-2 px-3 text-[10px] text-purple-600 max-w-[160px] truncate">{row.normalEmail || '—'}</td>
                          <td className="py-2 px-3 text-[10px] font-mono text-muted-foreground">{row.phone || '—'}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Result */}
          {step === 'result' && result && (
            <div className="p-6 space-y-4">
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                  <span className="text-sm font-black text-emerald-700">{result.updated.length} departments updated</span>
                </div>
                {result.notified > 0 && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
                    <CheckCircle2 size={14} className="text-blue-600" />
                    <span className="text-sm font-black text-blue-700">{result.notified} notifications sent</span>
                  </div>
                )}
                {result.conflictRejected > 0 && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-orange-50 border border-orange-200 rounded-xl">
                    <AlertTriangle size={14} className="text-orange-600" />
                    <span className="text-sm font-black text-orange-700">{result.conflictRejected} pending submission{result.conflictRejected !== 1 ? 's' : ''} auto-rejected</span>
                  </div>
                )}
                {result.notFound.length > 0 && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                    <AlertTriangle size={14} className="text-amber-600" />
                    <span className="text-sm font-black text-amber-700">{result.notFound.length} not found</span>
                  </div>
                )}
                {result.errors.length > 0 && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl">
                    <X size={14} className="text-red-600" />
                    <span className="text-sm font-black text-red-700">{result.errors.length} errors</span>
                  </div>
                )}
              </div>

              {result.updated.length > 0 && (
                <div>
                  <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-2">Successfully Updated</p>
                  <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                    {result.updated.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-xl">
                        <CheckCircle2 size={11} className="text-emerald-600 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-emerald-800 truncate">{r.name}</p>
                          {r.headName && <p className="text-[10px] text-emerald-600 truncate">{r.headName}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.notFound.length > 0 && (
                <div>
                  <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-2">Not Found in System</p>
                  <div className="space-y-1">
                    {result.notFound.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-xl text-[11px] text-amber-700">
                        <AlertTriangle size={11} className="shrink-0" />
                        <strong>{r.name}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.errors.length > 0 && (
                <div>
                  <p className="text-[9px] font-black text-red-600 uppercase tracking-widest mb-2">Errors</p>
                  <div className="space-y-1">
                    {result.errors.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-xl text-[11px] text-red-700">
                        <X size={11} className="shrink-0 mt-0.5" />
                        <span><strong>{r.name}</strong>: {r.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/20 bg-muted/10 shrink-0 flex items-center justify-between gap-3">
          {step === 'pick' && (
            <>
              <p className="text-[10px] text-muted-foreground">Supported: .xlsx, .xls — first sheet is used</p>
              <button onClick={onClose} className="px-5 py-2 rounded-xl border border-border text-xs font-bold text-muted-foreground hover:bg-muted transition-all">Cancel</button>
            </>
          )}
          {step === 'preview' && (
            <>
              <p className="text-[10px] text-muted-foreground">
                {checkingConflicts ? 'Checking for conflicts…' :
                  conflictNames.length > 0
                    ? `${willUpdateCount} will update · ${willRejectPendingCount} import+reject · ${willSkipConflictCount} skip`
                    : 'Review the rows above, then confirm to apply all updates'}
              </p>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border text-xs font-bold text-muted-foreground hover:bg-muted transition-all">Cancel</button>
                <button
                  onClick={handleImport}
                  disabled={importing || checkingConflicts || (willUpdateCount === 0 && willRejectPendingCount === 0)}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-widest transition-all disabled:opacity-50 shadow-sm active:scale-95"
                >
                  {importing ? <Loader2 size={13} className="animate-spin" /> : checkingConflicts ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {importing ? 'Importing…' : checkingConflicts ? 'Checking…' : `Import ${willUpdateCount + willRejectPendingCount} Record${willUpdateCount + willRejectPendingCount !== 1 ? 's' : ''}`}
                </button>
              </div>
            </>
          )}
          {step === 'result' && (
            <button onClick={onClose} className="ml-auto px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-all">Done</button>
          )}
        </div>
      </div>
    </div>
  );
};


// ── Override Privileges Panel ─────────────────────────────────────────────────
const OverridePrivsPanel = ({ departments }) => {
  const [privileged, setPrivileged] = React.useState(null); // null = loading
  const [selected, setSelected]     = React.useState(new Set());
  const [saving, setSaving]         = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await adminAPI.getOverrideDepts();
      setPrivileged(res.data || []);
    } catch { setPrivileged([]); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const privilegedIds = new Set((privileged || []).map(d => d.id));
  const eligible = (departments || []).filter(d => !d.isSubAccount && !d.isDeleted && !d.isDisabled);

  const toggle = (id) => setSelected(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const handleGrant = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await adminAPI.grantOverride([...selected]);
      toast.success(`Override privilege granted to ${selected.size} department(s).`);
      setSelected(new Set());
      load();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to grant privilege.');
    } finally { setSaving(false); }
  };

  const handleRevoke = async (deptId, deptName) => {
    if (!window.confirm(`Remove override privilege from "${deptName}"?`)) return;
    setSaving(true);
    try {
      await adminAPI.revokeOverride(deptId);
      toast.success(`Privilege removed from ${deptName}.`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to revoke privilege.');
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      <div className="p-4 bg-amber-500/8 border border-amber-400/25 rounded-2xl">
        <p className="text-[11px] font-black text-amber-700 uppercase tracking-widest mb-1">Override Privileges</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Departments granted override privilege can restore a <strong>rejected</strong> requisition back to pending status — the same power Super Admin has.
          Super Admin can grant or revoke this at any time.
        </p>
      </div>

      {/* Currently privileged */}
      <div className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Currently Privileged Departments</p>
        {privileged === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : privileged.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No departments have override privilege yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {privileged.map(d => (
              <div key={d.id} className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-amber-300/40 bg-amber-50/60">
                <span className="text-sm font-semibold">{d.name}</span>
                <button
                  onClick={() => handleRevoke(d.id, d.name)}
                  disabled={saving}
                  className="text-[11px] font-bold text-destructive hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Grant to more */}
      <div className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Grant to Additional Departments</p>
        <p className="text-[11px] text-muted-foreground mb-2">Select one or more departments below, then click <strong>Grant Privilege</strong>.</p>
        <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
          {eligible.filter(d => !privilegedIds.has(d.id)).map(d => (
            <label key={d.id} className="flex items-center gap-3 px-4 py-2 rounded-xl border border-border/50 hover:bg-muted/30 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={selected.has(d.id)}
                onChange={() => toggle(d.id)}
                className="accent-primary w-4 h-4"
              />
              <span className="text-sm">{d.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{d.type}</span>
            </label>
          ))}
          {eligible.filter(d => !privilegedIds.has(d.id)).length === 0 && (
            <p className="text-xs text-muted-foreground italic px-2">All departments already have this privilege.</p>
          )}
        </div>
        <button
          onClick={handleGrant}
          disabled={selected.size === 0 || saving}
          className="mt-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-all"
        >
          {saving ? 'Saving…' : `Grant Privilege (${selected.size} selected)`}
        </button>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const DepartmentManager = ({ onViewChange }) => {
  const { user } = useAuth();
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [pendingDept, setPendingDept] = useState(null);
  const [editingDept, setEditingDept] = useState(null);
  const [sealDept, setSealDept] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const importFileRef = useRef(null);
  const [newDeptData, setNewDeptData] = useState({ name: '', type: 'Operational', accessCode: '', headStaffId: '', headSurname: '', headFirstName: '', headOtherName: '', headTitle: '', headEmail: '', phone: '' });

  // Flash-free: default null (unknown/hidden) until the real setting resolves, so the
  // Head Official section never flashes visible-then-hidden when it's actually disabled.
  const [deptCreationHeadDetailsEnabled, setDeptCreationHeadDetailsEnabled] = useState(null);

  const [showAccessCode, setShowAccessCode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadingSigFor, setUploadingSigFor] = useState(null);
  const [sigTimestamps, setSigTimestamps] = useState({});

  const sigFileRef = useRef(null);

  const handleAdminSigUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !uploadingSigFor) return;
    const deptId = uploadingSigFor;
    setUploadingSigFor(`uploading_${deptId}`);
    try {
      await reqAPI.adminUploadDeptSignature(deptId, file);
      setSigTimestamps(prev => ({ ...prev, [deptId]: Date.now() }));
      toast.success('Signature updated and department notified.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Upload failed.');
    } finally { setUploadingSigFor(null); }
  };

  const loadDepts = async () => {
    const data = await getDepartments();
    setDepartments(data);
    setLoading(false);
  };

  useEffect(() => { loadDepts(); }, []);

  useEffect(() => {
    const handler = () => loadDepts();
    window.addEventListener('globalHardRefresh', handler);
    return () => window.removeEventListener('globalHardRefresh', handler);
  }, []);

  useEffect(() => {
    // Falls back to the last known good cached value on a network failure, not blindly
    // to "enabled" — so a disabled feature doesn't get exposed by a network blip.
    loadFeatureFlag('dept_creation_head_details_enabled').then(setDeptCreationHeadDetailsEnabled);
  }, []);

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (!newDeptData.name || !newDeptData.accessCode) {
      toast.error('Department name and password are required.');
      return;
    }
    // Defense in depth — the live check already blocks the button, but guard here too
    // in case the loaded department list is momentarily stale.
    const trimmedName = newDeptData.name.trim().toLowerCase();
    if (departments.some(d => (d.name || '').trim().toLowerCase() === trimmedName)) {
      toast.error(`A department named "${newDeptData.name.trim()}" already exists. Please choose a different name.`);
      return;
    }
    const headDetailsOn = deptCreationHeadDetailsEnabled === true;
    const headName = [newDeptData.headSurname, newDeptData.headFirstName, newDeptData.headOtherName].map(s => s.trim()).filter(Boolean).join(' ');
    const payload = headDetailsOn
      ? { ...newDeptData, headName, staffId: newDeptData.headStaffId.trim().toUpperCase() }
      : { name: newDeptData.name, type: newDeptData.type, accessCode: newDeptData.accessCode };
    setIsProcessing(true);
    try {
      await new Promise(r => setTimeout(r, 400));
      await addDepartment(payload);
      await loadDepts();
      setIsAddModalOpen(false);
      const deptName = newDeptData.name;
      setNewDeptData({ name: '', type: 'Operational', accessCode: '', headStaffId: '', headSurname: '', headFirstName: '', headOtherName: '', headTitle: '', headEmail: '', phone: '' });
      toast.success(`${deptName} Department added`);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to create department.');
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDept) return;
    setIsProcessing(true);
    await new Promise(r => setTimeout(r, 400));
    try {
      await deleteDepartment(pendingDept.id);
      await loadDepts();
      setIsDeleteModalOpen(false);
      toast.success(`${pendingDept.name} has been permanently deleted`);
      setPendingDept(null);
    } catch (err) {
      await loadDepts();
      toast.error(err?.response?.data?.error || 'Failed to delete department. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const [isSecurityResetModalOpen, setIsSecurityResetModalOpen] = useState(false);
  const [pendingSecurityResetDept, setPendingSecurityResetDept] = useState(null);
  const [securityResetting, setSecurityResetting] = useState(false);

  const confirmSecurityReset = async () => {
    if (!pendingSecurityResetDept) return;
    setSecurityResetting(true);
    try {
      await deptAPI.securityReset(pendingSecurityResetDept.id);
      toast.success(`${pendingSecurityResetDept.name}: password reset, access code reactivated, logged out everywhere — notified by SMS and email.`);
      setIsSecurityResetModalOpen(false);
      setPendingSecurityResetDept(null);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Security reset failed.');
    } finally {
      setSecurityResetting(false);
    }
  };

  const [togglingDeptId, setTogglingDeptId] = useState(null);
  const handleToggleDisable = async (dept) => {
    setTogglingDeptId(dept.id);
    try {
      const res = await deptAPI.toggleDisable(dept.id);
      await loadDepts();
      toast[res.isDisabled ? 'error' : 'success'](
        `${dept.name} ${res.isDisabled ? 'suspended' : 'reactivated'}.${res.successionNote ? ' ' + res.successionNote : ''}`
      );
    } catch (err) {
      toast.error(err?.response?.data?.error || `Failed to ${dept.isDisabled ? 'reactivate' : 'suspend'} ${dept.name}.`);
    } finally { setTogglingDeptId(null); }
  };

  const [resendingDeptId, setResendingDeptId] = useState(null);
  const handleResendWelcome = async (dept) => {
    setResendingDeptId(dept.id);
    try {
      const res = await deptAPI.resendWelcome(dept.id);
      toast.success(`Welcome message resent to ${dept.headEmail}${res.hasSms ? ' + SMS' : ''}`);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to resend welcome message.');
    } finally { setResendingDeptId(null); }
  };

  // ── Onboarding / tab state ────────────────────────────────────────────────
  const [activeTab, setActiveTab]               = useState('departments');

  // ── Help Desk state ───────────────────────────────────────────────────────
  const [hdMessages, setHdMessages]             = useState([]);
  const [hdLoading, setHdLoading]               = useState(false);
  const [hdUnread, setHdUnread]                 = useState(0);
  const [hdExpanded, setHdExpanded]             = useState(null);
  const [hdReplyText, setHdReplyText]           = useState('');
  const [hdReplying, setHdReplying]             = useState(false);

  const loadHelpDesk = useCallback(async () => {
    setHdLoading(true);
    try {
      const res = await fetch('/api/admin/helpdesk', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}` }
      });
      const data = await res.json();
      const msgs = data.messages || [];
      setHdMessages(msgs);
      setHdUnread(msgs.filter(m => !m.adminRead).length);
    } catch {}
    finally { setHdLoading(false); }
  }, []);

  const loadHdUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/helpdesk/unread-count', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}` }
      });
      const data = await res.json();
      setHdUnread(data.count ?? 0);
    } catch {}
  }, []);

  useEffect(() => {
    if (activeTab !== 'helpdesk') { loadHdUnreadCount(); return; }
    loadHelpDesk();
    const iv = setInterval(loadHelpDesk, 30_000);
    return () => clearInterval(iv);
  }, [activeTab, loadHelpDesk, loadHdUnreadCount]);

  useEffect(() => {
    if (activeTab === 'helpdesk') return;
    const iv = setInterval(loadHdUnreadCount, 30_000);
    loadHdUnreadCount();
    return () => clearInterval(iv);
  }, [activeTab, loadHdUnreadCount]);

  const hdMarkRead = async (id) => {
    try {
      await fetch(`/api/admin/helpdesk/${id}/read`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}` }
      });
      setHdMessages(ms => ms.map(m => m.id === id ? { ...m, adminRead: true } : m));
      setHdUnread(n => Math.max(0, n - 1));
    } catch {}
  };

  const hdRespond = async (id) => {
    if (!hdReplyText.trim()) return;
    setHdReplying(true);
    try {
      const res = await fetch(`/api/admin/helpdesk/${id}/respond`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('rms_token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ response: hdReplyText }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || 'Reply failed.'); return; }
      toast.success('Reply sent.');
      setHdReplyText('');
      setHdExpanded(null);
      loadHelpDesk();
    } catch { toast.error('Network error.'); }
    finally { setHdReplying(false); }
  };
  const [onboardingSubs, setOnboardingSubs]     = useState([]);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingFilter, setOnboardingFilter] = useState('PENDING');
  const [onboardingSearch, setOnboardingSearch] = useState('');
  const [selectedIds, setSelectedIds]           = useState([]);
  const [staffIdLookup, setStaffIdLookup]       = useState('');
  const [staffIdResult, setStaffIdResult]       = useState(null); // null | { taken, staffId, deptRecord, submission }
  const [staffIdLooking, setStaffIdLooking]     = useState(false);
  const [clearingEnrollment, setClearingEnrollment] = useState(false);

  const _obQ = onboardingSearch.trim().toLowerCase();
  const filteredOnboardingSubs = _obQ
    ? onboardingSubs.filter(s => {
        const name = `${s.firstName || ''} ${s.surname || ''} ${s.middleName || ''}`.toLowerCase();
        return (
          name.includes(_obQ) ||
          (s.staffId || '').toLowerCase().includes(_obQ) ||
          (s.deptName || '').toLowerCase().includes(_obQ) ||
          (s.customDeptName || '').toLowerCase().includes(_obQ) ||
          (s.role || '').toLowerCase().includes(_obQ) ||
          (s.phone || '').includes(_obQ) ||
          (s.personalEmail || '').toLowerCase().includes(_obQ) ||
          (s.officialEmail || '').toLowerCase().includes(_obQ)
        );
      })
    : onboardingSubs;
  const [rejectModal, setRejectModal]           = useState(null); // { id, name } or null
  const [rejectNote, setRejectNote]             = useState('');
  const [actioningId, setActioningId]           = useState(null);
  const [batchActioning, setBatchActioning]     = useState(false);
  const [pendingCount, setPendingCount]         = useState(0);
  const [deletingId, setDeletingId]             = useState(null);
  const [resendingId, setResendingId]           = useState(null);
  const [deleteSubConfirm, setDeleteSubConfirm] = useState(null); // submission id to delete
  const [deleteAllModal, setDeleteAllModal]     = useState(false);
  const [obExportOpen, setObExportOpen]         = useState(false);
  const [editModal, setEditModal]               = useState(null); // submission object or null
  const [editForm, setEditForm]                 = useState({});
  const [editSaving, setEditSaving]             = useState(false);
  const [replaceHeadConfirm, setReplaceHeadConfirm] = useState(null); // { id, existingHead, msg }

  const loadOnboarding = useCallback(async (filter, silent = false) => {
    if (!silent) setOnboardingLoading(true);
    try {
      const res = await fetch(`/api/admin/onboarding?status=${filter || onboardingFilter}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}` }
      });
      const data = await res.json();
      setOnboardingSubs(Array.isArray(data) ? data : []);
    } catch { if (!silent) setOnboardingSubs([]); }
    finally { if (!silent) setOnboardingLoading(false); }
  }, [onboardingFilter]);

  const loadPendingCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/onboarding?status=PENDING`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}` }
      });
      const data = await res.json();
      const deptPendingRes = await fetch(`/api/admin/onboarding?status=DEPT_PENDING`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}` }
      });
      const deptData = await deptPendingRes.json();
      setPendingCount((Array.isArray(data) ? data.length : 0) + (Array.isArray(deptData) ? deptData.length : 0));
    } catch {}
  }, []);

  useEffect(() => { loadPendingCount(); }, [loadPendingCount]);

  useEffect(() => {
    const handler = () => loadPendingCount();
    window.addEventListener('globalHardRefresh', handler);
    return () => window.removeEventListener('globalHardRefresh', handler);
  }, [loadPendingCount]);

  // Load submissions on tab switch / filter change, then poll every 20s for live updates
  useEffect(() => {
    if (activeTab !== 'onboarding') return;
    loadOnboarding(onboardingFilter);
    const interval = setInterval(() => {
      loadOnboarding(onboardingFilter, true); // silent=true: no spinner flicker on background polls
      loadPendingCount();
    }, 20000);
    return () => clearInterval(interval);
  }, [activeTab, onboardingFilter, loadOnboarding, loadPendingCount]);

  // Also poll the pending badge (tab label count) every 30s regardless of active tab
  useEffect(() => {
    const interval = setInterval(loadPendingCount, 30000);
    return () => clearInterval(interval);
  }, [loadPendingCount]);

  const handleApprove = async (id, force = false) => {
    setActioningId(id);
    try {
      const res = await fetch(`/api/admin/onboarding/${id}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}`, 'Content-Type': 'application/json' },
        body: force ? JSON.stringify({ confirm: true }) : undefined,
      });
      const d = await res.json();
      if (res.status === 409 && d.requiresConfirm) {
        // Dept already has a head — ask admin to confirm replacement
        setReplaceHeadConfirm({ id, existingHead: d.existingHead, msg: d.error });
        return;
      }
      if (!res.ok) { toast.error(d.error || 'Approval failed.'); return; }
      toast.success('Submission approved — credentials sent.');
      loadOnboarding(onboardingFilter); loadPendingCount(); loadDepts();
    } catch { toast.error('Network error.'); }
    finally { setActioningId(null); }
  };

  const handleReject = async () => {
    if (!rejectModal) return;
    setActioningId(rejectModal.id);
    try {
      const res = await fetch(`/api/admin/onboarding/${rejectModal.id}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: rejectNote.trim() || null })
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || 'Rejection failed.'); return; }
      toast.success('Submission rejected — submitter notified.');
      setRejectModal(null); setRejectNote('');
      loadOnboarding(onboardingFilter); loadPendingCount();
    } catch { toast.error('Network error.'); }
    finally { setActioningId(null); }
  };

  const handleApproveDept = async (id) => {
    setActioningId(id);
    try {
      const res = await fetch(`/api/admin/onboarding/${id}/approve-dept`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}`, 'Content-Type': 'application/json' }
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || 'Dept approval failed.'); return; }
      toast.success('Department approved — submission moved to Pending.');
      loadOnboarding(onboardingFilter); loadDepts(); loadPendingCount();
    } catch { toast.error('Network error.'); }
    finally { setActioningId(null); }
  };

  const handleBatchApprove = async () => {
    if (!selectedIds.length) return;
    setBatchActioning(true);
    try {
      const res = await fetch('/api/admin/onboarding/batch-approve', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds })
      });
      const d = await res.json();
      toast.success(`${d.approved} approved${d.failed ? `, ${d.failed} failed` : ''}.`);
      setSelectedIds([]); loadOnboarding(onboardingFilter); loadPendingCount(); loadDepts();
    } catch { toast.error('Batch approve failed.'); }
    finally { setBatchActioning(false); }
  };

  const handleBatchReject = async () => {
    if (!selectedIds.length) return;
    setBatchActioning(true);
    try {
      const res = await fetch('/api/admin/onboarding/batch-reject', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds, note: null })
      });
      const d = await res.json();
      toast.success(`${d.count} rejected — submitters notified.`);
      setSelectedIds([]); loadOnboarding(onboardingFilter); loadPendingCount();
    } catch { toast.error('Batch reject failed.'); }
    finally { setBatchActioning(false); }
  };

  const handleDeleteSub = async (id) => {
    setDeleteSubConfirm(id);
  };

  const handleStaffIdLookup = async () => {
    const q = staffIdLookup.trim().toUpperCase();
    if (!q) return;
    setStaffIdLooking(true);
    setStaffIdResult(null);
    try {
      const res = await fetch(`/api/admin/staff-id-lookup?staffId=${encodeURIComponent(q)}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}` },
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || 'Lookup failed.'); return; }
      setStaffIdResult(d);
    } catch { toast.error('Network error.'); }
    finally { setStaffIdLooking(false); }
  };

  const handleClearEnrollment = async () => {
    if (!staffIdResult?.staffId) return;
    setClearingEnrollment(true);
    try {
      const res = await fetch('/api/admin/clear-enrollment', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: staffIdResult.staffId }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || 'Clear failed.'); return; }
      toast.success(`Enrollment cleared from "${d.clearedFrom}" — person can now re-submit.`);
      setStaffIdResult(null); setStaffIdLookup('');
      loadDepts();
    } catch { toast.error('Network error.'); }
    finally { setClearingEnrollment(false); }
  };

  const handleResendCredentials = async (id) => {
    setResendingId(id);
    try {
      const res = await fetch(`/api/admin/onboarding/${id}/resend-credentials`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}` },
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || 'Resend failed.'); return; }
      toast.success(`Credentials resent to ${d.sentTo}${d.hasSms ? ' + SMS' : ''}.`);
    } catch { toast.error('Network error.'); }
    finally { setResendingId(null); }
  };

  const confirmDeleteSub = async () => {
    const id = deleteSubConfirm;
    setDeleteSubConfirm(null);
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/onboarding/${id}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}` }
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Delete failed.'); return; }
      toast.success('Submission deleted.');
      loadOnboarding(onboardingFilter); loadPendingCount();
    } catch { toast.error('Network error.'); }
    finally { setDeletingId(null); }
  };

  const handleDeleteAll = async () => {
    const ids = onboardingSubs.map(s => s.id);
    if (!ids.length) return;
    setBatchActioning(true);
    try {
      const res = await fetch('/api/admin/onboarding/batch-delete', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      const d = await res.json();
      toast.success(`${d.count} submission(s) deleted.`);
      setDeleteAllModal(false); setSelectedIds([]);
      loadOnboarding(onboardingFilter); loadPendingCount();
    } catch { toast.error('Batch delete failed.'); }
    finally { setBatchActioning(false); }
  };

  const handleBatchDelete = async () => {
    if (!selectedIds.length) return;
    setBatchActioning(true);
    try {
      const res = await fetch('/api/admin/onboarding/batch-delete', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds })
      });
      const d = await res.json();
      toast.success(`${d.count} deleted.`);
      setSelectedIds([]); loadOnboarding(onboardingFilter); loadPendingCount();
    } catch { toast.error('Batch delete failed.'); }
    finally { setBatchActioning(false); }
  };

  const openEdit = (sub) => {
    setEditForm({
      firstName: sub.firstName || '',
      surname: sub.surname || '',
      middleName: sub.middleName || '',
      staffId: sub.staffId || '',
      phone: sub.phone || '',
      personalEmail: sub.personalEmail || '',
      role: sub.role || 'MEMBER',
      status: sub.status || 'PENDING',
      deptId: sub.deptId || '',
    });
    setEditModal(sub);
  };

  const handleEditSave = async () => {
    if (!editModal) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/onboarding/${editModal.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rms_token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || 'Save failed.'); return; }
      toast.success('Submission updated.');
      setEditModal(null);
      loadOnboarding(onboardingFilter);
      loadDepts(); // sync Departments tab if HEAD role/status changed
    } catch { toast.error('Network error.'); }
    finally { setEditSaving(false); }
  };

  const onboardingToken = localStorage.getItem('rms_token');

  // This table manages departments themselves, not individual staff under them —
  // sub-accounts already have their own dedicated Sub-Accounts page.
  const mainDepartments = departments.filter(d => !d.isSubAccount);

  if (loading) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center space-y-6">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center text-primary">
            <Briefcase size={24} className="animate-pulse" />
          </div>
        </div>
        <p className="text-sm font-bold text-primary tracking-widest uppercase animate-pulse">Syncing Corporate Hierarchy</p>
      </div>
    );
  }

  return (
    <>
    <div className="max-w-6xl mx-auto space-y-10 pb-20">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight flex items-center space-x-3">
              <Briefcase className="text-primary" />
              <span>Department <span className="text-primary">Manager</span></span>
            </h1>
            <p className="text-muted-foreground text-sm mt-1 font-medium">
              Manage operational units and strategic control departments.
            </p>
          </div>
          {activeTab === 'departments' && (
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search departments..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="bg-white/80 border border-border/50 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 w-56 shadow-sm"
                />
              </div>
              <button
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-5 rounded-xl transition-all shadow-lg shadow-blue-500/20 text-sm"
              >
                <Upload size={16} />
                Import HODs
              </button>
              <button
                onClick={() => setExportOpen(true)}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-5 rounded-xl transition-all shadow-lg shadow-emerald-500/20 text-sm"
              >
                <FileDown size={16} />
                Export
              </button>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3 px-5 rounded-xl transition-all shadow-lg shadow-primary/20 flex items-center gap-2 text-sm"
              >
                <Plus size={17} />
                Add Department
              </button>
            </div>
          )}
        </div>

        {/* ── Tab bar ── */}
        <div className="flex items-center gap-2 border-b border-border/30 pb-1 flex-wrap">
          {[
            { key: 'departments', label: 'Departments' },
            { key: 'onboarding',  label: 'Onboarding', badge: pendingCount || null, badgeColor: 'bg-amber-500' },
            { key: 'helpdesk',    label: 'Help Desk',  badge: hdUnread || null,     badgeColor: 'bg-blue-600', live: true },
            { key: 'override_privs', label: 'Override Privileges' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-t-xl text-[11px] font-black uppercase tracking-widest transition-all border-b-2 ${
                activeTab === tab.key
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
              }`}
            >
              {tab.label}
              {tab.badge ? (
                <span className={`${tab.badgeColor} text-white text-[9px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none ${tab.live ? 'animate-pulse' : ''}`}>
                  {tab.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* ── Onboarding Review Panel ── */}
        {activeTab === 'onboarding' && (
          <div className="space-y-5">
            {/* Status filter tabs + quick search */}
            <div className="flex flex-wrap items-center gap-2">
              {[
                { value: 'PENDING',      label: 'Pending' },
                { value: 'DEPT_PENDING', label: 'Dept Pending' },
                { value: 'APPROVED',     label: 'Approved' },
                { value: 'REJECTED',     label: 'Rejected' },
                { value: 'ALL',          label: 'All' },
              ].map(f => (
                <button
                  key={f.value}
                  onClick={() => { setOnboardingFilter(f.value); setSelectedIds([]); setOnboardingSearch(''); }}
                  className={`px-4 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${
                    onboardingFilter === f.value
                      ? f.value === 'PENDING' ? 'bg-amber-500/10 border-amber-500/30 text-amber-700'
                        : f.value === 'DEPT_PENDING' ? 'bg-purple-500/10 border-purple-500/30 text-purple-700'
                        : f.value === 'APPROVED' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700'
                        : f.value === 'REJECTED' ? 'bg-red-500/10 border-red-500/30 text-red-700'
                        : 'bg-primary/10 border-primary/30 text-primary'
                      : 'bg-muted border-border text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <div className="relative ml-auto">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={onboardingSearch}
                  onChange={e => setOnboardingSearch(e.target.value)}
                  placeholder="Search name, ID, dept, role, email…"
                  className="bg-white/80 border border-border/50 rounded-xl py-1.5 pl-8 pr-3 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary/20 w-56 shadow-sm"
                />
                {onboardingSearch && (
                  <button onClick={() => setOnboardingSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

            {/* Batch actions */}
            <div className="flex flex-wrap items-center gap-2">
              {selectedIds.length > 0 && (
                <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-2xl flex-wrap">
                  <span className="text-xs font-bold text-primary">{selectedIds.length} selected</span>
                  <button onClick={handleBatchApprove} disabled={batchActioning}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-[11px] font-black hover:bg-emerald-700 transition-all disabled:opacity-50">
                    {batchActioning ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                    Approve
                  </button>
                  <button onClick={handleBatchReject} disabled={batchActioning}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 text-white text-[11px] font-black hover:bg-amber-700 transition-all disabled:opacity-50">
                    {batchActioning ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                    Reject
                  </button>
                  <button onClick={handleBatchDelete} disabled={batchActioning}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 text-white text-[11px] font-black hover:bg-red-700 transition-all disabled:opacity-50">
                    {batchActioning ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                    Delete
                  </button>
                  <button onClick={() => setSelectedIds([])} className="text-[11px] text-muted-foreground hover:text-foreground font-bold">
                    Clear
                  </button>
                </div>
              )}
              {onboardingSubs.length > 0 && (
                <div className="flex items-center gap-2 ml-auto">
                  <button onClick={() => setObExportOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-black hover:bg-blue-100 transition-all">
                    <FileDown size={11} />
                    Export
                  </button>
                  <button onClick={() => setDeleteAllModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[11px] font-black hover:bg-red-100 transition-all">
                    <Trash2 size={11} />
                    Delete All ({onboardingSubs.length})
                  </button>
                </div>
              )}
            </div>

            {/* Staff ID Lookup */}
            <div className="p-3 bg-muted/30 border border-border/40 rounded-2xl space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><Hash size={11} /> Staff ID Registry — lookup &amp; unblock</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={staffIdLookup}
                  onChange={e => { setStaffIdLookup(e.target.value.toUpperCase()); setStaffIdResult(null); }}
                  onKeyDown={e => { if (e.key === 'Enter' && staffIdLookup.trim()) handleStaffIdLookup(); }}
                  placeholder="Enter Staff ID…"
                  className="flex-1 bg-white/80 border border-border/50 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  onClick={handleStaffIdLookup}
                  disabled={!staffIdLookup.trim() || staffIdLooking}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-[11px] font-black hover:bg-primary/90 transition-all disabled:opacity-50"
                >
                  {staffIdLooking ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
                  Check
                </button>
              </div>
              {staffIdResult && (
                <div className={`rounded-xl p-3 text-xs space-y-1 ${staffIdResult.taken ? 'bg-red-50 border border-red-200' : 'bg-emerald-50 border border-emerald-200'}`}>
                  {!staffIdResult.taken ? (
                    <p className="font-bold text-emerald-700">✓ Staff ID <span className="font-mono">{staffIdResult.staffId}</span> is free — nobody holds it.</p>
                  ) : (
                    <>
                      <p className="font-bold text-red-700">⚠ Staff ID <span className="font-mono">{staffIdResult.staffId}</span> is taken:</p>
                      {staffIdResult.deptRecord && (
                        <p className="text-red-600">
                          Department record: <strong>{staffIdResult.deptRecord.name}</strong>
                          {staffIdResult.deptRecord.isSubAccount ? ' (sub-account)' : ' (main dept — as Head)'}
                          {staffIdResult.deptRecord.isDeleted ? ' [DELETED]' : ''}
                        </p>
                      )}
                      {staffIdResult.submission && (
                        <p className="text-red-600">
                          Pending submission: <strong>{staffIdResult.submission.firstName} {staffIdResult.submission.surname}</strong> — {staffIdResult.submission.role} / {staffIdResult.submission.deptName} ({staffIdResult.submission.status})
                        </p>
                      )}
                      {staffIdResult.deptRecord && (
                        <button
                          onClick={handleClearEnrollment}
                          disabled={clearingEnrollment}
                          className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 text-white text-[10px] font-black hover:bg-red-700 transition-all disabled:opacity-50"
                        >
                          {clearingEnrollment ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                          Clear enrollment — allow re-submission
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Link to share */}
            <div className="flex items-center gap-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
              <Info size={14} className="text-blue-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-blue-700">Onboarding Form Link</p>
                <p className="text-[10px] text-blue-500 font-mono truncate">{window.location.origin}/onboarding</p>
              </div>
              <button
                onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/onboarding`).catch(() => {}); toast.success('Link copied!'); }}
                className="text-[10px] font-black text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-all whitespace-nowrap"
              >
                Copy Link
              </button>
            </div>

            {/* Table */}
            {onboardingLoading ? (
              <div className="py-16 text-center">
                <Loader2 size={24} className="animate-spin text-primary mx-auto mb-3" />
                <p className="text-sm text-muted-foreground font-medium">Loading submissions…</p>
              </div>
            ) : onboardingSubs.length === 0 ? (
              <div className="py-16 text-center bg-white/70 rounded-3xl border border-border/50">
                <p className="text-sm text-muted-foreground italic">No submissions in this category.</p>
              </div>
            ) : filteredOnboardingSubs.length === 0 ? (
              <div className="py-16 text-center bg-white/70 rounded-3xl border border-border/50">
                <p className="text-sm text-muted-foreground italic">No submissions match your search.</p>
              </div>
            ) : (
              <div className="bg-white/70 rounded-3xl border border-border/50 overflow-hidden shadow-sm">
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/30 text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground border-b border-border/20">
                        <th className="py-3 px-3">
                          {(() => {
                            const visiblePending = filteredOnboardingSubs.filter(s => s.status === 'PENDING');
                            return (
                              <input type="checkbox"
                                checked={visiblePending.length > 0 && visiblePending.every(s => selectedIds.includes(s.id))}
                                onChange={e => {
                                  const ids = visiblePending.map(s => s.id);
                                  setSelectedIds(e.target.checked ? [...new Set([...selectedIds, ...ids])] : selectedIds.filter(i => !ids.includes(i)));
                                }}
                                className="rounded"
                              />
                            );
                          })()}
                        </th>
                        <th className="py-3 px-3">Name</th>
                        <th className="py-3 px-3">Staff ID</th>
                        <th className="py-3 px-3">Department</th>
                        <th className="py-3 px-3">Role</th>
                        <th className="py-3 px-3">Phone</th>
                        <th className="py-3 px-3">Personal Email</th>
                        <th className="py-3 px-3">Official Email</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3">Submitted</th>
                        <th className="py-3 px-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/10">
                      {filteredOnboardingSubs.map(sub => {
                        const isPending   = sub.status === 'PENDING';
                        const isDeptPend  = sub.status === 'DEPT_PENDING';
                        const isApproved  = sub.status === 'APPROVED';
                        const isRejected  = sub.status === 'REJECTED';
                        const fullName    = `${sub.firstName} ${sub.surname}${sub.middleName ? ' ' + sub.middleName : ''}`;
                        const submittedAt = new Date(sub.submittedAt).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
                        return (
                          <tr key={sub.id} className={`hover:bg-muted/20 transition-colors ${selectedIds.includes(sub.id) ? 'bg-primary/[0.03]' : ''}`}>
                            <td className="py-3 px-3">
                              {isPending && (
                                <input type="checkbox" checked={selectedIds.includes(sub.id)}
                                  onChange={e => setSelectedIds(prev => e.target.checked ? [...prev, sub.id] : prev.filter(i => i !== sub.id))}
                                  className="rounded"
                                />
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <p className="text-xs font-bold text-foreground">{fullName}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{sub.id.slice(0,8).toUpperCase()}</p>
                            </td>
                            <td className="py-3 px-3 text-xs font-bold font-mono text-foreground">{sub.staffId}</td>
                            <td className="py-3 px-3">
                              <p className="text-xs font-semibold text-foreground">{sub.deptName || sub.customDeptName || '—'}</p>
                              {sub.customDeptName && sub.status === 'DEPT_PENDING' && (
                                <p className="text-[10px] text-amber-600 font-bold">⏳ Dept pending</p>
                              )}
                              {sub.customDeptName && sub.status !== 'DEPT_PENDING' && (
                                <p className="text-[10px] text-teal-600 font-bold">✦ New dept created</p>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                sub.role === 'HEAD' ? 'bg-blue-100 text-blue-700'
                                : sub.role === 'ASSISTANT' ? 'bg-indigo-100 text-indigo-700'
                                : 'bg-gray-100 text-gray-600'
                              }`}>{sub.role}</span>
                            </td>
                            <td className="py-3 px-3 text-[11px] font-mono text-foreground">{sub.phone}</td>
                            <td className="py-3 px-3 text-[10px] text-foreground max-w-[160px] truncate">{sub.personalEmail}</td>
                            <td className="py-3 px-3 text-[10px] text-blue-600 font-mono max-w-[160px] truncate">{sub.officialEmail}</td>
                            <td className="py-3 px-3">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                isPending   ? 'bg-amber-100 text-amber-700'
                                : isDeptPend ? 'bg-purple-100 text-purple-700'
                                : isApproved ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-red-100 text-red-700'
                              }`}>
                                {sub.status.replace('_', ' ')}
                              </span>
                              {isRejected && sub.rejectionNote && (
                                <p className="text-[9px] text-muted-foreground mt-0.5 max-w-[100px] truncate" title={sub.rejectionNote}>{sub.rejectionNote}</p>
                              )}
                            </td>
                            <td className="py-3 px-3 text-[10px] text-muted-foreground whitespace-nowrap">{submittedAt}</td>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-1 justify-center">
                                {isDeptPend && (
                                  <button
                                    onClick={() => handleApproveDept(sub.id)}
                                    disabled={actioningId === sub.id}
                                    className="px-2.5 py-1.5 rounded-xl bg-purple-600 text-white text-[10px] font-black hover:bg-purple-700 transition-all disabled:opacity-50 whitespace-nowrap"
                                    title="Approve department request — creates the dept and moves submission to Pending"
                                  >
                                    {actioningId === sub.id ? <Loader2 size={10} className="animate-spin" /> : 'Approve Dept'}
                                  </button>
                                )}
                                {isPending && (
                                  <button
                                    onClick={() => handleApprove(sub.id)}
                                    disabled={actioningId === sub.id}
                                    className="p-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-all disabled:opacity-50"
                                    title="Approve — create account and send credentials"
                                  >
                                    {actioningId === sub.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                  </button>
                                )}
                                {(isPending || isDeptPend) && (
                                  <button
                                    onClick={() => { setRejectModal({ id: sub.id, name: fullName }); setRejectNote(''); }}
                                    disabled={actioningId === sub.id}
                                    className="p-1.5 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-all disabled:opacity-50"
                                    title="Reject submission"
                                  >
                                    <X size={12} />
                                  </button>
                                )}
                                {isApproved && (
                                  <button
                                    onClick={() => handleResendCredentials(sub.id)}
                                    disabled={resendingId === sub.id}
                                    className="p-1.5 rounded-xl bg-teal-500 text-white hover:bg-teal-600 transition-all disabled:opacity-50"
                                    title="Resend credentials (email + SMS)"
                                  >
                                    {resendingId === sub.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                  </button>
                                )}
                                <button
                                  onClick={() => openEdit(sub)}
                                  className="p-1.5 rounded-xl bg-blue-500 text-white hover:bg-blue-600 transition-all"
                                  title="Edit submission"
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  onClick={() => handleDeleteSub(sub.id)}
                                  disabled={deletingId === sub.id}
                                  className="p-1.5 rounded-xl bg-gray-200 text-gray-600 hover:bg-red-100 hover:text-red-600 transition-all disabled:opacity-50"
                                  title="Delete submission"
                                >
                                  {deletingId === sub.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Edit Submission Modal ── */}
        {editModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-border/30">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest">Edit Submission</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{editModal.id.slice(0,8).toUpperCase()}</p>
                </div>
                <button onClick={() => setEditModal(null)} className="p-2 hover:bg-muted rounded-xl"><X size={16} /></button>
              </div>
              <div className="p-6 space-y-4">
                {[
                  { key: 'surname',       label: 'Surname' },
                  { key: 'firstName',     label: 'First Name' },
                  { key: 'middleName',    label: 'Middle Name' },
                  { key: 'staffId',       label: 'Staff ID' },
                  { key: 'phone',         label: 'Phone' },
                  { key: 'personalEmail', label: 'Personal Email', type: 'email' },
                ].map(({ key, label, type }) => (
                  <div key={key}>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">{label}</label>
                    <input
                      type={type || 'text'}
                      value={editForm[key] || ''}
                      onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-xl border border-border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Department</label>
                  <select
                    value={editForm.deptId || ''}
                    onChange={e => setEditForm(f => ({ ...f, deptId: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl border border-border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">— Select Department —</option>
                    {[...departments]
                      .filter(d => !d.isSubAccount)
                      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                      .map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))
                    }
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Role</label>
                    <select value={editForm.role || 'MEMBER'} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-xl border border-border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20">
                      {['HEAD', 'ASSISTANT', 'MEMBER'].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Status</label>
                    <select value={editForm.status || 'PENDING'} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-xl border border-border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20">
                      {['PENDING', 'DEPT_PENDING', 'APPROVED', 'REJECTED'].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setEditModal(null)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted transition-all">Cancel</button>
                  <button onClick={handleEditSave} disabled={editSaving}
                    className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-black hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {editSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {editSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Delete Submission Confirmation ── */}
        {deleteSubConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                  <Trash2 size={18} className="text-red-600" />
                </div>
                <div>
                  <h3 className="text-base font-black text-foreground">Delete Submission?</h3>
                  <p className="text-sm text-muted-foreground mt-1">This submission record will be permanently removed. This cannot be undone.</p>
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setDeleteSubConfirm(null)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted transition-all">Cancel</button>
                <button onClick={confirmDeleteSub} className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-black hover:bg-red-700 transition-all">Yes, Delete</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Replace Head Confirmation ── */}
        {replaceHeadConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <ShieldAlert size={18} className="text-amber-600" />
                </div>
                <div>
                  <h3 className="text-base font-black text-foreground">Department Already Has a Head</h3>
                  <p className="text-sm text-muted-foreground mt-1">{replaceHeadConfirm.msg}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Are you sure you want to <span className="font-bold text-red-600">replace</span> the existing head and approve this new one?</p>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setReplaceHeadConfirm(null)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted transition-all">Cancel</button>
                <button
                  onClick={async () => { const id = replaceHeadConfirm.id; setReplaceHeadConfirm(null); await handleApprove(id, true); }}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-black hover:bg-red-700 transition-all"
                >Yes, Replace Head</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Delete All Confirmation ── */}
        {deleteAllModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                  <Trash2 size={18} className="text-red-600" />
                </div>
                <div>
                  <h3 className="text-base font-black text-foreground">Delete All Submissions</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    This will permanently delete all <strong>{onboardingSubs.length}</strong> submission(s) currently visible (filtered as <strong>{onboardingFilter}</strong>). This cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setDeleteAllModal(false)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted transition-all">Cancel</button>
                <button onClick={handleDeleteAll} disabled={batchActioning}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-black hover:bg-red-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {batchActioning ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  {batchActioning ? 'Deleting…' : 'Delete All'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Reject Modal ── */}
        {rejectModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-black text-foreground">Reject Submission</h3>
                  <p className="text-sm text-muted-foreground mt-1">{rejectModal.name}</p>
                </div>
                <button onClick={() => setRejectModal(null)} className="p-2 hover:bg-muted rounded-xl"><X size={16} /></button>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Rejection Reason (Optional)</label>
                <textarea
                  value={rejectNote}
                  onChange={e => setRejectNote(e.target.value)}
                  placeholder="e.g. Duplicate entry, incorrect department, etc."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-red-500/20 resize-none"
                />
                <p className="text-[10px] text-muted-foreground mt-1">The submitter will be notified by email.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setRejectModal(null)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted transition-all">Cancel</button>
                <button
                  onClick={handleReject}
                  disabled={actioningId === rejectModal.id}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-black hover:bg-red-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actioningId === rejectModal.id ? <Loader2 size={14} className="animate-spin" /> : null}
                  Confirm Reject
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Help Desk tab ── */}
        {activeTab === 'helpdesk' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-foreground">Help Desk Inbox</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Messages, questions and suggestions from department portals</p>
              </div>
              <button onClick={loadHelpDesk} className="p-2 hover:bg-muted rounded-xl text-muted-foreground hover:text-foreground transition-colors" title="Refresh">
                <RotateCcw size={15} />
              </button>
            </div>

            {hdLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={24} className="animate-spin text-blue-400" />
              </div>
            ) : hdMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
                  <Send size={24} className="text-blue-300" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-muted-foreground">No messages yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Department portals can send questions, suggestions and observations here.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {hdMessages.map(m => (
                  <div key={m.id} className={`rounded-2xl border transition-all ${!m.adminRead ? 'border-blue-200 bg-blue-50/40 shadow-sm shadow-blue-100' : 'border-border bg-background'}`}>
                    {/* Message header */}
                    <button
                      className="w-full text-left px-4 py-3 flex items-start gap-3"
                      onClick={() => {
                        setHdExpanded(hdExpanded === m.id ? null : m.id);
                        if (!m.adminRead) hdMarkRead(m.id);
                        setHdReplyText('');
                      }}
                    >
                      {/* Avatar */}
                      <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[11px] font-black text-blue-700">
                          {(m.deptName || '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-black text-foreground truncate">{m.deptName || 'Unknown Dept'}</span>
                          {m.senderName && <span className="text-[10px] text-muted-foreground">· {m.senderName}</span>}
                          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ml-auto ${
                            m.type === 'question'   ? 'bg-blue-100 text-blue-700' :
                            m.type === 'suggestion' ? 'bg-purple-100 text-purple-700' :
                                                      'bg-amber-100 text-amber-700'
                          }`}>{m.type}</span>
                          {!m.adminRead && (
                            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" title="Unread" />
                          )}
                        </div>
                        <p className="text-[11px] text-foreground leading-relaxed mt-1 line-clamp-2">{m.message}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-[9px] text-muted-foreground/60">{m.createdAt ? new Date(m.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                          {m.adminResponse && (
                            <span className="flex items-center gap-1 text-[9px] text-emerald-600 font-bold">
                              <CheckCircle2 size={9} /> Responded{m.responseRead ? ' · seen' : ' · unseen'}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Expanded */}
                    {hdExpanded === m.id && (
                      <div className="px-4 pb-4 space-y-3 border-t border-border/30 pt-3">
                        {/* Full message */}
                        <div className="bg-blue-50 rounded-xl p-3">
                          <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{m.message}</p>
                        </div>

                        {/* Existing response */}
                        {m.adminResponse && (
                          <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                            <div className="flex items-center gap-1.5 mb-2">
                              <CheckCircle2 size={11} className="text-emerald-600" />
                              <span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Your Response</span>
                              <span className="text-[9px] text-muted-foreground ml-auto">{m.respondedAt ? new Date(m.respondedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                            </div>
                            <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{m.adminResponse}</p>
                            <p className="text-[9px] text-muted-foreground mt-1.5">{m.responseRead ? '✓ Seen by department' : '○ Not yet seen'}</p>
                          </div>
                        )}

                        {/* Reply form */}
                        <div className="space-y-2">
                          <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            {m.adminResponse ? 'Update Response' : 'Send Response'}
                          </label>
                          <textarea
                            value={hdReplyText}
                            onChange={e => setHdReplyText(e.target.value)}
                            placeholder="Write your response to this department…"
                            rows={3}
                            className="w-full px-3 py-2.5 rounded-xl border border-border text-xs bg-background focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none leading-relaxed"
                          />
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => { setHdExpanded(null); setHdReplyText(''); }}
                              className="px-4 py-2 text-[11px] font-bold rounded-xl border border-border text-muted-foreground hover:bg-muted transition-all"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => hdRespond(m.id)}
                              disabled={hdReplying || !hdReplyText.trim()}
                              className="px-4 py-2 text-[11px] font-black rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center gap-1.5"
                            >
                              {hdReplying ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                              {hdReplying ? 'Sending…' : 'Send Reply'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Override Privileges tab ── */}
        {activeTab === 'override_privs' && (
          <OverridePrivsPanel departments={departments} />
        )}

        {/* ── Departments tab content (only shown when that tab is active) ── */}
        {activeTab === 'departments' && <>

        {/* Info box — seal vs signature */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 flex items-start gap-3 p-4 bg-indigo-500/5 border border-indigo-500/15 rounded-2xl">
            <Eye size={16} className="text-indigo-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Department Seal (Auto-generated)</p>
              <p className="text-[10px] text-muted-foreground font-medium mt-0.5 leading-relaxed">
                Each department gets a unique seal generated automatically with their name and today's date. Click the <strong>eye icon</strong> on any department card to view or download it. It is embedded as a watermark on official PDF documents.
              </p>
            </div>
          </div>
          <div className="flex-1 flex items-start gap-3 p-4 bg-emerald-500/5 border border-emerald-500/15 rounded-2xl">
            <BadgeCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Head Officer Signature</p>
              <p className="text-[10px] text-muted-foreground font-medium mt-0.5 leading-relaxed">
                The handwritten signature of the department head — uploaded by the department themselves via their <strong>Dept Profile</strong> page. It auto-embeds above the signature line on PDFs.
              </p>
            </div>
          </div>
        </div>

        {/* Unified Corporate Hierarchy Table */}
        <div className="glass bg-white/70 rounded-3xl border border-border/50 p-6 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between mb-5 px-1">
            <div>
              <h3 className="text-base font-bold text-foreground">Corporate Hierarchy & Credentials</h3>
              <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                Manage all units, their passwords, and official signatures in one centralized directory.
              </p>
            </div>
            <div className="flex items-center gap-4">
               <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">{mainDepartments.length} Units Synchronized</span>
            </div>
          </div>

          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse border-separate border-spacing-0">
              <thead>
                <tr className="bg-muted/30 text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                  <th className="py-4 px-4 rounded-tl-xl border-y border-l">Unit Name</th>
                  <th className="py-4 px-4 border-y">Category</th>
                  <th className="py-4 px-4 border-y">Login Code</th>
                  <th className="py-4 px-4 border-y">Signature</th>
                  <th className="py-4 px-4 border-y">Staff ID</th>
                  <th className="py-4 px-4 border-y">First Name</th>
                  <th className="py-4 px-4 border-y">Surname</th>
                  <th className="py-4 px-4 border-y">Other Name</th>
                  <th className="py-4 px-4 border-y">Official Email</th>
                  <th className="py-4 px-4 border-y">Contact Phone</th>
                  <th className="py-4 px-4 rounded-tr-xl border-y border-r text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {mainDepartments
                  .filter(d => {
                    const q = searchTerm.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      (d.name || '').toLowerCase().includes(q) ||
                      (d.accessCode || '').toLowerCase().includes(q) ||
                      (d.accessCodeLabel || '').toLowerCase().includes(q) ||
                      (d.staffId || '').toLowerCase().includes(q) ||
                      (d.headName || '').toLowerCase().includes(q) ||
                      (d.headEmail || '').toLowerCase().includes(q) ||
                      (d.phone || '').includes(q) ||
                      (d.type || '').toLowerCase().includes(q)
                    );
                  })
                  .map((dept) => {
                    const displayCode = dept.accessCodeLabel || dept.accessCode || null;
                    return (
                      <tr key={dept.id} className="hover:bg-primary/[0.02] transition-colors group">
                        <td className="py-4 px-4 text-xs font-bold text-foreground border-l border-border/10">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{dept.name}</span>
                            {isCriticalDeptName(dept.name) && (
                              <span className="inline-flex items-center gap-0.5 text-[7px] font-black uppercase px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200 align-middle" title="System-critical department — name is locked">
                                <KeyRound size={8} /> Locked
                              </span>
                            )}
                            {dept.isDisabled && (
                              <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-200 align-middle">Suspended</span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${dept.type === 'Strategic' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                            {dept.type}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          {displayCode ? (
                            <div className="flex flex-col gap-0.5">
                              <span className={`text-xs font-mono font-bold ${dept.codeChangedByDept ? 'line-through text-muted-foreground/30 decoration-red-400 decoration-2' : 'text-foreground'}`}>
                                {displayCode}
                              </span>
                              {dept.codeChangedByDept && (
                                <span className="text-[8px] font-black bg-amber-500 text-white px-1.5 py-0.5 rounded-md uppercase tracking-wider w-fit">
                                  ✓ Changed by Dept
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[9px] text-muted-foreground/40 italic">Not set</span>
                          )}
                        </td>
                        <td className="py-4 px-4">
                          {(() => {
                            const ts = sigTimestamps[dept.id] || 0;
                            const isUploading = uploadingSigFor === `uploading_${dept.id}`;
                            return (
                              <div className="flex flex-col items-center gap-1.5 min-w-[80px]">
                                <div className="w-16 h-10 rounded-lg border border-border/40 bg-muted/20 overflow-hidden flex items-center justify-center">
                                  <img
                                    src={`/api/departments/${dept.id}/signature/image?t=${ts}`}
                                    alt="sig"
                                    className="max-w-full max-h-full object-contain"
                                    onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                  />
                                  <div style={{ display: 'none' }} className="w-full h-full items-center justify-center">
                                    <PenTool size={12} className="text-muted-foreground/30" />
                                  </div>
                                </div>
                                <button
                                  disabled={isUploading}
                                  onClick={() => { setUploadingSigFor(dept.id); sigFileRef.current?.click(); }}
                                  className="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg bg-primary/10 hover:bg-primary hover:text-white text-primary transition-all flex items-center gap-1 disabled:opacity-50"
                                  title={`Set/override signature for ${dept.name}`}
                                >
                                  {isUploading ? <Loader2 size={9} className="animate-spin" /> : <Upload size={9} />}
                                  {isUploading ? 'Saving…' : 'Set'}
                                </button>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="py-4 px-4 text-xs font-mono font-bold text-muted-foreground">{dept.staffId || '—'}</td>
                        {(() => {
                          const parts = (dept.headName || '').trim().split(/\s+/).filter(Boolean);
                          const surname   = parts[0] || '—';
                          const firstName = parts[1] || '—';
                          const otherName = parts.slice(2).join(' ') || '—';
                          return (
                            <>
                              <td className="py-4 px-4 text-xs text-muted-foreground font-medium">{firstName}</td>
                              <td className="py-4 px-4 text-xs text-muted-foreground font-medium">{surname}</td>
                              <td className="py-4 px-4 text-xs text-muted-foreground/70 font-medium">{otherName}</td>
                            </>
                          );
                        })()}
                        <td className="py-4 px-4 text-xs text-primary font-medium">{dept.headEmail || '—'}</td>
                        <td className="py-4 px-4 text-xs text-muted-foreground font-medium">{dept.phone || '—'}</td>
                        <td className="py-4 px-4 border-r border-border/10">
                          <div className="flex items-center justify-center space-x-1">
                            <button onClick={() => setEditingDept(dept)} className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-lg transition-all" title="Edit Unit">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => setSealDept(dept)} className="p-2 text-indigo-500 hover:bg-indigo-50 rounded-lg transition-all" title="View Seal">
                              <Eye size={14} />
                            </button>
                            <button
                              onClick={() => handleResendWelcome(dept)}
                              disabled={resendingDeptId === dept.id}
                              className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-all disabled:opacity-40"
                              title="Resend welcome email + SMS with current credentials"
                            >
                              {resendingDeptId === dept.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            </button>
                            <button
                              onClick={() => handleToggleDisable(dept)}
                              disabled={togglingDeptId === dept.id}
                              className={`p-2 rounded-lg transition-all disabled:opacity-40 ${dept.isDisabled ? 'text-emerald-500 hover:bg-emerald-50' : 'text-amber-500 hover:bg-amber-50'}`}
                              title={dept.isDisabled ? 'Reactivate Department' : 'Suspend Department (blocks login; auto-elevates designated successor sub-account if one exists)'}
                            >
                              {togglingDeptId === dept.id ? <Loader2 size={14} className="animate-spin" /> : dept.isDisabled ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                            </button>
                            <button
                              onClick={() => { setPendingSecurityResetDept(dept); setIsSecurityResetModalOpen(true); }}
                              className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                              title="Security Reset: resets password, reactivates access code, force-logs-out every device, and notifies the department by SMS + email"
                            >
                              <KeyRound size={14} />
                            </button>
                            <button onClick={() => { setPendingDept(dept); setIsDeleteModalOpen(true); }} className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-lg transition-all" title="Delete Unit">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {mainDepartments.filter(d => { const q = searchTerm.trim().toLowerCase(); if (!q) return true; return [(d.name||''),(d.accessCode||''),(d.accessCodeLabel||''),(d.staffId||''),(d.headName||''),(d.headEmail||''),(d.phone||''),(d.type||'')].some(v => v.toLowerCase().includes(q)); }).length === 0 && (
               <div className="py-20 text-center">
                  <p className="text-sm text-muted-foreground italic">No departments match your search criteria.</p>
               </div>
            )}
          </div>
        </div>

        </>}
        {/* End departments tab */}

      </div>



      {/* Hidden file input for admin signature override */}
      <input
        type="file"
        ref={sigFileRef}
        className="hidden"
        accept="image/png,image/jpeg"
        onChange={handleAdminSigUpload}
      />

      {/* Import HOD Modal */}
      {importOpen && (
        <ImportHODModal onClose={() => setImportOpen(false)} onDone={() => { loadDepts(); setImportOpen(false); }} />
      )}

      {/* Export Modal */}
      {exportOpen && (
        <ExportModal departments={departments} onClose={() => setExportOpen(false)} />
      )}

      {/* Onboarding Export Modal */}
      {obExportOpen && (
        <OnboardingExportModal
          submissions={onboardingSubs}
          currentFilter={onboardingFilter}
          onClose={() => setObExportOpen(false)}
        />
      )}

      {/* Seal View Modal */}
      {sealDept && (
        <SealViewModal dept={sealDept} onClose={() => setSealDept(null)} />
      )}

      {/* Edit Modal */}
      {editingDept && (
        <EditDeptModal
          dept={editingDept}
          onClose={() => setEditingDept(null)}
          onSaved={() => { loadDepts(); setEditingDept(null); }}
        />
      )}

      {/* Add Modal — compact centered overlay, same style as Edit Department (keeps sidebar visible) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setIsAddModalOpen(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="sticky top-0 bg-white rounded-t-3xl px-6 pt-6 pb-4 border-b border-border/30 z-10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <Building2 size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-foreground">Add New Department</h3>
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">System Context Active</p>
                  </div>
                </div>
                <button onClick={() => setIsAddModalOpen(false)} className="p-2 hover:bg-muted rounded-xl text-muted-foreground transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>

            {(() => {
              const trimmedNewName = newDeptData.name.trim().toLowerCase();
              const nameClash = !!trimmedNewName && departments.some(d => (d.name || '').trim().toLowerCase() === trimmedNewName);
              return (
            <form onSubmit={handleAddSubmit} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Department Name</label>
                <input type="text" value={newDeptData.name} onChange={e => setNewDeptData(d => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. Finance & Accounts"
                  className={`w-full bg-muted/30 border rounded-xl p-4 outline-none ${nameClash ? 'border-red-400 focus:ring-2 focus:ring-red-200' : 'border-border/50 focus:ring-2 focus:ring-primary/20'}`} />
                {nameClash && (
                  <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1.5">
                    <AlertTriangle size={12} className="shrink-0" />
                    A department named "{newDeptData.name.trim()}" already exists. Please choose a different name.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Access Code</label>
                <div className="relative">
                  <input type={showAccessCode ? 'text' : 'password'} value={newDeptData.accessCode}
                    onChange={e => setNewDeptData(d => ({ ...d, accessCode: e.target.value }))}
                    placeholder="e.g. HATCH-2026"
                    className="w-full bg-muted/30 border border-border/50 rounded-xl p-4 pr-12 focus:ring-2 focus:ring-primary/20 outline-none font-mono" />
                  <button type="button" onClick={() => setShowAccessCode(v => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-primary">
                    {showAccessCode ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {['Operational', 'Strategic'].map(type => (
                  <button key={type} type="button" onClick={() => setNewDeptData(d => ({ ...d, type }))}
                    className={`p-4 rounded-xl border transition-all text-xs font-bold uppercase ${newDeptData.type === type ? 'bg-primary/10 border-primary/50 text-primary' : 'bg-white border-border/50 text-muted-foreground hover:border-border'}`}>
                    {type}
                  </button>
                ))}
              </div>

              {/* Head Official Details — hidden entirely when Super Admin disables this setting */}
              {deptCreationHeadDetailsEnabled === true && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border/40" />
                  <p className="text-[9px] font-black text-muted-foreground/50 uppercase tracking-[0.25em] shrink-0">Head Official</p>
                  <div className="h-px flex-1 bg-border/40" />
                </div>
                {[
                  { key: 'headStaffId',   label: 'Staff ID',          placeholder: 'e.g. CSS001',                icon: Hash,       required: true },
                  { key: 'headSurname',   label: 'Surname',          placeholder: 'e.g. Adeyemi',               icon: User,       required: true },
                  { key: 'headFirstName', label: 'First Name',        placeholder: 'e.g. John',                  icon: User,       required: true },
                  { key: 'headOtherName', label: 'Other Name',        placeholder: 'e.g. Chukwuemeka (optional)', icon: User },
                  { key: 'headTitle',     label: 'Position / Title',  placeholder: 'e.g. General Manager',       icon: BadgeCheck, required: true },
                  { key: 'headEmail',     label: 'Official Email',    placeholder: 'e.g. head@cssgroup.internal', icon: Mail, type: 'email', required: true },
                  { key: 'phone',         label: 'Contact Phone',     placeholder: '+234 800 000 0000',          icon: Phone,      type: 'tel', required: true },
                ].map(({ key, label, placeholder, icon: Icon, type, required }) => (
                  <div key={key} className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <div className="flex items-center border border-border/50 rounded-xl focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 bg-white">
                      <Icon size={14} className="text-muted-foreground ml-3 shrink-0" />
                      <input
                        value={newDeptData[key]}
                        onChange={e => setNewDeptData(d => ({ ...d, [key]: e.target.value }))}
                        type={type || 'text'}
                        placeholder={placeholder}
                        required={required}
                        className="flex-1 px-3 py-3 text-sm font-medium bg-transparent outline-none"
                      />
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground/70 italic pl-1">
                  Phone is used to SMS the access code to the head official when their account is set up.
                </p>
              </div>
              )}

              {deptCreationHeadDetailsEnabled === false && (
                <p className="text-[10px] text-muted-foreground/70 italic pl-1 pt-1">
                  Head Official details are currently disabled in System Settings. This department will be created without a head — assign one later via Edit.
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 px-4 py-3 rounded-xl border border-border font-bold text-sm hover:bg-muted transition-all">
                  Cancel
                </button>
                <button type="submit" disabled={
                    isProcessing || nameClash || !newDeptData.name.trim() || !newDeptData.accessCode.trim() ||
                    (deptCreationHeadDetailsEnabled === true && (
                      !newDeptData.headStaffId.trim() || !newDeptData.headSurname.trim() || !newDeptData.headFirstName.trim() ||
                      !newDeptData.headTitle.trim() || !newDeptData.headEmail.trim() || !newDeptData.phone.trim()
                    ))
                  }
                  className="flex-1 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {isProcessing ? <><Loader2 size={14} className="animate-spin" /><span>Creating…</span></> : <span>Create Department</span>}
                </button>
              </div>
            </form>
              );
            })()}
          </div>
        </div>
      )}

      <ConfirmModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={confirmDelete}
        isProcessing={isProcessing} title="Delete Department"
        message={`Are you sure you want to permanently delete "${pendingDept?.name}"? This action cannot be undone.`} />

      <ConfirmModal isOpen={isSecurityResetModalOpen} onClose={() => setIsSecurityResetModalOpen(false)} onConfirm={confirmSecurityReset}
        isProcessing={securityResetting} title="Security Reset" type="warning"
        confirmText="Reset & Force Logout"
        message={`This will immediately: reset ${pendingSecurityResetDept?.name || 'this department'}'s current password, generate a fresh access code, log them out of every device they're currently signed in on, and send the new access code by SMS and email to the phone number and address on file. They will need to log in with the new code and set a new password. Continue?`} />

    </>
  );
};

export default DepartmentManager;
