import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Helpers ────────────────────────────────────────────────────────────────
const toUpper = (s) => (s || '').toUpperCase();
const makeOfficialEmail = (firstName, surname) => {
  const clean = s => (s || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  const f = clean(firstName); const l = clean(surname);
  return f && l ? `${f}.${l}@cssgroup.com.ng` : '';
};
const isNigerianPhone = (p) => /^(\+234|0)[789]\d{9}$/.test((p || '').replace(/\s+/g, ''));
const isCompanyEmail = (e) => /cssgroup\.com\.ng|cssgrouprms\.com/i.test(e || '');

// ── CSS injected once ──────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @keyframes ob-spin { to { transform: rotate(360deg); } }

  /* 2-col name grid collapses to 1-col on phones */
  .ob-name-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  @media (max-width: 500px) {
    .ob-name-grid { grid-template-columns: 1fr; }
    .ob-hero-h1  { font-size: 22px !important; }
    .ob-hero-sub { font-size: 12px !important; letter-spacing: 0.12em !important; }
    .ob-hero-p   { font-size: 13px !important; }
    .ob-sec-body { padding: 16px 14px 20px !important; }
    .ob-sec-head { padding: 14px 16px !important; }
    .ob-notlisted-text { font-size: 12px !important; }
    .ob-submit-btn { font-size: 15px !important; padding: 16px 20px !important; }
  }
`;

// ── Field Wrapper ──────────────────────────────────────────────────────────
function Field({ label, required, error, hint, children, fieldId }) {
  return (
    <div data-ob-field={fieldId} style={{ display:'flex', flexDirection:'column', gap:6 }}>
      <label style={{ display:'block', fontSize:'13px', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.12em', color: error ? '#dc2626' : '#374151' }}>
        {label}{required && <span style={{ color:'#dc2626', marginLeft:3 }}>*</span>}
      </label>
      {children}
      {error && (
        <div style={{ display:'flex', alignItems:'flex-start', gap:6, padding:'8px 12px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10 }}>
          <span style={{ fontSize:14, flexShrink:0 }}>⚠️</span>
          <span style={{ fontSize:13, fontWeight:700, color:'#dc2626', lineHeight:1.4 }}>{error}</span>
        </div>
      )}
      {hint && !error && <p style={{ margin:0, fontSize:12, color:'#6b7280', fontWeight:500, lineHeight:1.4 }}>{hint}</p>}
    </div>
  );
}

const inputStyle = (err) => ({
  width: '100%',
  padding: '13px 14px',
  borderRadius: 12,
  border: `2px solid ${err ? '#fca5a5' : '#e5e7eb'}`,
  background: err ? '#fff5f5' : '#ffffff',
  fontSize: 15,
  fontWeight: 700,
  color: '#111827',
  outline: 'none',
  transition: 'border-color 0.15s',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  appearance: 'none',
  minHeight: 48,
});

const selectStyle = (err) => ({
  ...inputStyle(err),
  cursor: 'pointer',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280' stroke-width='2.5'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C%2Fsvg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 14px center',
  backgroundSize: 18,
  paddingRight: 44,
});

// ── Section Card ──────────────────────────────────────────────────────────
function Section({ number, title, children }) {
  return (
    <div style={{ background:'#ffffff', borderRadius:20, border:'2px solid #e5e7eb', overflow:'hidden', boxShadow:'0 4px 24px rgba(0,0,0,0.06)' }}>
      <div className="ob-sec-head" style={{ padding:'16px 20px', borderBottom:'2px solid #f0fdf4', background:'linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%)', display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:34, height:34, borderRadius:'50%', background:'linear-gradient(135deg,#16a34a,#15803d)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:15, fontWeight:900, flexShrink:0, boxShadow:'0 3px 8px rgba(22,163,74,0.35)' }}>
          {number}
        </div>
        <p style={{ margin:0, fontSize:14, fontWeight:900, color:'#14532d', letterSpacing:'0.04em', textTransform:'uppercase' }}>{title}</p>
      </div>
      <div className="ob-sec-body" style={{ padding:'20px 20px 24px', display:'flex', flexDirection:'column', gap:18 }}>
        {children}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function StaffOnboardingForm() {
  const scrollRef = useRef(null);

  const [departments, setDepartments] = useState([]);
  const [deptLoading, setDeptLoading] = useState(true);
  const [roleAvail, setRoleAvail] = useState({ headTaken: false, assistantTaken: false });
  const [roleChecking, setRoleChecking] = useState(false);
  const [showCustomDept, setShowCustomDept] = useState(false);

  const [customDeptDuplicate, setCustomDeptDuplicate] = useState(null); // matched existing dept

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

  // ── Live duplicate check state ─────────────────────────────────────────────
  const [taken, setTaken] = useState({ staffId: null, phone: null, personalEmail: null });
  const checkTimers = useRef({});

  const scrollToFirstError = useCallback((errorObj) => {
    setTimeout(() => {
      const container = scrollRef.current;
      if (!container) return;
      const firstKey = Object.keys(errorObj).find(k => errorObj[k]);
      if (!firstKey) return;
      const el = container.querySelector(`[data-ob-field="${firstKey}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }, []);

  const liveCheck = useCallback((field, value) => {
    clearTimeout(checkTimers.current[field]);
    if (!value || value.length < 3) { setTaken(prev => ({ ...prev, [field]: null })); return; }
    checkTimers.current[field] = setTimeout(async () => {
      try {
        const r = await fetch(`/api/public/onboarding/check?field=${field}&value=${encodeURIComponent(value)}`);
        const d = await r.json();
        setTaken(prev => ({ ...prev, [field]: d.taken }));
      } catch { /* silent */ }
    }, 600);
  }, []);

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
        if ((prev.role === 'HEAD' && d.headTaken) || (prev.role === 'ASSISTANT' && d.assistantTaken))
          return { ...prev, role: '' };
        return prev;
      });
    } catch { setRoleAvail({ headTaken: false, assistantTaken: false }); }
    finally { setRoleChecking(false); }
  }, []);

  const clearErr = (field) => setErrors(prev => ({ ...prev, [field]: '' }));
  const setField = (field, value) => {
    clearErr(field); setServerError('');
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleDeptSelect = (val) => {
    clearErr('deptId'); setServerError('');
    if (val) {
      setShowCustomDept(false);
      setForm(prev => ({ ...prev, deptId: val, customDeptName: '' }));
      checkRoles(val);
    } else {
      setForm(prev => ({ ...prev, deptId: '', customDeptName: '' }));
      checkRoles('');
    }
  };

  const handleNotListed = () => {
    setShowCustomDept(true);
    setCustomDeptDuplicate(null);
    setForm(prev => ({ ...prev, deptId: '', customDeptName: '' }));
    clearErr('deptId'); setServerError('');
    checkRoles('');
  };

  const handleBackToDepts = () => {
    setShowCustomDept(false);
    setCustomDeptDuplicate(null);
    setForm(prev => ({ ...prev, customDeptName: '' }));
    clearErr('deptId');
  };

  const handleCustomDeptChange = (val) => {
    const upper = toUpper(val);
    setField('customDeptName', upper);
    if (upper.length >= 2) {
      const match = departments.find(d => d.name.toUpperCase() === upper);
      setCustomDeptDuplicate(match || null);
    } else {
      setCustomDeptDuplicate(null);
    }
  };

  const switchToExistingDept = (dept) => {
    setShowCustomDept(false);
    setCustomDeptDuplicate(null);
    setForm(prev => ({ ...prev, deptId: String(dept.id), customDeptName: '' }));
    clearErr('deptId'); setServerError('');
    checkRoles(String(dept.id));
  };

  const officialEmail = makeOfficialEmail(form.firstName, form.surname);

  const validate = () => {
    const e = {};
    if (!form.staffId.trim()) e.staffId = 'Staff ID is required.';
    else if (!/^\d+$/.test(form.staffId.trim())) e.staffId = 'Staff ID must be numbers only. Contact the HR department for your verified Staff ID.';
    else if (form.staffId.trim().length !== 5) e.staffId = 'Staff ID must be exactly 5 digits (e.g. 10001, 20938). Contact HR for your correct Staff ID.';
    else if (!/^[123]/.test(form.staffId.trim())) e.staffId = 'Staff ID must start with 1, 2, or 3 (e.g. 10001, 20938, 30001). Contact the HR department for your verified and valid Staff ID — do not enter an ID that was not issued to you.';
    else if (taken.staffId) e.staffId = 'This Staff ID is already registered. Contact admin if this is an error.';
    if (!form.surname.trim()) e.surname = 'Surname is required.';
    if (!form.firstName.trim()) e.firstName = 'First name is required.';
    if (!form.phone.trim()) e.phone = 'Phone number is required.';
    else if (!isNigerianPhone(form.phone)) e.phone = 'Enter a valid Nigerian number (e.g. 08012345678).';
    else if (taken.phone) e.phone = 'This phone number is already registered.';
    if (!form.personalEmail.trim()) e.personalEmail = 'Personal email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.personalEmail.trim())) e.personalEmail = 'Enter a valid email address.';
    else if (isCompanyEmail(form.personalEmail)) e.personalEmail = 'Use your personal email — not your CSS Group official email. The system will generate your company email automatically.';
    else if (taken.personalEmail) e.personalEmail = 'This email address is already registered.';
    if (!form.deptId && !form.customDeptName.trim()) e.deptId = 'Select your department or enter a custom department name.';
    if (!form.role) e.role = 'Select your role in the department.';
    setErrors(e);
    if (Object.keys(e).length > 0) scrollToFirstError(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true); setServerError('');
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
        if (data.field) {
          const newErrors = { [data.field]: data.error };
          setErrors(prev => ({ ...prev, ...newErrors }));
          scrollToFirstError(newErrors);
        } else {
          setServerError(data.error || 'Submission failed. Please try again.');
        }
        return;
      }
      setSuccess({
        refId:           data.refId,
        officialEmail:   data.officialEmail,
        webmailUrl:      data.webmailUrl      || null,
        webmailPassword: data.webmailPassword || null,
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setServerError('Network error. Please check your connection and try again.');
    } finally { setSubmitting(false); }
  };

  // ── Success Screen ──────────────────────────────────────────────────────
  if (success) {
    const step = (n, color, title, children) => (
      <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
        <div style={{ flexShrink:0, width:28, height:28, borderRadius:'50%', background:color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:900, color:'#fff', marginTop:1 }}>{n}</div>
        <div style={{ flex:1 }}>
          <p style={{ margin:'0 0 3px', fontSize:12, fontWeight:900, textTransform:'uppercase', letterSpacing:'0.12em', color:color }}>{title}</p>
          {children}
        </div>
      </div>
    );
    return (
      <>
        <style>{GLOBAL_CSS}</style>
        <div style={{ height:'100dvh', overflowY:'auto', WebkitOverflowScrolling:'touch', background:'linear-gradient(135deg,#052e16 0%,#14532d 40%,#166534 100%)', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', boxSizing:'border-box' }}>
          <div style={{ maxWidth:520, margin:'0 auto', padding:'28px 16px 60px', boxSizing:'border-box' }}>

            {/* ── Hero ── */}
            <div style={{ background:'linear-gradient(135deg,#15803d,#14532d)', borderRadius:'20px 20px 0 0', padding:'32px 24px 24px', textAlign:'center' }}>
              <img src="/CSS_Group.png" alt="CSS Group" style={{ height:38, objectFit:'contain', marginBottom:18, opacity:0.95 }} />
              <div style={{ width:64, height:64, borderRadius:'50%', background:'rgba(255,255,255,0.15)', border:'3px solid rgba(255,255,255,0.4)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <h2 style={{ margin:'0 0 6px', fontSize:22, fontWeight:900, color:'#fff', letterSpacing:'-0.02em' }}>Submission Received!</h2>
              <p style={{ margin:0, fontSize:14, color:'rgba(255,255,255,0.7)', fontWeight:500 }}>Thank you — your application is under review</p>
            </div>

            {/* ── Body ── */}
            <div style={{ background:'#fff', borderRadius:'0 0 20px 20px', padding:'24px 20px', display:'flex', flexDirection:'column', gap:16, boxShadow:'0 24px 60px rgba(0,0,0,0.4)' }}>

              {/* Ref number */}
              <div style={{ background:'#f0fdf4', border:'2px solid #86efac', borderRadius:14, padding:'14px 16px' }}>
                <p style={{ margin:'0 0 4px', fontSize:11, fontWeight:900, textTransform:'uppercase', letterSpacing:'0.15em', color:'#15803d' }}>Reference Number</p>
                <p style={{ margin:0, fontSize:22, fontWeight:900, color:'#14532d', letterSpacing:'0.12em', fontFamily:'monospace', wordBreak:'break-all' }}>{success.refId}</p>
                <p style={{ margin:'4px 0 0', fontSize:12, color:'#4ade80', fontWeight:600 }}>Keep this for your records</p>
              </div>

              {/* Company email */}
              <div style={{ background:'#eff6ff', border:'2px solid #bfdbfe', borderRadius:14, padding:'14px 16px' }}>
                <p style={{ margin:'0 0 4px', fontSize:11, fontWeight:900, textTransform:'uppercase', letterSpacing:'0.15em', color:'#1d4ed8' }}>Your CSS Group Company Email</p>
                <p style={{ margin:'0 0 6px', fontSize:16, fontWeight:900, color:'#1e40af', wordBreak:'break-all', fontFamily:'monospace' }}>{success.officialEmail}</p>
                <p style={{ margin:0, fontSize:12, color:'#3b82f6', fontWeight:600, lineHeight:1.5 }}>
                  The system has automatically generated this company email address for you based on your name. It will be activated once your account is approved.
                </p>
              </div>

              {/* Webmail guide — only shown if env vars are set */}
              {success.webmailUrl && (
                <div style={{ background:'#faf5ff', border:'2px solid #d8b4fe', borderRadius:14, padding:'14px 16px' }}>
                  <p style={{ margin:'0 0 10px', fontSize:11, fontWeight:900, textTransform:'uppercase', letterSpacing:'0.15em', color:'#7c3aed' }}>📬 Company Webmail Access Guide</p>
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {step(1, '#7c3aed', 'Go to the Company Webmail',
                      <p style={{ margin:0, fontSize:13, color:'#581c87', fontWeight:600, lineHeight:1.5 }}>
                        Open your browser and visit:<br/>
                        <span style={{ fontFamily:'monospace', fontSize:13, background:'#ede9fe', padding:'2px 6px', borderRadius:5, wordBreak:'break-all' }}>{success.webmailUrl}</span>
                      </p>
                    )}
                    {step(2, '#7c3aed', 'Login with your company email',
                      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                        <p style={{ margin:0, fontSize:13, color:'#581c87', fontWeight:600 }}>
                          <strong>Email / Username:</strong><br/>
                          <span style={{ fontFamily:'monospace', fontSize:13, background:'#ede9fe', padding:'2px 6px', borderRadius:5, wordBreak:'break-all' }}>{success.officialEmail}</span>
                        </p>
                        {success.webmailPassword && (
                          <p style={{ margin:0, fontSize:13, color:'#581c87', fontWeight:600 }}>
                            <strong>Default Password:</strong><br/>
                            <span style={{ fontFamily:'monospace', fontSize:13, background:'#ede9fe', padding:'2px 6px', borderRadius:5, letterSpacing:'0.05em' }}>{success.webmailPassword}</span>
                          </p>
                        )}
                        <p style={{ margin:'4px 0 0', fontSize:11, color:'#7c3aed', fontWeight:700 }}>⚠️ Change your password immediately after first login.</p>
                      </div>
                    )}
                    {step(3, '#7c3aed', 'Use it to receive company communications',
                      <p style={{ margin:0, fontSize:13, color:'#581c87', fontWeight:600, lineHeight:1.5 }}>
                        Your company inbox will receive requisition updates, approvals, and official CSS Group notifications. Check it regularly.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* What happens next */}
              <div style={{ background:'#fffbeb', border:'2px solid #fcd34d', borderRadius:14, padding:'14px 16px' }}>
                <p style={{ margin:'0 0 10px', fontSize:11, fontWeight:900, textTransform:'uppercase', letterSpacing:'0.15em', color:'#b45309' }}>⏳ What Happens Next</p>
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {step(1, '#d97706', 'Admin reviews your submission',
                    <p style={{ margin:0, fontSize:13, color:'#78350f', fontWeight:600, lineHeight:1.5 }}>
                      The administrator will verify your details and approve or reject your request.
                    </p>
                  )}
                  {step(2, '#d97706', 'You receive your access details',
                    <p style={{ margin:0, fontSize:13, color:'#78350f', fontWeight:600, lineHeight:1.5 }}>
                      Once approved, your <strong>RMS access code</strong>, Staff ID, and full login instructions will be delivered to you via:
                    </p>
                  )}
                  <div style={{ marginLeft:40, display:'flex', flexDirection:'column', gap:5 }}>
                    {[
                      { icon:'✉️', label:'Your personal email address' },
                      { icon:'🏢', label:'Your new company email inbox' },
                      { icon:'📱', label:'SMS to your registered phone number' },
                    ].map(({ icon, label }) => (
                      <div key={label} style={{ display:'flex', alignItems:'center', gap:8, background:'rgba(217,119,6,0.08)', borderRadius:8, padding:'7px 10px' }}>
                        <span style={{ fontSize:16 }}>{icon}</span>
                        <span style={{ fontSize:13, fontWeight:700, color:'#78350f' }}>{label}</span>
                      </div>
                    ))}
                  </div>
                  {step(3, '#d97706', 'Login to the RMS portal',
                    <p style={{ margin:0, fontSize:13, color:'#78350f', fontWeight:600, lineHeight:1.5 }}>
                      Use your Staff ID and the access code you receive to log in at <span style={{ fontFamily:'monospace', background:'#fef3c7', padding:'1px 5px', borderRadius:4 }}>cssgrouprms.com</span>.
                    </p>
                  )}
                </div>
              </div>

              <p style={{ margin:0, textAlign:'center', fontSize:12, color:'#9ca3af', fontWeight:600 }}>CSS Group of Companies · RMS Portal</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{GLOBAL_CSS}</style>

      {/*
        The body in index.css has background-attachment:fixed which prevents mobile Chrome
        from establishing the document scroll chain (classic Android Chrome bug). The main
        app avoids this via Layout's <main overflow-y-auto>. We do the same here: make
        THIS div the scroll container so body scroll is never needed.
        height:100dvh + overflow-y:auto = internal scroll, bypasses body entirely.
      */}
      <div ref={scrollRef} style={{
        height: '100dvh',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        background: 'linear-gradient(160deg,#052e16 0%,#14532d 35%,#1a6b3c 65%,#052e16 100%)',
        fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        position: 'relative',
      }}>

        {/* Background pattern — fixed to viewport, doesn't scroll with content */}
        <div style={{ position:'fixed', inset:0, opacity:0.04, backgroundImage:`url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`, pointerEvents:'none', zIndex:0 }} />

        <div style={{ position:'relative', zIndex:1, maxWidth:620, margin:'0 auto', padding:'28px 16px 60px', boxSizing:'border-box' }}>

          {/* ── Hero Header ── */}
          <div style={{ textAlign:'center', marginBottom:28 }}>
            <div style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', background:'rgba(255,255,255,0.12)', border:'2px solid rgba(255,255,255,0.2)', borderRadius:16, padding:'10px 18px', marginBottom:16 }}>
              <img src="/CSS_Group.png" alt="CSS Group" style={{ height:36, objectFit:'contain' }} />
            </div>
            <h1 className="ob-hero-h1" style={{ margin:'0 0 6px', fontSize:28, fontWeight:900, color:'#ffffff', letterSpacing:'-0.03em', textShadow:'0 2px 20px rgba(0,0,0,0.3)' }}>Staff Onboarding</h1>
            <p className="ob-hero-sub" style={{ margin:'0 0 8px', fontSize:13, fontWeight:800, color:'#86efac', textTransform:'uppercase', letterSpacing:'0.18em' }}>CSS Group RMS Portal</p>
            <p className="ob-hero-p" style={{ margin:0, fontSize:13, color:'rgba(255,255,255,0.65)', fontWeight:500, maxWidth:400, marginLeft:'auto', marginRight:'auto', lineHeight:1.6, padding:'0 8px' }}>
              Complete all required fields. Your submission will be reviewed before your account is created.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate style={{ display:'flex', flexDirection:'column', gap:16 }}>

            {/* ── Section 1: Personal Details ── */}
            <Section number="1" title="Personal Details">
              <Field label="Staff ID" required error={errors.staffId}
                hint={taken.staffId === false ? null : taken.staffId === true ? null : 'Exactly 5 digits starting with 1, 2, or 3 — e.g. 10001, 20938, 30001. Contact HR if unsure.'}
                fieldId="staffId">
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.staffId}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g, '');
                    setField('staffId', v);
                    setTaken(prev => ({ ...prev, staffId: null }));
                    liveCheck('staffId', v);
                  }}
                  placeholder="Enter your staff ID number"
                  style={inputStyle(errors.staffId || taken.staffId)}
                  maxLength={20}
                  onFocus={e => e.target.style.borderColor = (errors.staffId || taken.staffId) ? '#fca5a5' : '#16a34a'}
                  onBlur={e => e.target.style.borderColor = (errors.staffId || taken.staffId) ? '#fca5a5' : '#e5e7eb'}
                />
                {!errors.staffId && taken.staffId === true && (
                  <div style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10 }}>
                    <span style={{ fontSize:13 }}>❌</span>
                    <span style={{ fontSize:13, fontWeight:700, color:'#dc2626' }}>This Staff ID is already registered</span>
                  </div>
                )}
                {!errors.staffId && taken.staffId === false && form.staffId.length >= 1 && (
                  <div style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', background:'#f0fdf4', border:'1px solid #86efac', borderRadius:10 }}>
                    <span style={{ fontSize:13 }}>✅</span>
                    <span style={{ fontSize:13, fontWeight:700, color:'#15803d' }}>Staff ID is available</span>
                  </div>
                )}
              </Field>

              {/* KEY FIX: CSS class handles responsive collapse, not inline style */}
              <div className="ob-name-grid">
                <Field label="Surname" required error={errors.surname} fieldId="surname">
                  <input type="text" value={form.surname} onChange={e => setField('surname', toUpper(e.target.value))}
                    placeholder="SURNAME" style={inputStyle(errors.surname)} maxLength={60}
                    onFocus={e => e.target.style.borderColor = errors.surname ? '#fca5a5' : '#16a34a'}
                    onBlur={e => e.target.style.borderColor = errors.surname ? '#fca5a5' : '#e5e7eb'} />
                </Field>
                <Field label="First Name" required error={errors.firstName} fieldId="firstName">
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
              <Field label="Phone Number" required error={errors.phone}
                hint="e.g. 08012345678 or +2348012345678" fieldId="phone">
                <input type="tel" value={form.phone}
                  onChange={e => {
                    setField('phone', e.target.value);
                    setTaken(prev => ({ ...prev, phone: null }));
                    liveCheck('phone', e.target.value.replace(/\s+/g, ''));
                  }}
                  placeholder="08012345678" style={inputStyle(errors.phone || taken.phone)} maxLength={16}
                  onFocus={e => e.target.style.borderColor = (errors.phone || taken.phone) ? '#fca5a5' : '#16a34a'}
                  onBlur={e => e.target.style.borderColor = (errors.phone || taken.phone) ? '#fca5a5' : '#e5e7eb'} />
                {!errors.phone && taken.phone === true && (
                  <div style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10 }}>
                    <span style={{ fontSize:13 }}>❌</span>
                    <span style={{ fontSize:13, fontWeight:700, color:'#dc2626' }}>This phone number is already registered</span>
                  </div>
                )}
                {!errors.phone && taken.phone === false && isNigerianPhone(form.phone) && (
                  <div style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', background:'#f0fdf4', border:'1px solid #86efac', borderRadius:10 }}>
                    <span style={{ fontSize:13 }}>✅</span>
                    <span style={{ fontSize:13, fontWeight:700, color:'#15803d' }}>Phone number is available</span>
                  </div>
                )}
              </Field>

              <Field label="Personal Email Address" required error={errors.personalEmail}
                hint="Your personal/private email — NOT a CSS Group official email" fieldId="personalEmail">
                <input type="email" value={form.personalEmail}
                  onChange={e => {
                    const v = e.target.value.toLowerCase().replace(/\s+/g, '');
                    setField('personalEmail', v);
                    setTaken(prev => ({ ...prev, personalEmail: null }));
                    liveCheck('personalEmail', v.trim());
                  }}
                  placeholder="yourname@gmail.com"
                  style={inputStyle(errors.personalEmail || taken.personalEmail || isCompanyEmail(form.personalEmail))} maxLength={120}
                  onFocus={e => e.target.style.borderColor = (errors.personalEmail || taken.personalEmail || isCompanyEmail(form.personalEmail)) ? '#fca5a5' : '#16a34a'}
                  onBlur={e => e.target.style.borderColor = (errors.personalEmail || taken.personalEmail || isCompanyEmail(form.personalEmail)) ? '#fca5a5' : '#e5e7eb'} />
                {isCompanyEmail(form.personalEmail) && (
                  <div style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'10px 12px', background:'#fff7ed', border:'2px solid #fb923c', borderRadius:10 }}>
                    <span style={{ fontSize:16, flexShrink:0 }}>🚫</span>
                    <div>
                      <p style={{ margin:0, fontSize:13, fontWeight:800, color:'#c2410c' }}>Company email detected</p>
                      <p style={{ margin:'3px 0 0', fontSize:12, color:'#ea580c', lineHeight:1.5 }}>
                        Do not enter a CSS Group email here. The system automatically generates your official email once you are enrolled — enter your personal email (Gmail, Yahoo, etc.) instead.
                      </p>
                    </div>
                  </div>
                )}
                {!errors.personalEmail && !isCompanyEmail(form.personalEmail) && taken.personalEmail === true && (
                  <div style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10 }}>
                    <span style={{ fontSize:13 }}>❌</span>
                    <span style={{ fontSize:13, fontWeight:700, color:'#dc2626' }}>This email is already registered</span>
                  </div>
                )}
                {!errors.personalEmail && !isCompanyEmail(form.personalEmail) && taken.personalEmail === false && form.personalEmail.includes('@') && (
                  <div style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', background:'#f0fdf4', border:'1px solid #86efac', borderRadius:10 }}>
                    <span style={{ fontSize:13 }}>✅</span>
                    <span style={{ fontSize:13, fontWeight:700, color:'#15803d' }}>Email is available</span>
                  </div>
                )}
              </Field>

              {/* Official email preview */}
              {officialEmail && (
                <div style={{ background:'linear-gradient(135deg,#eff6ff,#dbeafe)', border:'2px solid #93c5fd', borderRadius:14, padding:'14px 16px' }}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
                    <div style={{ width:30, height:30, borderRadius:8, background:'#3b82f6', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:2 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>
                    </div>
                    <div style={{ minWidth:0 }}>
                      <p style={{ margin:'0 0 3px', fontSize:11, fontWeight:900, textTransform:'uppercase', letterSpacing:'0.12em', color:'#1d4ed8' }}>Official CSS Group Email (Auto-Generated)</p>
                      <p style={{ margin:'0 0 3px', fontSize:14, fontWeight:900, color:'#1e3a8a', wordBreak:'break-all' }}>{officialEmail}</p>
                      <p style={{ margin:0, fontSize:12, color:'#3b82f6', fontWeight:600 }}>Auto-generated. Will be activated once you are enrolled.</p>
                    </div>
                  </div>
                </div>
              )}
            </Section>

            {/* ── Section 3: Department & Role ── */}
            <Section number="3" title="Department & Role">

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
                    {departments.filter(d => !/^super\s*admin$/i.test(d.name)).map(d => (
                      <option key={d.id} value={d.id}>{d.name.toUpperCase()}</option>
                    ))}
                  </select>
                  {/* Not listed toggle */}
                  <button
                    type="button"
                    onClick={handleNotListed}
                    style={{ marginTop:10, display:'flex', alignItems:'center', gap:8, padding:'12px 14px', borderRadius:12, border:'2px dashed #d1fae5', background:'#f0fdf4', cursor:'pointer', width:'100%', boxSizing:'border-box' }}
                  >
                    <svg style={{ flexShrink:0 }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
                    <span className="ob-notlisted-text" style={{ fontSize:13, fontWeight:800, color:'#15803d', textAlign:'left', flex:1, lineHeight:1.4 }}>I can't find my department — tap here to enter it manually</span>
                    <svg style={{ flexShrink:0 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                  </button>
                </Field>
              ) : (
                <Field label="Custom Department Name" required error={errors.deptId}
                  hint="Your request will need admin approval before your enrollment can proceed">
                  <button
                    type="button"
                    onClick={handleBackToDepts}
                    style={{ marginBottom:8, display:'inline-flex', alignItems:'center', gap:6, padding:'10px 14px', borderRadius:10, border:'2px solid #d1fae5', background:'#f0fdf4', cursor:'pointer' }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
                    <span style={{ fontSize:13, fontWeight:800, color:'#15803d' }}>Back to department list</span>
                  </button>
                  <input
                    type="text"
                    value={form.customDeptName}
                    onChange={e => handleCustomDeptChange(e.target.value)}
                    placeholder="E.G. POULTRY LAYERS PEN 1"
                    style={inputStyle(errors.deptId || customDeptDuplicate)}
                    maxLength={100}
                    autoFocus
                    onFocus={e => e.target.style.borderColor = (errors.deptId || customDeptDuplicate) ? '#fca5a5' : '#16a34a'}
                    onBlur={e => e.target.style.borderColor = (errors.deptId || customDeptDuplicate) ? '#fca5a5' : '#e5e7eb'}
                  />
                  {customDeptDuplicate ? (
                    <div style={{ display:'flex', flexDirection:'column', gap:8, padding:'12px 14px', background:'#fef2f2', border:'2px solid #fca5a5', borderRadius:12, marginTop:4 }}>
                      <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
                        <span style={{ fontSize:16, flexShrink:0 }}>⚠️</span>
                        <div>
                          <p style={{ margin:0, fontSize:13, fontWeight:900, color:'#dc2626' }}>This department already exists!</p>
                          <p style={{ margin:'3px 0 0', fontSize:12, fontWeight:600, color:'#b91c1c', lineHeight:1.5 }}>
                            <strong>{customDeptDuplicate.name.toUpperCase()}</strong> is already in the system. Please go back and select it from the list — do not create a duplicate.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => switchToExistingDept(customDeptDuplicate)}
                        style={{ padding:'10px 14px', borderRadius:10, border:'none', background:'#16a34a', color:'#fff', fontSize:13, fontWeight:900, cursor:'pointer', textAlign:'center' }}
                      >
                        Select {customDeptDuplicate.name.toUpperCase()} from the list
                      </button>
                    </div>
                  ) : (
                    <div style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'10px 12px', background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:10, marginTop:4 }}>
                      <svg style={{ flexShrink:0, marginTop:1 }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      <span style={{ fontSize:12, fontWeight:700, color:'#92400e', lineHeight:1.5 }}>This department needs admin approval first before your enrollment can proceed.</span>
                    </div>
                  )}
                </Field>
              )}

              {/* Role selector */}
              <Field label="Your Role" required error={errors.role}>
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {[
                    { value:'HEAD',      label:'Head of Unit / Department', desc:'Primary account holder — leads the department' },
                    { value:'ASSISTANT', label:'Assistant',                  desc:'Second-in-command with delegated privileges' },
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
                          width:'100%', textAlign:'left', padding:'14px 14px', borderRadius:14,
                          border: `2px solid ${selected ? '#16a34a' : taken ? '#f3f4f6' : '#e5e7eb'}`,
                          background: selected ? 'linear-gradient(135deg,#f0fdf4,#dcfce7)' : taken ? '#f9fafb' : '#ffffff',
                          cursor: taken ? 'not-allowed' : 'pointer',
                          display:'flex', alignItems:'flex-start', gap:12,
                          opacity: taken ? 0.55 : 1,
                          transition:'border-color 0.15s',
                          boxSizing:'border-box',
                          boxShadow: selected ? '0 4px 16px rgba(22,163,74,0.18)' : 'none',
                          minHeight: 56,
                        }}
                      >
                        <div style={{ width:20, height:20, borderRadius:'50%', border:`2.5px solid ${selected ? '#16a34a' : '#d1d5db'}`, background: selected ? '#16a34a' : '#fff', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:2, transition:'all 0.15s' }}>
                          {selected && <div style={{ width:8, height:8, borderRadius:'50%', background:'#fff' }} />}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                            <span style={{ fontSize:14, fontWeight:900, color: selected ? '#14532d' : taken ? '#9ca3af' : '#111827' }}>{opt.label}</span>
                            {taken && (
                              <span style={{ fontSize:11, fontWeight:800, color:'#d97706', background:'#fef3c7', padding:'2px 8px', borderRadius:20, border:'1px solid #fcd34d', whiteSpace:'nowrap' }}>
                                {roleChecking ? '…' : 'Already claimed'}
                              </span>
                            )}
                          </div>
                          <p style={{ margin:'3px 0 0', fontSize:12, color: selected ? '#15803d' : '#6b7280', fontWeight:600, lineHeight:1.4 }}>{opt.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {roleChecking && (
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:8, fontSize:13, color:'#6b7280', fontWeight:600 }}>
                    <div style={{ width:14, height:14, borderRadius:'50%', border:'2px solid #d1d5db', borderTopColor:'#16a34a', animation:'ob-spin 0.8s linear infinite', flexShrink:0 }} />
                    Checking role availability…
                  </div>
                )}
              </Field>
            </Section>

            {/* ── Notice ── */}
            <div style={{ background:'rgba(255,255,255,0.08)', border:'2px solid rgba(255,255,255,0.15)', borderRadius:16, padding:'16px 18px' }}>
              <p style={{ margin:'0 0 10px', fontSize:12, fontWeight:900, color:'#86efac', textTransform:'uppercase', letterSpacing:'0.12em' }}>📌 Important Notice</p>
              <ul style={{ margin:0, padding:'0 0 0 16px', display:'flex', flexDirection:'column', gap:6 }}>
                {[
                  'All submissions are reviewed by the administrator before any account is created.',
                  'Your login credentials will be sent to your personal email and phone once approved.',
                  'Submitting false or duplicate information may result in rejection.',
                ].map((item, i) => (
                  <li key={i} style={{ fontSize:13, color:'rgba(255,255,255,0.8)', fontWeight:600, lineHeight:1.5 }}>{item}</li>
                ))}
              </ul>
            </div>

            {/* Server error */}
            {serverError && (
              <div style={{ background:'#fef2f2', border:'2px solid #fca5a5', borderRadius:14, padding:'14px 16px', display:'flex', alignItems:'flex-start', gap:10 }}>
                <span style={{ fontSize:18, flexShrink:0 }}>⚠️</span>
                <p style={{ margin:0, fontSize:14, fontWeight:700, color:'#dc2626', lineHeight:1.4 }}>{serverError}</p>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={submitting}
              className="ob-submit-btn"
              style={{
                width:'100%', padding:'17px 20px', borderRadius:16,
                background: submitting ? '#6b7280' : 'linear-gradient(135deg,#16a34a,#15803d)',
                border:'none', color:'#fff', fontSize:16, fontWeight:900,
                letterSpacing:'0.04em', cursor: submitting ? 'not-allowed' : 'pointer',
                boxShadow:'0 8px 32px rgba(22,163,74,0.45)',
                display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                fontFamily:'inherit', boxSizing:'border-box', minHeight:54,
              }}
            >
              {submitting ? (
                <>
                  <div style={{ width:20, height:20, borderRadius:'50%', border:'3px solid rgba(255,255,255,0.3)', borderTopColor:'#fff', animation:'ob-spin 0.8s linear infinite', flexShrink:0 }} />
                  Submitting your application…
                </>
              ) : (
                <>
                  <svg style={{ flexShrink:0 }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  Submit Onboarding Form
                </>
              )}
            </button>

            <p style={{ textAlign:'center', fontSize:11, color:'rgba(255,255,255,0.4)', fontWeight:600, margin:0, padding:'0 8px' }}>
              CSS Group of Companies · Requisition Management System · Staff Onboarding Portal
            </p>
          </form>
        </div>
      </div>
    </>
  );
}
