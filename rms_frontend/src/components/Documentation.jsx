import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, History, Clock, RefreshCw, AlertCircle, Server } from 'lucide-react';
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

const Documentation = () => {
  const [tab, setTab] = useState('guide');

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      <div className="space-y-1">
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight flex items-center space-x-3">
          <BookOpen className="text-primary" />
          <span>System <span className="text-primary">Documentation</span></span>
        </h1>
        <p className="text-muted-foreground text-xs lg:text-sm font-medium">
          Architecture guide, VPS server management handbook, and a read-only log of every database change applied.
        </p>
      </div>

      <div className="flex items-center space-x-3 p-1.5 glass bg-white/80 border border-border/50 rounded-2xl w-fit shadow-sm flex-wrap gap-y-2">
        <TabButton active={tab === 'guide'} onClick={() => setTab('guide')} icon={BookOpen} label="Architecture Guide" />
        <TabButton active={tab === 'vps'} onClick={() => setTab('vps')} icon={Server} label="VPS Management" />
        <TabButton active={tab === 'migrations'} onClick={() => setTab('migrations')} icon={History} label="Migration Logbook" />
      </div>

      {tab === 'guide' && <GuideTab />}
      {tab === 'vps' && <VpsGuideTab />}
      {tab === 'migrations' && <MigrationsTab />}
    </div>
  );
};

export default Documentation;
