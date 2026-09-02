import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, History, Clock, RefreshCw, AlertCircle, Server, Terminal, Activity, Users } from 'lucide-react';
import { adminAPI } from '../lib/api';

const TabButton = ({ active, onClick, icon: Icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center space-x-2 px-5 py-3 rounded-xl text-sm font-bold transition-all ${
      active
        ? 'bg-primary/20 text-primary border border-primary/20 shadow-lg shadow-primary/10'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
    }`}
  >
    <Icon size={16} />
    <span>{label}</span>
  </button>
);

const GuideTab = () => {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminAPI.getArchitectureDoc();
      setDoc(data);
    } catch (err) {
      setError('Failed to load the guide. Check that ARCHITECTURE.md exists at the repo root.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-20 text-center animate-pulse text-muted-foreground font-mono text-xs">Loading guide...</div>;
  if (error) return (
    <div className="p-10 flex items-center gap-3 text-destructive bg-destructive/5 border border-destructive/20 rounded-2xl">
      <AlertCircle size={18} />
      <span className="text-sm font-medium">{error}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono uppercase tracking-widest">
        <span className="flex items-center gap-1.5"><Clock size={12} /> Last updated: {doc?.updatedAt ? new Date(doc.updatedAt).toLocaleString() : 'Unknown'}</span>
        <button onClick={load} className="flex items-center gap-1.5 hover:text-primary transition-colors">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      <div className="doc-guide glass bg-white/95 border border-border/50 rounded-3xl p-6 lg:p-10 shadow-sm prose prose-sm lg:prose-base max-w-none prose-headings:font-bold prose-headings:text-foreground prose-a:text-primary prose-table:text-xs prose-th:bg-muted/50">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc?.content || ''}</ReactMarkdown>
      </div>
    </div>
  );
};

const VpsGuideTab = () => {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminAPI.getVpsGuide();
      setDoc(data);
    } catch (err) {
      setError('Failed to load VPS guide. Check that VPS_MANAGEMENT_GUIDE.md exists at the repo root.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-20 text-center animate-pulse text-muted-foreground font-mono text-xs">Loading VPS guide...</div>;
  if (error) return (
    <div className="p-10 flex items-center gap-3 text-destructive bg-destructive/5 border border-destructive/20 rounded-2xl">
      <AlertCircle size={18} />
      <span className="text-sm font-medium">{error}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono uppercase tracking-widest">
        <span className="flex items-center gap-1.5"><Clock size={12} /> Last updated: {doc?.updatedAt ? new Date(doc.updatedAt).toLocaleString() : 'Unknown'}</span>
        <button onClick={load} className="flex items-center gap-1.5 hover:text-primary transition-colors">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      <div className="doc-guide glass bg-white/95 border border-border/50 rounded-3xl p-6 lg:p-10 shadow-sm prose prose-sm lg:prose-base max-w-none prose-headings:font-bold prose-headings:text-foreground prose-a:text-primary prose-table:text-xs prose-th:bg-muted/50">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc?.content || ''}</ReactMarkdown>
      </div>
    </div>
  );
};

const DeployLogsTab = () => {
  const [history, setHistory] = useState('');
  const [pm2Lines, setPm2Lines] = useState([]);
  const [pm2Total, setPm2Total] = useState(0);
  const [pm2Type, setPm2Type] = useState('out');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingPm2, setLoadingPm2] = useState(true);
  const [errorHistory, setErrorHistory] = useState(null);
  const [errorPm2, setErrorPm2] = useState(null);
  const pm2Ref = useRef(null);
  const intervalRef = useRef(null);

  const loadHistory = async () => {
    setLoadingHistory(true);
    setErrorHistory(null);
    try {
      const data = await adminAPI.getDeployHistory();
      setHistory(data.content || '');
    } catch { setErrorHistory('Could not load deploy history.'); }
    finally { setLoadingHistory(false); }
  };

  const loadPm2 = async (type = pm2Type) => {
    setLoadingPm2(true);
    setErrorPm2(null);
    try {
      const data = await adminAPI.getPm2Logs(type, 150);
      setPm2Lines(data.lines || []);
      setPm2Total(data.total || 0);
    } catch { setErrorPm2('Could not read PM2 logs.'); }
    finally { setLoadingPm2(false); }
  };

  const switchType = (t) => { setPm2Type(t); loadPm2(t); };

  useEffect(() => {
    loadHistory();
    loadPm2('out');
    intervalRef.current = setInterval(() => loadPm2(pm2Type), 30000);
    return () => clearInterval(intervalRef.current);
  }, []);

  useEffect(() => {
    if (pm2Ref.current) pm2Ref.current.scrollTop = pm2Ref.current.scrollHeight;
  }, [pm2Lines]);

  const colorLine = (line) => {
    if (/error|fail|✗|FAILED/i.test(line)) return 'text-red-400';
    if (/warn/i.test(line)) return 'text-yellow-400';
    if (/✓|SUCCESS|online|started/i.test(line)) return 'text-emerald-400';
    if (/══|──|DEPLOY|BUILD/i.test(line)) return 'text-blue-300 font-semibold';
    if (/Actor|Commit|Run /i.test(line)) return 'text-slate-300';
    return 'text-slate-400';
  };

  return (
    <div className="space-y-6">
      {/* ── Deploy History ───────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-primary" />
            <span className="text-sm font-bold text-foreground">Deploy History</span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">InterServer VPS</span>
          </div>
          <button onClick={loadHistory} className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        <div className="relative">
          {loadingHistory ? (
            <div className="h-64 flex items-center justify-center animate-pulse text-muted-foreground text-xs font-mono">Loading deploy history...</div>
          ) : errorHistory ? (
            <div className="p-4 flex items-center gap-2 text-destructive bg-destructive/5 border border-destructive/20 rounded-2xl text-sm">
              <AlertCircle size={16} />{errorHistory}
            </div>
          ) : (
            <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800 bg-slate-900/60">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
                <span className="ml-2 text-[11px] font-mono text-slate-500">deploy-history.log</span>
              </div>
              <div className="p-4 overflow-x-auto max-h-96 overflow-y-auto">
                <pre className="text-[11px] font-mono leading-relaxed">
                  {history.split('\n').map((line, i) => (
                    <div key={i} className={colorLine(line)}>{line || ' '}</div>
                  ))}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── PM2 Runtime Logs ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Terminal size={15} className="text-primary" />
            <span className="text-sm font-bold text-foreground">Runtime Logs</span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">PM2 · last 150 lines · auto-refresh 30s</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center p-0.5 bg-muted/50 rounded-lg border border-border/50 text-xs font-mono">
              <button onClick={() => switchType('out')} className={`px-3 py-1 rounded-md transition-all ${pm2Type === 'out' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>stdout</button>
              <button onClick={() => switchType('err')} className={`px-3 py-1 rounded-md transition-all ${pm2Type === 'err' ? 'bg-red-500/20 text-red-400' : 'text-muted-foreground hover:text-foreground'}`}>stderr</button>
            </div>
            <button onClick={() => loadPm2(pm2Type)} className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">
              <RefreshCw size={12} className={loadingPm2 ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
        <div className="relative">
          {errorPm2 ? (
            <div className="p-4 flex items-center gap-2 text-destructive bg-destructive/5 border border-destructive/20 rounded-2xl text-sm">
              <AlertCircle size={16} />{errorPm2}
            </div>
          ) : (
            <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-900/60">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
                  <span className="ml-2 text-[11px] font-mono text-slate-500">
                    /var/log/pm2/cssrms-{pm2Type === 'err' ? 'error' : 'out'}.log
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-600">{pm2Total.toLocaleString()} total lines</span>
              </div>
              <div ref={pm2Ref} className="p-4 overflow-x-auto h-80 overflow-y-auto">
                {loadingPm2 && pm2Lines.length === 0 ? (
                  <div className="animate-pulse text-slate-600 text-xs font-mono">Reading logs...</div>
                ) : pm2Lines.length === 0 ? (
                  <div className="text-slate-600 text-xs font-mono">No log entries yet.</div>
                ) : (
                  <pre className="text-[11px] font-mono leading-relaxed">
                    {pm2Lines.map((line, i) => (
                      <div key={i} className={colorLine(line)}>{line}</div>
                    ))}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const MigrationsTab = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminAPI.getMigrationsLogbook();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError('Failed to load migration history from the database.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-20 text-center animate-pulse text-muted-foreground font-mono text-xs">Reading migration history...</div>;
  if (error) return (
    <div className="p-10 flex items-center gap-3 text-destructive bg-destructive/5 border border-destructive/20 rounded-2xl">
      <AlertCircle size={18} />
      <span className="text-sm font-medium">{error}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground max-w-xl">
          Read directly from the database's own migration history table — this list is always
          accurate with zero manual upkeep, since it's exactly what the database recorded when
          each migration was applied.
        </p>
        <button onClick={load} className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors shrink-0 ml-4">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      <div className="glass bg-white/95 border border-border/50 rounded-3xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30 border-b border-border/50">
              <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Migration</th>
              <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Started</th>
              <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Finished</th>
              <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Steps</th>
              <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                <td className="px-5 py-3 font-mono text-xs text-foreground">{r.migration_name}</td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{r.started_at ? new Date(r.started_at).toLocaleString() : '—'}</td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{r.finished_at ? new Date(r.finished_at).toLocaleString() : '—'}</td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{r.applied_steps_count ?? '—'}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border tracking-widest ${
                    r.finished_at ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'
                  }`}>
                    {r.finished_at ? 'Applied' : 'Pending'}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-xs text-muted-foreground">No migrations recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const OperatorGuideTab = () => {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminAPI.getOperatorGuide();
      setDoc(data);
    } catch (err) {
      setError('Failed to load the operator guide. Check that OPERATOR_GUIDE.md exists at the repo root.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-20 text-center animate-pulse text-muted-foreground font-mono text-xs">Loading operator guide...</div>;
  if (error) return (
    <div className="p-10 flex items-center gap-3 text-destructive bg-destructive/5 border border-destructive/20 rounded-2xl">
      <AlertCircle size={18} />
      <span className="text-sm font-medium">{error}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono uppercase tracking-widest">
        <span className="flex items-center gap-1.5"><Clock size={12} /> Last updated: {doc?.updatedAt ? new Date(doc.updatedAt).toLocaleString() : 'Unknown'}</span>
        <button onClick={load} className="flex items-center gap-1.5 hover:text-primary transition-colors">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      <div className="doc-guide glass bg-white/95 border border-border/50 rounded-3xl p-6 lg:p-10 shadow-sm prose prose-sm lg:prose-base max-w-none prose-headings:font-bold prose-headings:text-foreground prose-a:text-primary prose-table:text-xs prose-th:bg-muted/50">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc?.content || ''}</ReactMarkdown>
      </div>
    </div>
  );
};

const Documentation = () => {
  const [tab, setTab] = useState('operator');

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      <div className="space-y-1">
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight flex items-center space-x-3">
          <BookOpen className="text-primary" />
          <span>System <span className="text-primary">Documentation</span></span>
        </h1>
        <p className="text-muted-foreground text-xs lg:text-sm font-medium">
          Operator's guide, architecture reference, VPS handbook, deploy logs, and a read-only log of every database change.
        </p>
      </div>

      <div className="flex items-center space-x-3 p-1.5 glass bg-white/80 border border-border/50 rounded-2xl w-fit shadow-sm flex-wrap gap-y-2">
        <TabButton active={tab === 'operator'} onClick={() => setTab('operator')} icon={Users} label="Operator's Guide" />
        <TabButton active={tab === 'guide'} onClick={() => setTab('guide')} icon={BookOpen} label="Architecture Guide" />
        <TabButton active={tab === 'vps'} onClick={() => setTab('vps')} icon={Server} label="VPS Management" />
        <TabButton active={tab === 'deploy'} onClick={() => setTab('deploy')} icon={Activity} label="Deploy Logs" />
        <TabButton active={tab === 'migrations'} onClick={() => setTab('migrations')} icon={History} label="Migration Logbook" />
      </div>

      {tab === 'operator' && <OperatorGuideTab />}
      {tab === 'guide' && <GuideTab />}
      {tab === 'vps' && <VpsGuideTab />}
      {tab === 'deploy' && <DeployLogsTab />}
      {tab === 'migrations' && <MigrationsTab />}
    </div>
  );
};

export default Documentation;
