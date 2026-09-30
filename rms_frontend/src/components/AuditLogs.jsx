import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Activity, ShieldCheck, User, Clock, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

const AuditLogEntry = ({ user, action, type, details, date }) => {
  const icons = {
    approval: <CheckCircle2 size={14} className="text-emerald-500" />,
    rejection: <XCircle size={14} className="text-destructive" />,
    security: <ShieldCheck size={14} className="text-primary" />,
    system: <Activity size={14} className="text-muted-foreground" />,
    warning: <AlertTriangle size={14} className="text-amber-500" />
  };

  return (
    <div className="flex items-start space-x-4 p-4 border-b border-border/50 hover:bg-muted/50 transition-all group">
      <div className={`mt-1 p-2 rounded-lg bg-muted border border-border/50 shadow-sm`}>
        {icons[type] || icons.system}
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
            {action}
          </p>
          <span className="text-[10px] text-muted-foreground font-mono flex items-center space-x-1 uppercase">
            <Clock size={10} />
            <span>{new Date(date).toLocaleString()}</span>
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">{details}</p>
      </div>
    </div>
  );
};

import { getActivityLog } from '../lib/store';

const AuditLogs = ({ onViewChange }) => {
  const { user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadLogs = async () => {
    const data = await getActivityLog();
    setLogs(data);
    setLoading(false);
  };

  useEffect(() => { loadLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.addEventListener('globalHardRefresh', loadLogs);
    return () => window.removeEventListener('globalHardRefresh', loadLogs);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="p-20 text-center animate-pulse text-muted-foreground font-mono text-xs">Accessing Immutable Ledger...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
        <div className="flex items-center justify-between border-b border-border/50 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight flex items-center space-x-3">
              <Activity className="text-primary" />
              <span>Audit <span className="text-primary">Logs</span></span>
            </h1>
            <p className="text-muted-foreground text-sm mt-1 font-medium italic">Immutable ledger of all system decisions and security actions.</p>
          </div>
          <div className="bg-primary/10 border border-primary/20 px-4 py-2 rounded-xl text-primary text-xs font-bold uppercase tracking-widest shadow-sm">
            Audit Mode Active
          </div>
        </div>

        <div className="glass bg-white/60 rounded-3xl border border-border/50 overflow-hidden shadow-md divide-y divide-border/50">
          {logs.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm font-medium italic">No activity recorded yet.</div>
          ) : logs.map((log, idx) => {
            const getIconType = (action) => {
              if (action.includes('Login')) return 'security';
              if (action.includes('Requisition')) return 'approval';
              if (action.includes('Deleted')) return 'rejection';
              if (action.includes('error')) return 'warning';
              return 'system';
            };
            return (
              <AuditLogEntry 
                key={log.id || idx} 
                action={log.action} 
                type={getIconType(log.action)} 
                details={log.details || log.detail} 
                date={log.createdAt || log.timestamp} 
              />
            );
          })}
        </div>
        
        <div className="text-center py-8">
           <button className="text-xs font-bold text-muted-foreground hover:text-foreground transition-all bg-white/80 px-6 py-2.5 rounded-xl border border-border shadow-sm hover:shadow-md">
             Load More Activity
           </button>
        </div>
    </div>
  );
};

export default AuditLogs;
