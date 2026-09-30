import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../lib/api';
import { logActivity, clearAllCaches } from '../lib/store';
import { toast } from 'react-hot-toast';

// ── Credential hashing using PBKDF2 (Web Crypto) ──────────────────────────────
// Returns a hex string derived from the secret + stored salt so the actual
// code is never stored in localStorage.
async function deriveHash(secret, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']
  );
  const saltBuf = Uint8Array.from(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBuf, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes = 16) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const verifySession = async () => {
      const storedUser = localStorage.getItem('rms_user');

      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
          // Proactively verify token with backend
          const result = await authAPI.checkSession();
          if (result && result.user) {
            setUser(result.user);
            localStorage.setItem('rms_user', JSON.stringify(result.user));
          }
        } catch (err) {
          console.error("Session verification failed:", err);
          if (!navigator.onLine || err.message === 'Network Error' || !err.response) {
             console.warn("Offline: Retaining cached session.");
          } else {
             logout();
          }
        }
      }
      setLoading(false);
    };

    verifySession();
  }, []);

  // Silent background sync — re-reads DB every 60 s and refreshes the JWT
  // with current privileges, routing scope, and dept data. Completely invisible
  // to users: no spinner, no state flag, UI just reflects updated values quietly.
  useEffect(() => {
    const syncProfile = async () => {
      try {
        const result = await authAPI.syncProfile();
        if (result?.user) {
          setUser(result.user);
          localStorage.setItem('rms_user', JSON.stringify(result.user));
        }
      } catch {
        // Ignore — offline, server error, or session expired (handled by API interceptor)
      }
    };
    const iv = setInterval(syncProfile, 60_000);
    return () => clearInterval(iv);
  }, []);

  const login = async (email, password) => {
    const { user: userData } = await authAPI.login(email, password);
    // Server sets the HttpOnly auth cookie — we only keep user data for the UI
    setUser(userData);
    localStorage.setItem('rms_user', JSON.stringify(userData));
    return userData;
  };

  const deptLogin = async (departmentName, accessCode, mfaCode, turnstileToken) => {
    try {
      const { user: userData } = await authAPI.deptLogin(departmentName, accessCode, mfaCode, turnstileToken);
      // Wipe previous user's cached data before populating this user's data
      await clearAllCaches();
      // Server sets the HttpOnly auth cookie — we only keep user data for the UI

      // Derive and store credential hashes using PBKDF2 — actual codes are never stored
      const accessSalt = randomHex(16);
      const accessHash = await deriveHash(accessCode, accessSalt);
      const mfaSalt = mfaCode ? randomHex(16) : null;
      const mfaHash = mfaCode ? await deriveHash(mfaCode, mfaSalt) : null;

      localStorage.setItem('rms_offline_auth', JSON.stringify({
        departmentName,
        accessSalt,
        accessHash,
        mfaSalt,
        mfaHash
      }));
      localStorage.setItem('rms_offline_session', JSON.stringify({ user: userData }));

      setUser(userData);
      localStorage.setItem('rms_user', JSON.stringify(userData));
      return userData;
    } catch (err) {
      if (!navigator.onLine || err.message === 'Network Error' || !err.response) {
        const offlineAuth = JSON.parse(localStorage.getItem('rms_offline_auth') || 'null');
        if (offlineAuth && offlineAuth.departmentName === departmentName && offlineAuth.accessSalt) {
          const inputHash = await deriveHash(accessCode, offlineAuth.accessSalt);
          if (inputHash !== offlineAuth.accessHash) {
            throw new Error("Invalid offline credentials or profile not synced to this device.");
          }
          if (offlineAuth.mfaHash && offlineAuth.mfaSalt) {
            const inputMfaHash = await deriveHash(mfaCode || '', offlineAuth.mfaSalt);
            if (inputMfaHash !== offlineAuth.mfaHash) {
              throw new Error("Invalid MFA PIN for offline profile.");
            }
          }
          const session = JSON.parse(localStorage.getItem('rms_offline_session') || 'null');
          if (session) {
            setUser(session.user);
            localStorage.setItem('rms_user', JSON.stringify(session.user));
            toast.success("Logged in offline securely.", { icon: '🔒' });
            return session.user;
          }
        }
        throw new Error("Invalid offline credentials or profile not synced to this device.");
      }
      throw err;
    }
  };

  // Called after flows that already have a valid session (e.g. post-activation).
  // Mirrors what deptLogin does after a successful API call, without hitting dept-login.
  const loginWithData = async (userData, departmentName, accessCode, mfaCode) => {
    await clearAllCaches();
    if (departmentName && accessCode) {
      const accessSalt = randomHex(16);
      const accessHash = await deriveHash(accessCode, accessSalt);
      const mfaSalt = mfaCode ? randomHex(16) : null;
      const mfaHash = mfaCode ? await deriveHash(mfaCode, mfaSalt) : null;
      localStorage.setItem('rms_offline_auth', JSON.stringify({ departmentName, accessSalt, accessHash, mfaSalt, mfaHash }));
    }
    localStorage.setItem('rms_offline_session', JSON.stringify({ user: userData }));
    setUser(userData);
    localStorage.setItem('rms_user', JSON.stringify(userData));
    return userData;
  };

  const updateUser = (updatedFields, _newToken) => {
    // _newToken ignored — server rotates the auth cookie directly on profile update
    const merged = { ...user, ...updatedFields };
    setUser(merged);
    localStorage.setItem('rms_user', JSON.stringify(merged));
    try {
      const offline = localStorage.getItem('rms_offline_session');
      if (offline) {
        const parsed = JSON.parse(offline);
        localStorage.setItem('rms_offline_session', JSON.stringify({ ...parsed, user: merged }));
      }
    } catch (_) {}
  };

  const logout = async () => {
    await authAPI.logout(); // server clears HttpOnly cookie and blacklists token
    await clearAllCaches();  // wipe shared localforage so the next user doesn't see stale data
    setUser(null);
    localStorage.removeItem('rms_user');
    localStorage.removeItem('rms_offline_auth');
    localStorage.removeItem('rms_offline_session');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, deptLogin, loginWithData, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
