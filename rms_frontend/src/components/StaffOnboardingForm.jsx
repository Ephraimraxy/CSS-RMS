import React, { useState, useEffect, useCallback } from 'react';

const API = '/api/public/onboarding';

// ── Helpers ────────────────────────────────────────────────────────────────
const capitalize = (s) => (s || '').toUpperCase();
const makeOfficialEmail = (firstName, surname) => {
  const clean = s => (s || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  const f = clean(firstName); const l = clean(surname);
  return f && l ? `${f}.${l}@cssgroup.com.ng` : '';
};
const isNigerianPhone = (p) => /^(\+234|0)[789]\d{9}$/.test((p || '').replace(/\s+/g, ''));

// ── Input Field ────────────────────────────────────────────────────────────
function Field({ label, required, error, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-black uppercase tracking-widest text-gray-500">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-[11px] text-red-500 font-semibold flex items-center gap-1"><span>⚠</span>{error}</p>}
      {hint && !error && <p className="text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

const inputCls = (err) =>
  `w-full px-4 py-3 rounded-xl border text-sm font-semibold bg-white text-gray-900 transition-all outline-none focus:ring-2 focus:ring-green-500/30 ${
    err ? 'border-red-400 bg-red-50/50' : 'border-gray-200 focus:border-green-500'
  }`;

// ── Main Component ─────────────────────────────────────────────────────────
export default function StaffOnboardingForm() {
  const [departments, setDepartments] = useState([]);
  const [deptLoading, setDeptLoading] = useState(true);
  const [roleAvail, setRoleAvail] = useState({ headTaken: false, assistantTaken: false });
  const [roleChecking, setRoleChecking] = useState(false);

  const [form, setForm] = useState({
    staffId: '', surname: '', firstName: '', middleName: '',
    phone: '', personalEmail: '',
    deptId: '', customDeptName: '',
    role: '',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null); // { refId, officialEmail }
  const [serverError, setServerError] = useState('');

  // Load departments
  useEffect(() => {
    fetch(`${API}/departments`)
      .then(r => r.json())
      .then(d => setDepartments(Array.isArray(d) ? d : []))
      .catch(() => setDepartments([]))
      .finally(() => setDeptLoading(false));
  }, []);

  // Check role availability when department changes
  const checkRoles = useCallback(async (deptId) => {
    if (!deptId) { setRoleAvail({ headTaken: false, assistantTaken: false }); return; }
    setRoleChecking(true);
    try {
      const r = await fetch(`${API}/dept-roles?deptId=${deptId}`);
      const d = await r.json();
      setRoleAvail(d);
      // Auto-clear role if it became unavailable
      setForm(prev => {
        if ((prev.role === 'HEAD' && d.headTaken) || (prev.role === 'ASSISTANT' && d.assistantTaken)) {
          return { ...prev, role: '' };
        }
        return prev;
      });
    } catch { setRoleAvail({ headTaken: false, assistantTaken: false }); }
    finally { setRoleChecking(false); }
  }, []);

  const set = (field, value) => {
    setErrors(prev => ({ ...prev, [field]: '' }));
    setServerError('');
    setForm(prev => ({ ...prev, [field]: value }));
    if (field === 'deptId') checkRoles(value);
  };

  const officialEmail = makeOfficialEmail(form.firstName, form.surname);

  // ── Validate ─────────────────────────────────────────────────────────────
  const validate = () => {
    const e = {};
    if (!form.staffId.trim()) e.staffId = 'Staff ID is required.';
    else if (!/^\d+$/.test(form.staffId.trim())) e.staffId = 'Staff ID must be numbers only.';
    if (!form.surname.trim()) e.surname = 'Surname is required.';
    if (!form.firstName.trim()) e.firstName = 'First name is required.';
    if (!form.phone.trim()) e.phone = 'Phone number is required.';
    else if (!isNigerianPhone(form.phone)) e.phone = 'Enter a valid Nigerian number (e.g. 08012345678 or +2348012345678).';
    if (!form.personalEmail.trim()) e.personalEmail = 'Personal email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.personalEmail.trim())) e.personalEmail = 'Enter a valid email address.';
    else if (/@cssgroup\./i.test(form.personalEmail)) e.personalEmail = 'Use your personal email — not your CSS Group official email.';
    if (!form.deptId && !form.customDeptName.trim()) e.deptId = 'Select your department or enter it below.';
    if (!form.role) e.role = 'Select your role.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setServerError('');
    try {
      const payload = {
        staffId:       form.staffId.trim(),
        surname:       form.surname.trim(),
        firstName:     form.firstName.trim(),
        middleName:    form.middleName.trim() || null,
        phone:         form.phone.trim(),
        personalEmail: form.personalEmail.trim().toLowerCase(),
        deptId:        form.deptId || null,
        customDeptName: form.customDeptName.trim() || null,
        role:          form.role,
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

  // ── Success Screen ────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#f0f7f0] via-white to-[#e8f5e8] flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-3xl shadow-xl border border-green-100 overflow-hidden">
            <div className="bg-gradient-to-r from-[#1a7a3c] to-[#0f5124] p-8 text-center">
              <img src="/CSS_Group.png" alt="CSS Group" className="h-10 object-contain mx-auto mb-4 opacity-90" />
              <div className="w-16 h-16 mx-auto bg-white/20 rounded-full flex items-center justify-center mb-3">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <h2 className="text-xl font-black text-white">Submission Received!</h2>
            </div>
            <div className="p-8 space-y-5 text-center">
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-left space-y-2">
                <p className="text-xs font-black uppercase tracking-widest text-green-700">Reference</p>
                <p className="text-2xl font-black text-green-800 tracking-widest">{success.refId}</p>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                A confirmation has been sent to your personal email address. Please check your inbox.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-left space-y-1">
                <p className="text-xs font-black uppercase tracking-widest text-blue-700">Your Official CSS Group Email</p>
                <p className="text-sm font-black text-blue-800 break-all">{success.officialEmail}</p>
                <p className="text-[11px] text-blue-500">Your login credentials will be sent to your personal email once approved.</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-left">
                <p className="text-xs font-black uppercase tracking-widest text-amber-700 mb-1">What Happens Next</p>
                <p className="text-xs text-amber-700 leading-relaxed">The administrator will review your submission. Once approved, you'll receive your RMS portal access code and login instructions via your personal email and phone number.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f0f7f0] via-white to-[#e8f5e8] py-8 px-4">
      <div className="max-w-xl mx-auto space-y-6">

        {/* Header */}
        <div className="text-center space-y-3">
          <img src="/CSS_Group.png" alt="CSS Group" className="h-12 object-contain mx-auto" />
          <div>
            <h1 className="text-xl font-black text-gray-900 tracking-tight">CSS Group RMS</h1>
            <p className="text-xs font-bold uppercase tracking-widest text-green-700 mt-1">Staff Onboarding Form</p>
          </div>
          <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">
            Complete all required fields. Your submission will be reviewed by the system administrator before your account is created.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">

          {/* ── Section: Personal Details ── */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 bg-gray-50/50">
              <h2 className="text-xs font-black uppercase tracking-widest text-gray-600 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-green-600 text-white text-[10px] font-black flex items-center justify-center">1</span>
                Personal Details
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <Field label="Staff ID" required error={errors.staffId} hint="Numbers only — e.g. 12345">
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.staffId}
                  onChange={e => set('staffId', e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter your staff ID"
                  className={inputCls(errors.staffId)}
                  maxLength={20}
                />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Surname" required error={errors.surname}>
                  <input
                    type="text"
                    value={form.surname}
                    onChange={e => set('surname', capitalize(e.target.value))}
                    placeholder="SURNAME"
                    className={inputCls(errors.surname)}
                    maxLength={60}
                  />
                </Field>
                <Field label="First Name" required error={errors.firstName}>
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={e => set('firstName', capitalize(e.target.value))}
                    placeholder="FIRST NAME"
                    className={inputCls(errors.firstName)}
                    maxLength={60}
                  />
                </Field>
              </div>

              <Field label="Middle Name" error={errors.middleName} hint="Optional">
                <input
                  type="text"
                  value={form.middleName}
                  onChange={e => set('middleName', capitalize(e.target.value))}
                  placeholder="MIDDLE NAME (OPTIONAL)"
                  className={inputCls(errors.middleName)}
                  maxLength={60}
                />
              </Field>
            </div>
          </div>

          {/* ── Section: Contact Details ── */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 bg-gray-50/50">
              <h2 className="text-xs font-black uppercase tracking-widest text-gray-600 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-green-600 text-white text-[10px] font-black flex items-center justify-center">2</span>
                Contact Details
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <Field label="Phone Number" required error={errors.phone} hint="Nigerian number — e.g. 08012345678 or +2348012345678">
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => set('phone', e.target.value)}
                  placeholder="08012345678"
                  className={inputCls(errors.phone)}
                  maxLength={16}
                />
              </Field>

              <Field label="Personal Email Address" required error={errors.personalEmail} hint="Use your personal email — not a CSS Group email">
                <input
                  type="email"
                  value={form.personalEmail}
                  onChange={e => set('personalEmail', e.target.value.toLowerCase())}
                  placeholder="yourname@gmail.com"
                  className={inputCls(errors.personalEmail)}
                  maxLength={120}
                />
              </Field>

              {/* Official email preview */}
              {officialEmail && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Your Official CSS Group Email (Auto-Generated)</p>
                  <p className="text-sm font-black text-blue-800 break-all">{officialEmail}</p>
                  <p className="text-[11px] text-blue-500">This will be your official company email address. It is auto-generated and cannot be changed.</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Section: Department & Role ── */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 bg-gray-50/50">
              <h2 className="text-xs font-black uppercase tracking-widest text-gray-600 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-green-600 text-white text-[10px] font-black flex items-center justify-center">3</span>
                Department &amp; Role
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <Field label="Department" required error={errors.deptId}
                hint={form.deptId === 'custom' ? 'Type your department name below' : undefined}>
                <select
                  value={form.deptId}
                  onChange={e => {
                    set('deptId', e.target.value === 'custom' ? '' : e.target.value);
                    if (e.target.value === 'custom') {
                      setForm(prev => ({ ...prev, deptId: '' }));
                      setErrors(prev => ({ ...prev, deptId: '' }));
                    }
                  }}
                  className={`${inputCls(errors.deptId)} appearance-none cursor-pointer`}
                  disabled={deptLoading}
                >
                  <option value="">{deptLoading ? 'Loading departments…' : '— Select your department —'}</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                  <option value="custom">⊕ My department is not listed</option>
                </select>
              </Field>

              {/* Custom department name input */}
              {(form.deptId === '' && form.customDeptName !== undefined) && !departments.find(d => String(d.id) === form.deptId) && (
                <div>
                  {/* Show custom field only when "not listed" was picked — detect by no deptId selected */}
                </div>
              )}

              {/* Always show custom dept field when no dept is selected AND user typed something, or 'custom' was selected */}
              {!form.deptId && (
                <Field label="Department Name (Custom Request)" error={errors.customDeptName}
                  hint="Your request will be reviewed by admin before your submission proceeds">
                  <input
                    type="text"
                    value={form.customDeptName}
                    onChange={e => set('customDeptName', e.target.value.toUpperCase())}
                    placeholder="E.G. POULTRY LAYERS PEN 1"
                    className={inputCls(errors.customDeptName)}
                    maxLength={100}
                  />
                </Field>
              )}

              {/* Role selector */}
              <Field label="Your Role" required error={errors.role}>
                <div className="space-y-2.5">
                  {[
                    { value: 'HEAD',      label: 'Head of Unit / Department', desc: 'Primary account holder for the department' },
                    { value: 'ASSISTANT', label: 'Assistant',                  desc: 'Secondary delegate with assigned privileges' },
                    { value: 'MEMBER',    label: 'Member',                     desc: 'Standard staff member of the department' },
                  ].map(opt => {
                    const taken = (opt.value === 'HEAD' && form.deptId && roleAvail.headTaken) ||
                                  (opt.value === 'ASSISTANT' && form.deptId && roleAvail.assistantTaken);
                    const selected = form.role === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={taken}
                        onClick={() => !taken && set('role', opt.value)}
                        className={`w-full text-left px-4 py-3 rounded-2xl border-2 transition-all flex items-start gap-3 ${
                          taken
                            ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                            : selected
                            ? 'border-green-500 bg-green-50'
                            : 'border-gray-200 bg-white hover:border-green-300 hover:bg-green-50/50 cursor-pointer'
                        }`}
                      >
                        <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                          selected ? 'border-green-500 bg-green-500' : 'border-gray-300'
                        }`}>
                          {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-black ${selected ? 'text-green-800' : taken ? 'text-gray-400' : 'text-gray-800'}`}>
                            {opt.label}
                            {taken && <span className="ml-2 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                              {roleChecking ? '…' : 'Already claimed'}
                            </span>}
                          </p>
                          <p className={`text-[11px] mt-0.5 ${selected ? 'text-green-600' : 'text-gray-400'}`}>{opt.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {roleChecking && (
                  <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1">
                    <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-green-500 rounded-full animate-spin" />
                    Checking role availability…
                  </p>
                )}
              </Field>
            </div>
          </div>

          {/* ── Important Notice ── */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-1.5">
            <p className="text-xs font-black uppercase tracking-widest text-amber-700">Important</p>
            <ul className="text-xs text-amber-700 leading-relaxed space-y-1 list-disc list-inside">
              <li>All submissions are reviewed by the system administrator before any account is created.</li>
              <li>Once approved, your access credentials will be sent to your personal email and phone.</li>
              <li>Submitting false information may result in rejection and disciplinary action.</li>
            </ul>
          </div>

          {/* Server error */}
          {serverError && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
              <p className="text-sm text-red-700 font-semibold">⚠ {serverError}</p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-[#1a7a3c] to-[#0f5124] text-white font-black text-sm tracking-wide shadow-lg shadow-green-900/20 hover:shadow-green-900/30 hover:from-[#1d8843] hover:to-[#115929] transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                Submit Onboarding Form
              </>
            )}
          </button>

          <p className="text-center text-[11px] text-gray-400">
            CSS Group of Companies &bull; Requisition Management System &bull; Staff Onboarding
          </p>
        </form>
      </div>
    </div>
  );
}
