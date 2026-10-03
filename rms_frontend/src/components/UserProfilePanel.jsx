import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { authAPI, reqAPI } from '../lib/api';
import { toast } from 'react-hot-toast';
import {
  X, User, Mail, Shield, Calendar, Clock, Lock,
  Eye, EyeOff, Save, KeyRound, Building2, CheckCircle2,
  AlertTriangle, ExternalLink, Loader2, RefreshCcw, Fingerprint
} from 'lucide-react';
import { isNative, bioAvailable, hasBioDept, enrollBiometric, removeBiometric } from '../lib/biometric';

// Deterministic colour from user name/dept string
const avatarColor = (str = '') => {
  const palette = [
    'from-primary to-primary/60',
    'from-emerald-500 to-emerald-700',
    'from-amber-500 to-amber-700',
    'from-violet-500 to-violet-700',
    'from-rose-500 to-rose-700',
    'from-sky-500 to-sky-700',
  ];
  let hash = 0;
  for (const c of str) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return palette[Math.abs(hash) % palette.length];
};

const initials = (name = '') =>
  name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

// ── Section wrapper ──────────────────────────────────────────────────────────
const Section = ({ title, children }) => (
  <div className="space-y-3">
    <p className="text-[9px] font-black text-muted-foreground/50 uppercase tracking-[0.25em]">{title}</p>
    {children}
  </div>
);

// ── Read-only field ──────────────────────────────────────────────────────────
const ReadField = ({ icon: Icon, label, value }) => (
  <div className="flex items-center gap-3 px-3 py-2.5 bg-muted/20 rounded-xl border border-border/30">
    <Icon size={14} className="text-muted-foreground shrink-0" />
    <div className="flex-1 min-w-0">
      <p className="text-[9px] font-black text-muted-foreground/50 uppercase tracking-widest">{label}</p>
      <p className="text-[12px] font-bold text-foreground truncate">{value || '—'}</p>
    </div>
  </div>
);

// ── Editable field ───────────────────────────────────────────────────────────
const EditField = ({ icon: Icon, label, value, onChange, type = 'text', disabled }) => (
  <div className="flex items-center gap-3 px-3 py-2 bg-white border border-border/50 rounded-xl focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
    <Icon size={14} className="text-muted-foreground shrink-0" />
    <div className="flex-1 min-w-0">
      <p className="text-[9px] font-black text-muted-foreground/50 uppercase tracking-widest mb-0.5">{label}</p>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-transparent text-[12px] font-bold text-foreground outline-none placeholder-muted-foreground/40 disabled:opacity-50"
      />
    </div>
  </div>
);

// ── Password field ───────────────────────────────────────────────────────────
const PasswordField = ({ label, value, onChange, show, onToggle }) => (
  <div className="flex items-center gap-3 px-3 py-2 bg-white border border-border/50 rounded-xl focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
    <KeyRound size={14} className="text-muted-foreground shrink-0" />
    <div className="flex-1 min-w-0">
      <p className="text-[9px] font-black text-muted-foreground/50 uppercase tracking-widest mb-0.5">{label}</p>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-transparent text-[12px] font-bold text-foreground outline-none"
        autoComplete="new-password"
      />
    </div>
    <button type="button" onClick={onToggle} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
      {show ? <EyeOff size={13} /> : <Eye size={13} />}
    </button>
  </div>
);

// ════════════════════════════════════════════════════════════════════════════
const UserProfilePanel = ({ isOpen, onClose, onViewChange }) => {
  const { user, updateUser, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('profile');
  const [fullProfile, setFullProfile] = useState(null);
  const [deptProfile, setDeptProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Profile edit state (admin only)
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  // Password state (admin only)
  const [currPw, setCurrPw]     = useState('');
  const [newPw, setNewPw]       = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [changingPw, setChangingPw] = useState(false);

  const isDept = user?.role === 'department' && !user?._isImpersonating;

  // Biometric state
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioToggling, setBioToggling] = useState(false);
  const [bioPasswordPrompt, setBioPasswordPrompt] = useState(false);
  const [bioPassword, setBioPassword] = useState('');
  const [showBioPwd, setShowBioPwd] = useState(false);

  const deptKey = user?.department || '';

  useEffect(() => {
    if (!isNative() || !isOpen) return;
    bioAvailable().then(ok => {
      setBioSupported(ok);
      if (ok) setBioEnabled(hasBioDept(deptKey));
    });
  }, [isOpen, deptKey]);

  const handleBioToggle = async () => {
    if (!bioSupported) return;
    if (bioEnabled) {
      // Disable — remove stored credentials
      setBioToggling(true);
      try {
        await removeBiometric(deptKey);
        setBioEnabled(false);
        toast.success('Fingerprint login disabled.');
      } catch {
        toast.error('Could not disable fingerprint login.');
      } finally { setBioToggling(false); }
    } else {
      // Enable — need password to store
      setBioPasswordPrompt(true);
    }
  };

  const handleBioEnroll = async () => {
    if (!bioPassword) { toast.error('Enter your current password to enable fingerprint login.'); return; }
    setBioToggling(true);
    try {
      await enrollBiometric(deptKey, bioPassword);
      setBioEnabled(true);
      setBioPasswordPrompt(false);
      setBioPassword('');
      toast.success('Fingerprint login enabled!', { icon: '🔒' });
    } catch (err) {
      toast.error(err?.message || 'Fingerprint setup failed. Check your password and try again.');
    } finally { setBioToggling(false); }
  };

  useEffect(() => {
    if (!isOpen || !user) return;
    setActiveTab('profile');
    setName(user.name || '');
    setEmail(user.email || '');
    setCurrPw(''); setNewPw(''); setConfirmPw('');

    const load = async () => {
      setLoadingProfile(true);
      try {
        if (!isDept) {
          const data = await authAPI.getFullProfile();
          setFullProfile(data);
          setName(data.user?.name || user.name || '');
          setEmail(data.user?.email || user.email || '');
        } else {
          const data = await reqAPI.getDeptProfile();
          setDeptProfile(data);
        }
      } catch (_) {}
      setLoadingProfile(false);
    };
    load();
  }, [isOpen, user?.id]);

  const handleSaveProfile = async () => {
    if (!name.trim()) { toast.error('Name cannot be empty.'); return; }
    setSaving(true);
    try {
      const result = await authAPI.updateProfile({ name: name.trim(), email: email.trim() });
      updateUser(result.user, result.token);
      toast.success('Profile updated successfully.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update profile. Please try again.');
    } finally { setSaving(false); }
  };

  const handleChangePassword = async () => {
    if (!currPw || !newPw || !confirmPw) { toast.error('All password fields are required.'); return; }
    if (newPw !== confirmPw) { toast.error('New passwords do not match.'); return; }
    if (newPw.length < 8) { toast.error('Password must be at least 8 characters.'); return; }
    setChangingPw(true);
    try {
      await authAPI.changePassword({ currentPassword: currPw, newPassword: newPw });
      toast.success('Password changed successfully. Please log in again.', { duration: 5000 });
      setCurrPw(''); setNewPw(''); setConfirmPw('');
      setTimeout(logout, 2000);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Password change failed. Please try again.');
    } finally { setChangingPw(false); }
  };

  const hasChanges = name.trim() !== (fullProfile?.user?.name || user?.name || '') ||
                     email.trim() !== (fullProfile?.user?.email || user?.email || '');

  if (!isOpen) return null;

  const roleLabel = {
    global_admin: 'Super Administrator',
    admin: 'Administrator',
    procurement: 'Procurement Officer',
    finance: 'Finance Officer',
    audit: 'Audit Officer',
    gm: 'General Manager',
    chairman: 'Chairman',
    department: 'Department Controller',
  }[user?.role] || user?.role || 'User';

  const grad = avatarColor(user?.name || user?.role || '');

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[120] bg-black/30 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 z-[130] h-full w-full max-w-sm bg-[#FAF9F6] shadow-2xl shadow-black/20 flex flex-col animate-in slide-in-from-right duration-300">

        {/* Header */}
        <div className={`bg-gradient-to-br ${grad} p-6 relative overflow-hidden`}>
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 70% 50%, white 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-all"
          >
            <X size={16} />
          </button>

          <div className="relative z-10 flex items-end gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center text-white text-2xl font-black shadow-lg">
              {initials(user?.name || user?.department || 'U')}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-white font-black text-lg leading-tight truncate">{user?.name || 'User'}</h2>
              {isDept ? (
                <p className="text-white/70 text-[11px] font-bold mt-0.5">{user?.department || 'Department'}</p>
              ) : (
                <p className="text-white/70 text-[11px] font-bold mt-0.5 truncate">{user?.email}</p>
              )}
              <span className="mt-2 inline-block px-2 py-0.5 rounded-full bg-white/20 border border-white/30 text-[9px] font-black text-white uppercase tracking-widest">
                {roleLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Tabs (admin only) */}
        {!isDept && (
          <div className="flex border-b border-border/30 bg-white/50 shrink-0">
            {['profile', 'security'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${
                  activeTab === tab
                    ? 'text-primary border-b-2 border-primary bg-primary/5'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab === 'profile' ? 'Profile' : 'Security'}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">

          {loadingProfile ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 size={24} className="animate-spin text-primary" />
              <p className="text-[11px] font-bold text-muted-foreground">Loading profile…</p>
            </div>
          ) : isDept ? (
            /* ── Department Account View ── */
            <>
              <Section title="Account">
                <ReadField icon={Building2} label="Department" value={user?.department} />
                <ReadField icon={Shield} label="Account Type" value="Department Controller" />
                {fullProfile?.user?.createdAt || deptProfile ? (
                  <ReadField icon={Calendar} label="Login Established" value={
                    deptProfile ? 'Active Session' : '—'
                  } />
                ) : null}
              </Section>

              <Section title="Department Head">
                {deptProfile?.headName ? (
                  <>
                    <ReadField icon={User} label="Head Name" value={deptProfile.headName} />
                    {deptProfile.headTitle && <ReadField icon={Shield} label="Title / Position" value={deptProfile.headTitle} />}
                    {deptProfile.headEmail && <ReadField icon={Mail} label="Official Email" value={deptProfile.headEmail} />}
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] font-bold ${
                      deptProfile.hasSignature
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-amber-50 border-amber-200 text-amber-700'
                    }`}>
                      {deptProfile.hasSignature
                        ? <><CheckCircle2 size={13} /> Digital signature on file</>
                        : <><AlertTriangle size={13} /> No digital signature uploaded</>
                      }
                    </div>
                  </>
                ) : (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-center space-y-2">
                    <AlertTriangle size={20} className="text-amber-500 mx-auto" />
                    <p className="text-xs font-bold text-amber-700">Department profile incomplete</p>
                    <p className="text-[10px] text-amber-600">Head information and signature are required to raise requisitions.</p>
                  </div>
                )}
              </Section>

              <button
                onClick={() => { onViewChange('dept_profile'); onClose(); }}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-primary text-primary font-bold text-xs uppercase tracking-widest hover:bg-primary hover:text-white transition-all"
              >
                <ExternalLink size={14} />
                {deptProfile?.headName ? 'Manage Department Profile' : 'Complete Department Setup'}
              </button>

              {/* Biometric section — native only */}
              {bioSupported && (
                <Section title="Mobile Security">
                  <div className="flex items-center justify-between px-3 py-3 bg-white rounded-xl border border-border/40">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${bioEnabled ? 'bg-primary/10 border border-primary/20' : 'bg-muted/40 border border-border/30'}`}>
                        <Fingerprint size={17} className={bioEnabled ? 'text-primary' : 'text-muted-foreground'} />
                      </div>
                      <div>
                        <p className="text-[11px] font-black text-foreground">Fingerprint Login</p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">{bioEnabled ? 'Enabled for this device' : 'Tap to set up'}</p>
                      </div>
                    </div>
                    <button
                      onClick={handleBioToggle}
                      disabled={bioToggling}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${bioEnabled ? 'bg-primary' : 'bg-muted/60 border border-border/50'} disabled:opacity-50`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-200 ${bioEnabled ? 'left-[calc(100%-1.375rem)]' : 'left-0.5'}`}/>
                    </button>
                  </div>

                  {/* Password prompt to enroll */}
                  {bioPasswordPrompt && (
                    <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl space-y-3 animate-in slide-in-from-top-2 duration-200">
                      <p className="text-[10px] text-muted-foreground font-medium leading-relaxed">
                        Enter your <strong>current password</strong> to enable fingerprint login. It will be stored securely on this device.
                      </p>
                      <div className="relative">
                        <KeyRound size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50"/>
                        <input
                          type={showBioPwd ? 'text' : 'password'}
                          value={bioPassword}
                          onChange={e => setBioPassword(e.target.value)}
                          placeholder="Your current password"
                          className="w-full pl-8 pr-9 py-2.5 text-xs bg-white border border-border/50 rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all font-mono tracking-widest"
                        />
                        <button type="button" onClick={() => setShowBioPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-primary transition-colors">
                          {showBioPwd ? <EyeOff size={13}/> : <Eye size={13}/>}
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={handleBioEnroll} disabled={bioToggling || !bioPassword}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition-all">
                          {bioToggling ? <Loader2 size={11} className="animate-spin"/> : <Fingerprint size={11}/>}
                          Enable
                        </button>
                        <button onClick={() => { setBioPasswordPrompt(false); setBioPassword(''); }}
                          className="px-4 py-2.5 rounded-xl border border-border/50 text-muted-foreground text-[10px] font-black uppercase tracking-widest hover:bg-muted/40 transition-all">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </Section>
              )}

              <div className="p-3 bg-muted/30 rounded-xl border border-border/30">
                <p className="text-[10px] text-muted-foreground font-medium text-center leading-relaxed">
                  Department credentials are managed by the System Administrator through System Settings.
                </p>
              </div>
            </>
          ) : activeTab === 'profile' ? (
            /* ── Admin Profile Tab ── */
            <>
              <Section title="Account Details">
                <EditField icon={User} label="Full Name" value={name} onChange={setName} disabled={saving} />
                <EditField icon={Mail} label="Email Address" value={email} onChange={setEmail} type="email" disabled={saving} />
                <ReadField icon={Shield} label="System Role" value={roleLabel} />
                {fullProfile?.user?.createdAt && (
                  <ReadField icon={Calendar} label="Member Since" value={new Date(fullProfile.user.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} />
                )}
                {fullProfile?.lastActivity && (
                  <ReadField icon={Clock} label="Last Activity" value={`${fullProfile.lastActivity.action} — ${new Date(fullProfile.lastActivity.createdAt).toLocaleString()}`} />
                )}
              </Section>

              {hasChanges && (
                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest hover:bg-primary/90 transition-all disabled:opacity-50 shadow-lg shadow-primary/20 active:scale-95"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              )}
            </>
          ) : (
            /* ── Admin Security Tab ── */
            <>
              <Section title="Change Password">
                <PasswordField label="Current Password" value={currPw} onChange={setCurrPw} show={showPw} onToggle={() => setShowPw(v => !v)} />
                <PasswordField label="New Password" value={newPw} onChange={setNewPw} show={showPw} onToggle={() => setShowPw(v => !v)} />
                <PasswordField label="Confirm New Password" value={confirmPw} onChange={setConfirmPw} show={showPw} onToggle={() => setShowPw(v => !v)} />
                {newPw && newPw.length < 8 && (
                  <p className="text-[10px] text-amber-600 font-bold flex items-center gap-1.5">
                    <AlertTriangle size={11} /> Minimum 8 characters required
                  </p>
                )}
                {newPw && confirmPw && newPw !== confirmPw && (
                  <p className="text-[10px] text-red-500 font-bold flex items-center gap-1.5">
                    <AlertTriangle size={11} /> Passwords do not match
                  </p>
                )}
              </Section>

              <button
                onClick={handleChangePassword}
                disabled={changingPw || !currPw || !newPw || !confirmPw}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-foreground text-background font-bold text-xs uppercase tracking-widest hover:bg-foreground/90 transition-all disabled:opacity-40 active:scale-95"
              >
                {changingPw ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                {changingPw ? 'Updating…' : 'Update Password'}
              </button>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-[10px] text-amber-700 font-medium leading-relaxed">
                  After changing your password you will be automatically signed out and need to log in again with your new credentials.
                </p>
              </div>

              {/* Biometric for admin on native */}
              {bioSupported && (
                <Section title="Mobile Security">
                  <div className="flex items-center justify-between px-3 py-3 bg-white rounded-xl border border-border/40">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${bioEnabled ? 'bg-primary/10 border border-primary/20' : 'bg-muted/40 border border-border/30'}`}>
                        <Fingerprint size={17} className={bioEnabled ? 'text-primary' : 'text-muted-foreground'} />
                      </div>
                      <div>
                        <p className="text-[11px] font-black text-foreground">Fingerprint Login</p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">{bioEnabled ? 'Enabled for this device' : 'Tap to set up'}</p>
                      </div>
                    </div>
                    <button
                      onClick={handleBioToggle}
                      disabled={bioToggling}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${bioEnabled ? 'bg-primary' : 'bg-muted/60 border border-border/50'} disabled:opacity-50`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-200 ${bioEnabled ? 'left-[calc(100%-1.375rem)]' : 'left-0.5'}`}/>
                    </button>
                  </div>
                  {bioPasswordPrompt && (
                    <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl space-y-3 animate-in slide-in-from-top-2 duration-200">
                      <p className="text-[10px] text-muted-foreground font-medium leading-relaxed">
                        Enter your <strong>current password</strong> to enable fingerprint login.
                      </p>
                      <div className="relative">
                        <KeyRound size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50"/>
                        <input
                          type={showBioPwd ? 'text' : 'password'}
                          value={bioPassword}
                          onChange={e => setBioPassword(e.target.value)}
                          placeholder="Your current password"
                          className="w-full pl-8 pr-9 py-2.5 text-xs bg-white border border-border/50 rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all font-mono tracking-widest"
                        />
                        <button type="button" onClick={() => setShowBioPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-primary transition-colors">
                          {showBioPwd ? <EyeOff size={13}/> : <Eye size={13}/>}
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={handleBioEnroll} disabled={bioToggling || !bioPassword}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition-all">
                          {bioToggling ? <Loader2 size={11} className="animate-spin"/> : <Fingerprint size={11}/>}
                          Enable
                        </button>
                        <button onClick={() => { setBioPasswordPrompt(false); setBioPassword(''); }}
                          className="px-4 py-2.5 rounded-xl border border-border/50 text-muted-foreground text-[10px] font-black uppercase tracking-widest hover:bg-muted/40 transition-all">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </Section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border/30 bg-white/50 shrink-0">
          <button
            onClick={logout}
            className="w-full py-2.5 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
          >
            <X size={13} />
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
};

export default UserProfilePanel;
