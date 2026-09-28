import React, { useState, useEffect, useCallback } from 'react';

// ── Helpers ────────────────────────────────────────────────────────────────
const toUpper = (s) => (s || '').toUpperCase();
const makeOfficialEmail = (firstName, surname) => {
  const clean = s => (s || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  const f = clean(firstName); const l = clean(surname);
  return f && l ? `${f}.${l}@cssgroup.com.ng` : '';
};
const isNigerianPhone = (p) => /^(\+234|0)[789]\d{9}$/.test((p || '').replace(/\s+/g, ''));

// ── Field Wrapper ──────────────────────────────────────────────────────────
function Field({ label, required, error, hint, children }) {
  return (
    <div className="space-y-2">
      <label style={{ display:'block', fontSize:'13px', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.12em', color: error ? '#dc2626' : '#374151' }}>
        {label}{required && <span style={{ color:'#dc2626', marginLeft:3 }}>*</span>}
      </label>
      {children}
      {error && (
        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 12px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10 }}>
          <span style={{ fontSize:14 }}>⚠️</span>
          <span style={{ fontSize:13, fontWeight:700, color:'#dc2626' }}>{error}</span>
        </div>
      )}
      {hint && !error && <p style={{ fontSize:12, color:'#6b7280', fontWeight:500 }}>{hint}</p>}
    </div>
  );
}

const inputStyle = (err) => ({
  width: '100%',
  padding: '14px 16px',
  borderRadius: 12,
  border: `2px solid ${err ? '#fca5a5' : '#e5e7eb'}`,
  background: err ? '#fff5f5' : '#ffffff',
  fontSize: 15,
  fontWeight: 700,
  color: '#111827',
  outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
});

const selectStyle = (err) => ({
  ...inputStyle(err),
  appearance: 'none',
  cursor: 'pointer',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280' stroke-width='2.5'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C%2Fsvg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 14px center',
  backgroundSize: 18,
  paddingRight: 44,
});

// ── Section Card ──────────────────────────────────────────────────────────
function Section({ number, title, icon, children }) {
  return (
    <div style={{ background:'#ffffff', borderRadius:20, border:'2px solid #e5e7eb', overflow:'hidden', boxShadow:'0 4px 24px rgba(0,0,0,0.06)' }}>
      <div style={{ padding:'18px 24px', borderBottom:'2px solid #f0fdf4', background:'linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%)', display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:36, height:36, borderRadius:'50%', background:'linear-gradient(135deg,#16a34a,#15803d)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:16, fontWeight:900, flexShrink:0, boxShadow:'0 4px 10px rgba(22,163,74,0.35)' }}>
          {number}
        </div>
        <div>
          <p style={{ margin:0, fontSize:15, fontWeight:900, color:'#14532d', letterSpacing:'0.04em', textTransform:'uppercase' }}>{title}</p>
        </div>
      </div>
      <div style={{ padding:'24px 24px 28px', display:'flex', flexDirection:'column', gap:20 }}>
        {children}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function StaffOnboardingForm() {
  const [departments, setDepartments] = useState([]);
  const [deptLoading, setDeptLoading] = useState(true);
  const [roleAvail, setRoleAvail] = useState({ headTaken: false, assistantTaken: false });
  const [roleChecking, setRoleChecking] = useState(false);
  const [showCustomDept, setShowCustomDept] = useState(false); // toggle for custom dept field

  const [form, setForm] = useState({
    staffId: '', surname: '', firstName: '', middleName: '',
    phone: '', personalEmail: '',
    deptId: '', customDeptName: '',
    role: '',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    fetch('/api/public/onboarding/departments')
      .then(r => r.json())
      .then(d => setDepartments(Array.isArray(d) ? d : []))
      .catch(() => setDepartments([]))
      .finally(() => setDeptLoading(false));
  }, []);

  const checkRoles = useCallback(async (deptId) => {
    if (!deptId) { setRoleAvail({ headTaken: false, assistantTaken: false }); return; }
    setRoleChecking(true);
    try {
      const r = await fetch(`/api/public/onboarding/dept-roles?deptId=${deptId}`);
      const d = await r.json();
      setRoleAvail(d);
      setForm(prev => {
        if ((prev.role === 'HEAD' && d.headTaken) || (prev.role === 'ASSISTANT' && d.assistantTaken)) return { ...prev, role: '' };
        return prev;
      });
    } catch { setRoleAvail({ headTaken: false, assistantTaken: false }); }
    finally { setRoleChecking(false); }
  }, []);

  const clearErr = (field) => setErrors(prev => ({ ...prev, [field]: '' }));

  const setField = (field, value) => {
    clearErr(field);
    setServerError('');
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleDeptSelect = (val) => {
    clearErr('deptId');
    setServerError('');
    if (val) {
      // A real dept is selected — clear custom and hide
      setShowCustomDept(false);
      setForm(prev => ({ ...prev, deptId: val, customDeptName: '' }));
      checkRoles(val);
    } else {
      setForm(prev => ({ ...prev, deptId: '', customDeptName: '' }));
      checkRoles('');
    }
  };

  const handleNotListed = () => {
    // Deselect dept, open custom field
    setShowCustomDept(true);
    setForm(prev => ({ ...prev, deptId: '', customDeptName: '' }));
    clearErr('deptId');
    setServerError('');
    checkRoles('');
  };

  const handleBackToDepts = () => {
    setShowCustomDept(false);
    setForm(prev => ({ ...prev, customDeptName: '' }));
    clearErr('deptId');
  };

  const officialEmail = makeOfficialEmail(form.firstName, form.surname);

  const validate = () => {
    const e = {};
    if (!form.staffId.trim()) e.staffId = 'Staff ID is required.';
    else if (!/^\d+$/.test(form.staffId.trim())) e.staffId = 'Staff ID must be numbers only (e.g. 12345).';
    if (!form.surname.trim()) e.surname = 'Surname is required.';
    if (!form.firstName.trim()) e.firstName = 'First name is required.';
    if (!form.phone.trim()) e.phone = 'Phone number is required.';
    else if (!isNigerianPhone(form.phone)) e.phone = 'Enter a valid Nigerian number (e.g. 08012345678 or +2348012345678).';
    if (!form.personalEmail.trim()) e.personalEmail = 'Personal email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.personalEmail.trim())) e.personalEmail = 'Enter a valid email address.';
    else if (/@cssgroup\./i.test(form.personalEmail)) e.personalEmail = 'Use your personal email — not your official CSS Group email.';
    if (!form.deptId && !form.customDeptName.trim()) e.deptId = 'Select your department or enter a custom department name.';
    if (!form.role) e.role = 'Select your role in the department.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setSubmitting(true);
    setServerError('');
    try {
      const payload = {
        staffId: form.staffId.trim(),
        surname: form.surname.trim(),
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || null,
        phone: form.phone.trim(),
        personalEmail: form.personalEmail.trim().toLowerCase(),
        deptId: form.deptId || null,
        customDeptName: form.customDeptName.trim() || null,
        role: form.role,
      };
      const res = await fetch('/api/public/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.field) setErrors(prev => ({ ...prev, [data.field]: data.error }));
        else setServerError(data.error || 'Submission failed. Please try again.');
        return;
      }
      setSuccess({ refId: data.refId, officialEmail: data.officialEmail });
    } catch {
      setServerError('Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success Screen ──────────────────────────────────────────────────────
  if (success) {
    return (
      <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#052e16 0%,#14532d 40%,#166534 100%)', display:'flex', alignItems:'center', justifyContent:'center', padding:24, fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}>
        <div style={{ width:'100%', maxWidth:480, background:'#fff', borderRadius:28, overflow:'hidden', boxShadow:'0 32px 80px rgba(0,0,0,0.45)' }}>
          <div style={{ background:'linear-gradient(135deg,#15803d,#14532d)', padding:'40px 32px', textAlign:'center' }}>
            <img src="/CSS_Group.png" alt="CSS Group" style={{ height:44, objectFit:'contain', marginBottom:20, opacity:0.95 }} />
            <div style={{ width:72, height:72, borderRadius:'50%', background:'rgba(255,255,255,0.15)', border:'3px solid rgba(255,255,255,0.4)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <h2 style={{ margin:0, fontSize:24, fontWeight:900, color:'#fff', letterSpacing:'-0.02em' }}>Submission Received!</h2>
            <p style={{ margin:'8px 0 0', fontSize:14, color:'rgba(255,255,255,0.7)', fontWeight:500 }}>Your application is under review</p>
          </div>
          <div style={{ padding:'32px 32px', display:'flex', flexDirection:'column', gap:20 }}>
            <div style={{ background:'#f0fdf4', border:'2px solid #86efac', borderRadius:16, padding:'20px 20px' }}>
              <p style={{ margin:'0 0 6px', fontSize:11, fontWeight:900, textTransform:'uppercase', letterSpacing:'0.15em', color:'#15803d' }}>Reference Number</p>
              <p style={{ margin:0, fontSize:28, fontWeight:900, color:'#14532d', letterSpacing:'0.12em', fontFamily:'monospace' }}>{success.refId}</p>
            </div>
            <div style={{ background:'#eff6ff', border:'2px solid #bfdbfe', borderRadius:16, padding:'20px 20px' }}>
              <p style={{ margin:'0 0 6px', fontSize:11, fontWeight:900, textTransform:'uppercase', letterSpacing:'0.15em', color:'#1d4ed8' }}>Your Official CSS Group Email</p>
              <p style={{ margin:'0 0 6px', fontSize:16, fontWeight:900, color:'#1e40af', wordBreak:'break-all' }}>{success.officialEmail}</p>
              <p style={{ margin:0, fontSize:12, color:'#3b82f6', fontWeight:500 }}>This will be your company email once your account is activated.</p>
            </div>
            <div style={{ background:'#fffbeb', border:'2px solid #fcd34d', borderRadius:16, padding:'20px 20px' }}>
              <p style={{ margin:'0 0 8px', fontSize:11, fontWeight:900, textTransform:'uppercase', letterSpacing:'0.15em', color:'#b45309' }}>What Happens Next</p>
              <p style={{ margin:0, fontSize:13, color:'#78350f', fontWeight:600, lineHeight:1.6 }}>
                The system administrator will review your submission. Once approved, your <strong>RMS portal access code and login instructions</strong> will be sent to your personal email address and phone number.
              </p>
            </div>
            <p style={{ margin:0, textAlign:'center', fontSize:12, color:'#9ca3af', fontWeight:600 }}>CSS Group of Companies · RMS Portal</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(160deg,#052e16 0%,#14532d 35%,#1a6b3c 65%,#052e16 100%)', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', position:'relative', overflow:'hidden' }}>

      {/* Background pattern */}
      <div style={{ position:'absolute', inset:0, opacity:0.04, backgroundImage:`url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`, pointerEvents:'none' }} />

      <div style={{ position:'relative', zIndex:1, maxWidth:620, margin:'0 auto', padding:'32px 16px 60px' }}>

        {/* ── Hero Header ── */}
        <div style={{ textAlign:'center', marginBottom:36 }}>
          <div style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', background:'rgba(255,255,255,0.12)', border:'2px solid rgba(255,255,255,0.2)', borderRadius:20, padding:'12px 20px', marginBottom:20, backdropFilter:'blur(10px)' }}>
            <img src="/CSS_Group.png" alt="CSS Group" style={{ height:40, objectFit:'contain' }} />
          </div>
          <h1 style={{ margin:'0 0 8px', fontSize:32, fontWeight:900, color:'#ffffff', letterSpacing:'-0.03em', textShadow:'0 2px 20px rgba(0,0,0,0.3)' }}>Staff Onboarding</h1>
          <p style={{ margin:'0 0 6px', fontSize:14, fontWeight:800, color:'#86efac', textTransform:'uppercase', letterSpacing:'0.18em' }}>CSS Group RMS Portal</p>
          <p style={{ margin:0, fontSize:14, color:'rgba(255,255,255,0.65)', fontWeight:500, maxWidth:400, marginLeft:'auto', marginRight:'auto', lineHeight:1.6 }}>
            Complete all required fields. Your submission will be reviewed by the administrator before your account is created.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate style={{ display:'flex', flexDirection:'column', gap:20 }}>

          {/* ── Section 1: Personal Details ── */}
          <Section number="1" title="Personal Details">
            <Field label="Staff ID" required error={errors.staffId} hint="Numbers only — e.g. 12345">
              <input
                type="text"
                inputMode="numeric"
                value={form.staffId}
                onChange={e => setField('staffId', e.target.value.replace(/\D/g, ''))}
                placeholder="Enter your staff ID number"
                style={inputStyle(errors.staffId)}
                maxLength={20}
                onFocus={e => e.target.style.borderColor = errors.staffId ? '#fca5a5' : '#16a34a'}
                onBlur={e => e.target.style.borderColor = errors.staffId ? '#fca5a5' : '#e5e7eb'}
              />
            </Field>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              <Field label="Surname" required error={errors.surname}>
                <input type="text" value={form.surname} onChange={e => setField('surname', toUpper(e.target.value))}
                  placeholder="SURNAME" style={inputStyle(errors.surname)} maxLength={60}
                  onFocus={e => e.target.style.borderColor = errors.surname ? '#fca5a5' : '#16a34a'}
                  onBlur={e => e.target.style.borderColor = errors.surname ? '#fca5a5' : '#e5e7eb'} />
              </Field>
              <Field label="First Name" required error={errors.firstName}>
                <input type="text" value={form.firstName} onChange={e => setField('firstName', toUpper(e.target.value))}
                  placeholder="FIRST NAME" style={inputStyle(errors.firstName)} maxLength={60}
                  onFocus={e => e.target.style.borderColor = errors.firstName ? '#fca5a5' : '#16a34a'}
                  onBlur={e => e.target.style.borderColor = errors.firstName ? '#fca5a5' : '#e5e7eb'} />
              </Field>
            </div>

            <Field label="Middle Name" hint="Optional — leave blank if not applicable">
              <input type="text" value={form.middleName} onChange={e => setField('middleName', toUpper(e.target.value))}
                placeholder="MIDDLE NAME (OPTIONAL)" style={inputStyle(false)} maxLength={60}
                onFocus={e => e.target.style.borderColor = '#16a34a'}
                onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
            </Field>
          </Section>

          {/* ── Section 2: Contact Details ── */}
          <Section number="2" title="Contact Details">
            <Field label="Phone Number" required error={errors.phone} hint="Nigerian number — e.g. 08012345678 or +2348012345678">
              <input type="tel" value={form.phone} onChange={e => setField('phone', e.target.value)}
                placeholder="08012345678" style={inputStyle(errors.phone)} maxLength={16}
                onFocus={e => e.target.style.borderColor = errors.phone ? '#fca5a5' : '#16a34a'}
                onBlur={e => e.target.style.borderColor = errors.phone ? '#fca5a5' : '#e5e7eb'} />
            </Field>

            <Field label="Personal Email Address" required error={errors.personalEmail}
              hint="Use your personal/private email — NOT a CSS Group official email address">
              <input type="email" value={form.personalEmail} onChange={e => setField('personalEmail', e.target.value.toLowerCase())}
                placeholder="yourname@gmail.com" style={inputStyle(errors.personalEmail)} maxLength={120}
                onFocus={e => e.target.style.borderColor = errors.personalEmail ? '#fca5a5' : '#16a34a'}
                onBlur={e => e.target.style.borderColor = errors.personalEmail ? '#fca5a5' : '#e5e7eb'} />
            </Field>

            {/* Official email preview */}
            {officialEmail && (
              <div style={{ background:'linear-gradient(135deg,#eff6ff,#dbeafe)', border:'2px solid #93c5fd', borderRadius:14, padding:'16px 18px' }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                  <div style={{ width:32, height:32, borderRadius:8, background:'#3b82f6', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>
                  </div>
                  <div>
                    <p style={{ margin:'0 0 4px', fontSize:11, fontWeight:900, textTransform:'uppercase', letterSpacing:'0.14em', color:'#1d4ed8' }}>Your Official CSS Group Email (Auto-Generated)</p>
                    <p style={{ margin:'0 0 4px', fontSize:16, fontWeight:900, color:'#1e3a8a', wordBreak:'break-all' }}>{officialEmail}</p>
                    <p style={{ margin:0, fontSize:12, color:'#3b82f6', fontWeight:600 }}>This is auto-generated and cannot be changed. It will be activated once you are enrolled.</p>
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* ── Section 3: Department & Role ── */}
          <Section number="3" title="Department & Role">

            {/* Department selector — mutually exclusive with custom input */}
            {!showCustomDept ? (
              <Field label="Department" required error={errors.deptId}>
                <select
                  value={form.deptId}
                  onChange={e => handleDeptSelect(e.target.value)}
                  style={selectStyle(errors.deptId)}
                  disabled={deptLoading}
                  onFocus={e => e.target.style.borderColor = errors.deptId ? '#fca5a5' : '#16a34a'}
                  onBlur={e => e.target.style.borderColor = errors.deptId ? '#fca5a5' : '#e5e7eb'}
                >
                  <option value="">{deptLoading ? 'Loading departments…' : '— Select your department —'}</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                {/* "Not listed" toggle */}
                <button
                  type="button"
                  onClick={handleNotListed}
                  style={{ marginTop:10, display:'flex', alignItems:'center', gap:8, padding:'10px 16px', borderRadius:12, border:'2px dashed #d1fae5', background:'#f0fdf4', cursor:'pointer', width:'100%', transition:'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background='#dcfce7'; e.currentTarget.style.borderColor='#86efac'; }}
                  onMouseLeave={e => { e.currentTarget.style.background='#f0fdf4'; e.currentTarget.style.borderColor='#d1fae5'; }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
                  <span style={{ fontSize:13, fontWeight:800, color:'#15803d' }}>I can't find my department — click here to enter it manually</span>
                  <svg style={{ marginLeft:'auto', flexShrink:0 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                </button>
              </Field>
            ) : (
              <Field label="Custom Department Name" required error={errors.deptId}
                hint="Your request will need admin approval before your enrollment can proceed">
                {/* Back button */}
                <button
                  type="button"
                  onClick={handleBackToDepts}
                  style={{ marginBottom:10, display:'flex', alignItems:'center', gap:8, padding:'10px 16px', borderRadius:12, border:'2px solid #d1fae5', background:'#f0fdf4', cursor:'pointer', width:'fit-content', transition:'all 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background='#dcfce7'}
                  onMouseLeave={e => e.currentTarget.style.background='#f0fdf4'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
                  <span style={{ fontSize:13, fontWeight:800, color:'#15803d' }}>Back to department list</span>
                </button>
                <input
                  type="text"
                  value={form.customDeptName}
                  onChange={e => setField('customDeptName', toUpper(e.target.value))}
                  placeholder="E.G. POULTRY LAYERS PEN 1 / FARM A"
                  style={inputStyle(errors.deptId)}
                  maxLength={100}
                  autoFocus
                  onFocus={e => e.target.style.borderColor = errors.deptId ? '#fca5a5' : '#16a34a'}
                  onBlur={e => e.target.style.borderColor = errors.deptId ? '#fca5a5' : '#e5e7eb'}
                />
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:10, marginTop:4 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  <span style={{ fontSize:12, fontWeight:700, color:'#92400e' }}>This new department must be approved by the administrator first. You'll be notified once it's processed.</span>
                </div>
              </Field>
            )}

            {/* Role selector */}
            <Field label="Your Role" required error={errors.role}>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {[
                  { value:'HEAD',      label:'Head of Unit / Department', desc:'Primary account holder — leads the department' },
                  { value:'ASSISTANT', label:'Assistant',                  desc:'Designated second-in-command with delegated privileges' },
                  { value:'MEMBER',    label:'Member',                     desc:'Standard staff member of the department' },
                ].map(opt => {
                  const taken = (opt.value === 'HEAD' && form.deptId && roleAvail.headTaken) ||
                                (opt.value === 'ASSISTANT' && form.deptId && roleAvail.assistantTaken);
                  const selected = form.role === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={taken}
                      onClick={() => !taken && setField('role', opt.value)}
                      style={{
                        width:'100%', textAlign:'left', padding:'16px 18px', borderRadius:14,
                        border: `2px solid ${selected ? '#16a34a' : taken ? '#f3f4f6' : '#e5e7eb'}`,
                        background: selected ? 'linear-gradient(135deg,#f0fdf4,#dcfce7)' : taken ? '#f9fafb' : '#ffffff',
                        cursor: taken ? 'not-allowed' : 'pointer',
                        display:'flex', alignItems:'flex-start', gap:14,
                        opacity: taken ? 0.55 : 1,
                        transition:'all 0.15s',
                        boxShadow: selected ? '0 4px 16px rgba(22,163,74,0.18)' : 'none',
                      }}
                    >
                      {/* Radio dot */}
                      <div style={{ width:20, height:20, borderRadius:'50%', border:`2.5px solid ${selected ? '#16a34a' : '#d1d5db'}`, background: selected ? '#16a34a' : '#fff', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:2, transition:'all 0.15s' }}>
                        {selected && <div style={{ width:8, height:8, borderRadius:'50%', background:'#fff' }} />}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                          <span style={{ fontSize:15, fontWeight:900, color: selected ? '#14532d' : taken ? '#9ca3af' : '#111827' }}>{opt.label}</span>
                          {taken && (
                            <span style={{ fontSize:11, fontWeight:800, color:'#d97706', background:'#fef3c7', padding:'2px 8px', borderRadius:20, border:'1px solid #fcd34d' }}>
                              {roleChecking ? '…checking' : 'Already claimed'}
                            </span>
                          )}
                        </div>
                        <p style={{ margin:'4px 0 0', fontSize:13, color: selected ? '#15803d' : '#6b7280', fontWeight:600 }}>{opt.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
              {roleChecking && (
                <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:8, fontSize:13, color:'#6b7280', fontWeight:600 }}>
                  <div style={{ width:14, height:14, borderRadius:'50%', border:'2px solid #d1d5db', borderTopColor:'#16a34a', animation:'spin 0.8s linear infinite' }} />
                  Checking role availability for selected department…
                </div>
              )}
            </Field>
          </Section>

          {/* ── Notice ── */}
          <div style={{ background:'rgba(255,255,255,0.08)', border:'2px solid rgba(255,255,255,0.15)', borderRadius:18, padding:'20px 22px', backdropFilter:'blur(10px)' }}>
            <p style={{ margin:'0 0 10px', fontSize:12, fontWeight:900, color:'#86efac', textTransform:'uppercase', letterSpacing:'0.14em' }}>📌 Important Notice</p>
            <ul style={{ margin:0, padding:'0 0 0 18px', display:'flex', flexDirection:'column', gap:6 }}>
              {[
                'All submissions are reviewed by the system administrator before any account is created.',
                'Your login credentials will be sent to your personal email and phone once approved.',
                'Submitting false or duplicate information may result in rejection.',
              ].map((item, i) => (
                <li key={i} style={{ fontSize:13, color:'rgba(255,255,255,0.8)', fontWeight:600, lineHeight:1.5 }}>{item}</li>
              ))}
            </ul>
          </div>

          {/* Server error */}
          {serverError && (
            <div style={{ background:'#fef2f2', border:'2px solid #fca5a5', borderRadius:14, padding:'16px 20px', display:'flex', alignItems:'center', gap:12 }}>
              <span style={{ fontSize:20 }}>⚠️</span>
              <p style={{ margin:0, fontSize:14, fontWeight:700, color:'#dc2626' }}>{serverError}</p>
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={submitting}
            style={{
              width:'100%', padding:'18px 24px', borderRadius:16,
              background: submitting ? '#6b7280' : 'linear-gradient(135deg,#16a34a,#15803d)',
              border:'none', color:'#fff', fontSize:17, fontWeight:900,
              letterSpacing:'0.04em', cursor: submitting ? 'not-allowed' : 'pointer',
              boxShadow:'0 8px 32px rgba(22,163,74,0.45)', transition:'all 0.2s',
              display:'flex', alignItems:'center', justifyContent:'center', gap:10,
              fontFamily:'inherit',
            }}
          >
            {submitting ? (
              <>
                <div style={{ width:20, height:20, borderRadius:'50%', border:'3px solid rgba(255,255,255,0.3)', borderTopColor:'#fff', animation:'spin 0.8s linear infinite' }} />
                Submitting your application…
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                Submit Onboarding Form
              </>
            )}
          </button>

          <p style={{ textAlign:'center', fontSize:12, color:'rgba(255,255,255,0.45)', fontWeight:600, margin:0 }}>
            CSS Group of Companies &bull; Requisition Management System &bull; Staff Onboarding Portal
          </p>
        </form>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
