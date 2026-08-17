import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Lock, ArrowRight, CheckCircle2, Building2, Eye, EyeOff, Smartphone, HelpCircle, X, PhoneCall } from 'lucide-react';
import { getDepartments } from '../lib/store';
import { toast } from 'react-hot-toast';

const LoginPagePremium = () => {
  const [selectedDept, setSelectedDept] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [departments, setDepartments] = useState([]);
  const [showAccessCode, setShowAccessCode] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForgotCode, setShowForgotCode] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [deptActivated, setDeptActivated] = useState(null); // null=unknown, true=activated, false=first-time
  const { deptLogin } = useAuth();

  useEffect(() => {
    getDepartments().then(setDepartments);
    // Load premium fonts only when this screen is active
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Gagalin&family=Alice&family=Chewy&display=swap';
    document.head.appendChild(link);

    return () => { document.head.removeChild(link); };
  }, []);

  const handleDeptChange = async (name) => {
    setSelectedDept(name);
    setDeptActivated(null);
    if (!name || name === 'Super Admin') {
      setDeptActivated(name === 'Super Admin' ? true : null);
      return;
    }
    try {
      const res = await fetch(`/api/departments/login-status?name=${encodeURIComponent(name)}`);
      if (res.ok) {
        const data = await res.json();
        setDeptActivated(data.activated);
      }
    } catch (_) { /* network error — leave as null */ }
  };


  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      if (!selectedDept) throw new Error('Please select a department');
      await deptLogin(selectedDept, accessCode, mfaCode);
    } catch (err) {
      const status = err.response?.status;
      let msg;
      if (status === 401) msg = err.response?.data?.error || 'Incorrect password. Please try again.';
      else if (status === 429) msg = 'Too many attempts. Please wait a moment and try again.';
      else if (status >= 500) msg = 'The server is temporarily unavailable. Please try again in a few seconds.';
      else if (!navigator.onLine || err.code === 'ERR_NETWORK' || err.message === 'Network Error')
        msg = 'No internet connection. Please check your network and try again.';
      else msg = err.response?.data?.error || err.message || 'Authentication failed. Please try again.';
      setError(msg);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: '#8bc89b' }}>

      {/* ── Background: poster shows instantly, video fades in over it ── */}
      <div className="absolute inset-0 z-0">
        <img
          src="/images/login-poster.webp"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: videoReady ? 0 : 1, transition: 'opacity 1.5s ease' }}
        />
        <video
          autoPlay muted loop playsInline preload="auto"
          onCanPlayThrough={() => setVideoReady(true)}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: videoReady ? 1 : 0, transition: 'opacity 1.5s ease' }}
        >
          <source src="/videos/login-bg.webm" type="video/webm" />
          <source src="/videos/login-bg.mp4" type="video/mp4" />
        </video>
      </div>

      {/* ── Page Layout ── */}
      <div className="relative z-10 min-h-screen flex flex-col lg:flex-row">

        {/* ══════════════════════════════════════
            LEFT BRANDING — Desktop only
            Text floats directly on video — no panel
        ══════════════════════════════════════ */}
        <div className="hidden lg:flex lg:w-[48%] flex-col items-center text-center pt-16 px-10">

          {/* Logo — no box, just the image */}
          <img
            src="/CSS_Group.png"
            alt="CSS Group"
            className="w-28 h-[4.5rem] object-cover object-center rounded-2xl shadow-lg mb-6"
          />

          {/* "CSS GROUP OF COMPANIES" — Gagalin font */}
          <h1 style={{
            fontFamily: "'Gagalin', sans-serif",
            color: '#0a3d0a',
            fontSize: '3.2rem',
            lineHeight: 1.1,
            letterSpacing: '0.01em',
            textShadow: '0 2px 8px rgba(255,255,255,0.65)',
          }}>
            CSS GROUP OF COMPANIES
          </h1>

          {/* "Requisition Management System" — Alice font */}
          <p style={{
            fontFamily: "'Alice', serif",
            color: '#0d4a0d',
            fontWeight: 400,
            fontSize: '2.1rem',
            marginTop: '0.6rem',
            lineHeight: 1.25,
            letterSpacing: '-0.01em',
            textShadow: '0 2px 10px rgba(255,255,255,0.7)',
          }}>
            Requisition Management System
          </p>

          {/* Description + bullets — Chewy font */}
          <p style={{
            fontFamily: "'Chewy', cursive",
            color: '#1a3d1a',
            fontSize: '1.35rem',
            lineHeight: 1.65,
            marginTop: '1rem',
            maxWidth: '24rem',
            textShadow: '0 1px 6px rgba(255,255,255,0.6)',
          }}>
            Streamlined enterprise workflow for requisitions, memos, and procurement across all CSS Group departments.
          </p>

          <div style={{ marginTop: '1rem' }} className="space-y-2">
            {[
              'End-to-end approval tracking',
              'Offline draft capability',
              'Multi-department oversight',
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-center gap-2.5">
                <CheckCircle2 size={18} style={{ color: '#0a5c0a', flexShrink: 0 }} />
                <span style={{
                  fontFamily: "'Chewy', cursive",
                  color: '#1a3d1a',
                  fontSize: '1.25rem',
                  textShadow: '0 1px 4px rgba(255,255,255,0.6)',
                }}>
                  {item}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════
            RIGHT FORM PANEL
        ══════════════════════════════════════ */}
        <div className="flex-1 flex items-center justify-center p-5 lg:p-10 min-h-screen lg:min-h-0">
          <div className="w-full max-w-sm">

            <div className="bg-white rounded-[1.75rem] shadow-2xl overflow-hidden" style={{ boxShadow: '0 25px 60px rgba(0,0,0,0.22)' }}>

              {/* Mobile header bar — same logo style as standard login mobile header */}
              <div className="lg:hidden bg-primary px-6 py-5 flex items-center gap-4">
                <div className="w-20 h-11 rounded-xl overflow-hidden shrink-0 bg-white/10 p-0.5">
                  <img src="/CSS_Group.png" alt="CSS Group" className="w-full h-full object-cover object-center" />
                </div>
                <div>
                  <h1 className="text-base font-black text-white tracking-[0.1em] italic uppercase">RMS</h1>
                  <p className="text-[10px] text-white/80 uppercase tracking-[0.3em] font-bold leading-none">Portal</p>
                </div>
              </div>

              {/* Form */}
              <div className="p-7 space-y-5">
                <div className="space-y-0.5">
                  <p className="text-sm text-muted-foreground font-medium">Welcome back</p>
                  <p className="text-[11px] text-muted-foreground/70">Authenticate to access the RMS portal</p>
                </div>

                <div className="space-y-1 text-center">
                  <h2 className="text-2xl font-bold text-foreground tracking-tight">Sign In to Dashboard</h2>
                  <p className="text-sm text-muted-foreground">Select your department and enter your password</p>
                </div>

                {error && (
                  <div className="bg-destructive/10 border border-destructive/20 text-destructive text-xs px-4 py-3 rounded-xl flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Department / Unit</label>
                    <div className="relative group">
                      <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 group-focus-within:text-primary transition-colors" size={15} />
                      <select
                        value={selectedDept} onChange={(e) => handleDeptChange(e.target.value)}
                        disabled={isSubmitting} required
                        className="w-full bg-white border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-50 appearance-none cursor-pointer"
                      >
                        <option value="">Choose your unit...</option>
                        {departments.map(dept => <option key={dept.id} value={dept.name}>{dept.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      {!selectedDept || deptActivated === null
                        ? 'PASSWORD / ACCESS CODE'
                        : deptActivated
                          ? 'PASSWORD'
                          : 'ACCESS CODE'}
                    </label>
                    <div className="relative group">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 group-focus-within:text-primary transition-colors" size={15} />
                      <input
                        type={showAccessCode ? 'text' : 'password'}
                        value={accessCode} onChange={(e) => setAccessCode(e.target.value)}
                        disabled={isSubmitting} required placeholder="••••••••"
                        className="w-full bg-white border border-border rounded-xl pl-10 pr-12 py-3 text-sm text-foreground placeholder-muted-foreground/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-50 font-mono tracking-widest"
                      />
                      <button type="button" onClick={() => setShowAccessCode(v => !v)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-primary transition-colors">
                        {showAccessCode ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>

                  {selectedDept === 'Super Admin' && (
                    <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-300">
                      <label className="text-[10px] font-bold text-primary uppercase tracking-wider flex items-center justify-between">
                        <span>MFA Security PIN</span>
                        <span className="text-[9px] lowercase opacity-60">Required for Admin</span>
                      </label>
                      <div className="relative group">
                        <Smartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-primary/50 group-focus-within:text-primary transition-colors" size={15} />
                        <input type="text" maxLength={6} value={mfaCode}
                          onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                          disabled={isSubmitting} placeholder="000000" required
                          className="w-full bg-primary/5 border border-primary/20 rounded-xl pl-10 pr-4 py-3 text-sm text-foreground placeholder-primary/30 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-50 font-mono tracking-[0.5em] text-center"
                        />
                      </div>
                    </div>
                  )}

                  <button type="submit" disabled={isSubmitting}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3.5 px-4 rounded-xl transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 text-sm">
                    <span>{isSubmitting ? 'Authenticating…' : 'Enter RMS Portal'}</span>
                    {!isSubmitting && <ArrowRight size={16} />}
                  </button>

                  <div className="text-center">
                    <button type="button" onClick={() => setShowForgotCode(true)}
                      className="text-[11px] text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1.5 group">
                      <HelpCircle size={12} className="group-hover:scale-110 transition-transform" />
                      Forgot your password?
                    </button>
                  </div>
                </form>

                <p className="text-center text-[10px] text-muted-foreground/60 font-medium uppercase tracking-[0.15em]">
                  © 2026 CSS Group of Companies
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Forgot Code Modal ── */}
      {showForgotCode && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 animate-in zoom-in-95 duration-200 relative">
            <button onClick={() => setShowForgotCode(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all">
              <X size={16} />
            </button>
            <div className="flex flex-col items-center text-center space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <PhoneCall size={28} className="text-primary" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-bold text-foreground">Need Help With Your Code?</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">No worries — it happens to the best of us.</p>
              </div>
              <div className="w-full bg-primary/5 border border-primary/15 rounded-2xl p-5 space-y-3 text-left">
                <p className="text-sm text-foreground font-semibold">Please reach out to 080********:</p>
                <div className="space-y-2">
                  {[['1','Your System Administrator — they can reset your password immediately from the Department Manager.'],
                    ['2','The ICT Department — they will verify your identity and issue a new password promptly.']
                  ].map(([num, text]) => (
                    <div key={num} className="flex items-start gap-2.5">
                      <div className="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[9px] font-black text-primary">{num}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={() => setShowForgotCode(false)}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all active:scale-[0.98]">
                Got it, thank you
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default LoginPagePremium;
