import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getMyActivityLog, uploadUserSignature } from '../lib/store';
import { History, Clock, Upload } from 'lucide-react';

const MyActivity = ({ onViewChange }) => {
  const { user } = useAuth();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const loadActivity = async () => {
    const log = await getMyActivityLog();
    setActivities(log);
    setLoading(false);
  };

  useEffect(() => { loadActivity(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.addEventListener('globalHardRefresh', loadActivity);
    return () => window.removeEventListener('globalHardRefresh', loadActivity);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSignatureUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id || typeof user.id !== 'number') return;
    setUploading(true);
    try {
      await uploadUserSignature(user.id, file);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">My <span className="text-primary italic">Activity</span></h1>
          <p className="text-muted-foreground text-sm mt-1">Complete log of all your actions, submissions, and approvals.</p>
        </div>

        {user?.role !== 'department' && (
          <div className="glass bg-white/60 rounded-3xl border border-border/50 p-6 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground">My Signature</h3>
              <p className="text-xs text-muted-foreground mt-1">Upload a signature image for approval stamping.</p>
            </div>
            <div>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleSignatureUpload} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="bg-primary hover:bg-primary/90 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center space-x-2 disabled:opacity-50"
              >
                <Upload size={14} />
                <span>{uploading ? 'Uploading...' : 'Upload Signature'}</span>
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-muted-foreground animate-pulse font-mono text-xs">Loading activity log...</div>
        ) : activities.length === 0 ? (
          <div className="glass bg-white/60 rounded-3xl border border-border/50 p-12 text-center">
            <History size={48} className="mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-bold text-foreground">No Activity Yet</h3>
            <p className="text-sm text-muted-foreground mt-2">Your actions will appear here as you use the portal.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activities.map((activity, i) => (
              <div key={activity.id || i} className="glass bg-white/60 rounded-2xl border border-border/50 p-5 flex items-center space-x-4 hover:border-primary/20 transition-all shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary flex-shrink-0">
                  <Clock size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-foreground">{activity.action}</h4>
                  <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{activity.detail}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] text-muted-foreground font-mono">{new Date(activity.timestamp).toLocaleDateString()}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{new Date(activity.timestamp).toLocaleTimeString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
  );
};

export default MyActivity;
