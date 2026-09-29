import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { LifeBuoy, X, Send, Loader2, CheckCircle2, Clock, MessageSquare } from 'lucide-react';
import { toast } from 'react-hot-toast';

const TYPES = [
  { value: 'question',    label: 'Question' },
  { value: 'suggestion',  label: 'Suggestion' },
  { value: 'observation', label: 'Observation' },
];

const fmt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const token = () => localStorage.getItem('rms_token');

export default function HelpDeskWidget() {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm]         = useState({ type: 'question', message: '' });
  const [unreadCount, setUnreadCount] = useState(0);

  // ── Draggable position ───────────────────────────────────────────────────────
  const defaultPos = () => ({
    x: Math.max(0, (typeof window !== 'undefined' ? window.innerWidth  : 400) - 76),
    y: Math.max(0, (typeof window !== 'undefined' ? window.innerHeight : 600) - 130),
  });

  const [pos, setPos] = useState(() => {
    try {
      const s = localStorage.getItem('helpdesk_btn_pos');
      if (s) return JSON.parse(s);
    } catch {}
    return defaultPos();
  });

  const posRef      = useRef(pos);
  const dragging    = useRef(false);
  const dragOffset  = useRef({ x: 0, y: 0 });
  const btnRef      = useRef(null);
  const moved       = useRef(false); // distinguish drag from click

  useEffect(() => { posRef.current = pos; }, [pos]);

  const clamp = (nx, ny) => ({
    x: Math.max(8, Math.min((typeof window !== 'undefined' ? window.innerWidth  : 800) - 64, nx)),
    y: Math.max(8, Math.min((typeof window !== 'undefined' ? window.innerHeight : 600) - 64, ny)),
  });

  const startDrag = (cx, cy) => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    dragOffset.current = { x: cx - r.left, y: cy - r.top };
    dragging.current   = true;
    moved.current      = false;
  };

  useEffect(() => {
    const onMove = (cx, cy) => {
      if (!dragging.current) return;
      moved.current = true;
      setPos(clamp(cx - dragOffset.current.x, cy - dragOffset.current.y));
    };
    const onEnd = () => {
      if (dragging.current) {
        dragging.current = false;
        try { localStorage.setItem('helpdesk_btn_pos', JSON.stringify(posRef.current)); } catch {}
      }
    };
    const mm = (e) => onMove(e.clientX, e.clientY);
    const tm = (e) => { const t = e.touches[0]; onMove(t.clientX, t.clientY); };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', tm, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', tm);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);

  // ── Data fetching ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dept/helpdesk', {
        headers: { Authorization: `Bearer ${token()}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const msgs = data.messages || [];
      setMessages(msgs);
      setUnreadCount(msgs.filter(m => m.adminResponse && !m.responseRead).length);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [load]);

  // Mark responses as read when panel opens
  useEffect(() => {
    if (!open) return;
    const unread = messages.filter(m => m.adminResponse && !m.responseRead);
    if (!unread.length) return;
    Promise.all(
      unread.map(m =>
        fetch(`/api/dept/helpdesk/${m.id}/response-read`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token()}` }
        })
      )
    ).then(() => {
      setMessages(ms => ms.map(m => ({ ...m, responseRead: m.adminResponse ? true : m.responseRead })));
      setUnreadCount(0);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Submit ───────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!form.message.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/dept/helpdesk', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || 'Failed to send.'); return; }
      toast.success('Message sent to admin.');
      setForm({ type: 'question', message: '' });
      await load();
    } catch { toast.error('Network error.'); }
    finally { setSubmitting(false); }
  };

  // ── Panel placement ──────────────────────────────────────────────────────────
  const panelStyle = () => {
    const W = 320;
    const H = 500;
    const vw = typeof window !== 'undefined' ? window.innerWidth  : 800;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 600;
    const mobile = vw < 420;
    if (mobile) return { left: 8, right: 8, bottom: 80, width: 'calc(100vw - 16px)', maxHeight: H };
    let left = pos.x + 60;
    if (left + W > vw - 12) left = pos.x - W - 8;
    if (left < 8) left = 8;
    let top = pos.y - H / 2;
    if (top + H > vh - 12) top = vh - H - 12;
    if (top < 60) top = 60;
    return { left, top, width: W, maxHeight: H };
  };

  const widget = (
    <>
      {/* Floating button */}
      <button
        ref={btnRef}
        onMouseDown={(e) => { e.preventDefault(); startDrag(e.clientX, e.clientY); }}
        onTouchStart={(e) => { const t = e.touches[0]; startDrag(t.clientX, t.clientY); }}
        onClick={() => { if (!moved.current) setOpen(o => !o); }}
        style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 9998, touchAction: 'none', userSelect: 'none' }}
        className="w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-90 text-white shadow-2xl shadow-blue-500/40 flex items-center justify-center transition-transform"
        title="Help Desk"
        aria-label="Open Help Desk"
      >
        {open ? <X size={20} /> : <LifeBuoy size={22} />}
        {!open && unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center shadow-sm animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          style={{ position: 'fixed', ...panelStyle(), zIndex: 9997, overflow: 'hidden' }}
          className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl shadow-blue-900/20 border border-blue-100 dark:border-zinc-700 flex flex-col"
        >
          {/* Header */}
          <div className="bg-blue-600 px-4 py-3 flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
              <LifeBuoy size={16} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-black text-sm leading-none">Help Desk</p>
              <p className="text-blue-200 text-[10px] mt-0.5">Questions · Suggestions · Observations</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/60 hover:text-white transition-colors p-1">
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-blue-400" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
                  <MessageSquare size={20} className="text-blue-400" />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-[200px]">
                  No messages yet. Send a question or suggestion to the admin below.
                </p>
              </div>
            ) : (
              [...messages].reverse().map(m => (
                <div key={m.id} className="space-y-1.5">
                  {/* Sent message */}
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 border border-blue-100 dark:border-blue-800/40">
                    <div className="flex items-center justify-between mb-1.5 gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                        m.type === 'question'   ? 'bg-blue-100 text-blue-700' :
                        m.type === 'suggestion' ? 'bg-purple-100 text-purple-700' :
                                                  'bg-amber-100 text-amber-700'
                      }`}>{m.type}</span>
                      <span className="text-[9px] text-muted-foreground shrink-0">{fmt(m.createdAt)}</span>
                    </div>
                    <p className="text-xs text-foreground leading-relaxed">{m.message}</p>
                    {!m.adminResponse && (
                      <div className="flex items-center gap-1 mt-1.5">
                        <Clock size={9} className="text-amber-500" />
                        <span className="text-[9px] text-amber-600 font-medium">Awaiting response</span>
                      </div>
                    )}
                  </div>

                  {/* Admin response */}
                  {m.adminResponse && (
                    <div className={`ml-3 rounded-xl p-3 border ${
                      !m.responseRead
                        ? 'bg-emerald-50 border-emerald-200 ring-1 ring-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-700'
                        : 'bg-gray-50 border-gray-100 dark:bg-zinc-800 dark:border-zinc-700'
                    }`}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <CheckCircle2 size={10} className="text-emerald-600 shrink-0" />
                        <span className="text-[9px] font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">Admin Reply</span>
                        {!m.responseRead && (
                          <span className="ml-auto text-[8px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full font-black">NEW</span>
                        )}
                        <span className="text-[9px] text-muted-foreground ml-auto">{fmt(m.respondedAt)}</span>
                      </div>
                      <p className="text-xs text-foreground leading-relaxed">{m.adminResponse}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Compose */}
          <div className="border-t border-blue-100 dark:border-zinc-700 p-3 space-y-2 shrink-0">
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full text-[11px] px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-200 font-medium"
            >
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <textarea
              value={form.message}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
              placeholder="Write your message… (Ctrl+Enter to send)"
              rows={3}
              className="w-full text-[11px] px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none leading-relaxed"
            />
            <button
              onClick={submit}
              disabled={submitting || !form.message.trim()}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-black rounded-lg transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 active:scale-95"
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              {submitting ? 'Sending…' : 'Send Message'}
            </button>
          </div>
        </div>
      )}
    </>
  );

  return createPortal(widget, document.body);
}
