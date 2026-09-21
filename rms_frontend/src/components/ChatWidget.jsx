import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import ResilientImage from './ResilientImage';
import {
  MessageCircle, X, ArrowLeft, Send, Users, MessageSquare,
  ChevronRight, Plus, Loader2, Mic, StopCircle, Paperclip,
  FileText, Download, ChevronDown, Reply, Forward, Copy, PenLine,
  Check, Link2, ExternalLink, Search, Share2
} from 'lucide-react';
import api from '../lib/api';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// ── helpers ───────────────────────────────────────────────────────────────────
const fmt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const fmtRecTime = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const mediaPreview = (m) =>
  m?.mediaType === 'audio' ? '🎤 Voice message'
  : m?.mediaType === 'image' ? '📷 Image'
  : m?.mediaType === 'file'  ? `📎 ${m.mediaName || 'File'}`
  : m?.reqRef ? (() => { try { return `📋 ${JSON.parse(m.reqRef)?.title || 'Request'}`; } catch { return '📋 Request'; } })()
  : m?.body || '';

const msgPreviewText = (m, myDeptId) => {
  if (!m) return '';
  const prefix = m.fromDeptId === myDeptId ? 'You: ' : '';
  return prefix + (m.body || mediaPreview(m));
};

// ── API ───────────────────────────────────────────────────────────────────────
const chatAPI = {
  conversations: () => api.get('/chat/conversations'),
  group:  (before) => api.get('/chat/group', { params: before ? { before } : {} }),
  dm:     (deptId, before) => api.get(`/chat/dm/${deptId}`, { params: before ? { before } : {} }),
  send:   (body, toDeptId, mediaKey, mediaType, mediaName, mediaMime, replyToId, reqRef) =>
    api.post('/chat/send', {
      body: body || '',
      ...(toDeptId  ? { toDeptId }                                    : {}),
      ...(mediaKey  ? { mediaKey, mediaType, mediaName, mediaMime }   : {}),
      ...(replyToId ? { replyToId }                                   : {}),
      ...(reqRef    ? { reqRef }                                      : {}),
    }),
  edit:   (id, body) => api.patch(`/chat/messages/${id}`, { body }),
  read:   (ids) => api.post('/chat/read', { messageIds: ids }),
  depts:  () => api.get('/departments'),
  upload: (formData) => api.post('/chat/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  mediaUrl: (key, download = false) =>
    `${API_BASE}/chat/media?key=${encodeURIComponent(key)}${download ? '&download=1' : ''}`,
};

// ── Avatar ────────────────────────────────────────────────────────────────────
const Avatar = ({ name, size = 8 }) => {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['bg-blue-500','bg-emerald-500','bg-purple-500','bg-amber-500','bg-rose-500','bg-cyan-500','bg-indigo-500'];
  const color = colors[(name || '').charCodeAt(0) % colors.length];
  return (
    <div className={`w-${size} h-${size} rounded-full ${color} flex items-center justify-center text-white font-bold text-[10px] shrink-0`}>
      {initials}
    </div>
  );
};

// ── MediaPreviewModal ─────────────────────────────────────────────────────────
const MediaPreviewModal = ({ msg, onClose, onForward }) => {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  if (!msg?.mediaKey) return null;
  const url = chatAPI.mediaUrl(msg.mediaKey);
  const dlUrl = chatAPI.mediaUrl(msg.mediaKey, true);

  return (
    <div className="absolute inset-0 z-50 bg-black/95 flex flex-col rounded-3xl overflow-hidden" onClick={onClose}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0 bg-black/40"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
          <X size={18} />
        </button>
        <p className="text-white text-sm font-semibold truncate max-w-[180px]">{msg.mediaName || 'Media'}</p>
        <div className="flex items-center gap-2">
          <button onClick={(e) => { e.stopPropagation(); onForward(msg); }}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors" title="Forward">
            <Forward size={16} />
          </button>
          <a href={dlUrl} download={msg.mediaName} onClick={e => e.stopPropagation()}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors" title="Download to device">
            <Download size={16} />
          </a>
        </div>
      </div>

      {/* Image preview */}
      {msg.mediaType === 'image' && (
        <div className="flex-1 flex items-center justify-center p-4 overflow-auto" onClick={e => e.stopPropagation()}>
          <ResilientImage src={url} alt={msg.mediaName || 'image'} className="max-w-full max-h-full object-contain select-none" draggable={false} />
        </div>
      )}

      {/* File preview */}
      {msg.mediaType === 'file' && (
        <div className="flex-1 flex items-center justify-center" onClick={e => e.stopPropagation()}>
          <div className="bg-white/10 rounded-3xl p-10 flex flex-col items-center gap-5 text-white">
            <FileText size={56} className="opacity-50" />
            <p className="font-bold text-lg text-center max-w-[200px] break-words">{msg.mediaName || 'File'}</p>
            <a href={dlUrl} download={msg.mediaName}
              className="flex items-center gap-2 bg-white text-black font-bold px-7 py-3 rounded-full hover:bg-white/90 transition-colors text-sm">
              <Download size={16} /> Download to device
            </a>
            <button onClick={onClose}
              className="flex items-center gap-2 px-5 py-2 rounded-full border border-white/20 text-white/70 hover:text-white hover:border-white/40 transition-colors text-sm">
              <X size={14} /> Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── ForwardModal ──────────────────────────────────────────────────────────────
const ForwardModal = ({ msg, myDeptId, onClose, onDone }) => {
  const [depts, setDepts] = useState([]);
  const [loadingDepts, setLoadingDepts] = useState(true);
  const [sending, setSending] = useState(null);

  useEffect(() => {
    chatAPI.depts()
      .then(d => setDepts(d.filter(x => x.id !== myDeptId)))
      .catch(() => {})
      .finally(() => setLoadingDepts(false));
  }, [myDeptId]);

  const doForward = async (toDeptId) => {
    if (sending !== null) return;
    const key = toDeptId ?? 'group';
    setSending(key);
    try {
      await chatAPI.send(msg.body, toDeptId, msg.mediaKey, msg.mediaType, msg.mediaName, msg.mediaMime);
      toast.success(toDeptId ? 'Forwarded!' : 'Forwarded to Group Chats!');
      onDone?.();
      onClose();
    } catch { toast.error('Failed to forward'); setSending(null); }
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/50 flex items-end rounded-3xl overflow-hidden" onClick={onClose}>
      <div className="w-full bg-card rounded-t-3xl max-h-[70%] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 shrink-0">
          <p className="font-black text-sm uppercase tracking-wide">Forward to…</p>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Preview snippet */}
        <div className="px-5 py-2 border-b border-border/20 bg-muted/20 shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Forward size={11} className="shrink-0" />
            <span className="truncate">{msg.body || mediaPreview(msg)}</span>
          </div>
        </div>

        <div className="overflow-y-auto custom-scrollbar">
          {loadingDepts && <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-muted-foreground" /></div>}

          {/* Group */}
          <button onClick={() => doForward(undefined)}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-muted/40 transition-colors border-b border-border/10 text-left">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Users size={15} className="text-primary" />
            </div>
            <span className="font-semibold text-sm flex-1">Group Chats</span>
            {sending === 'group' && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
          </button>

          {depts.map(d => (
            <button key={d.id} onClick={() => doForward(d.id)}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-muted/40 transition-colors border-b border-border/10 text-left">
              <Avatar name={d.name} size={9} />
              <span className="font-semibold text-sm flex-1">{d.name}</span>
              {sending === d.id ? <Loader2 size={13} className="animate-spin text-muted-foreground" /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── QuoteBlock — shown inside bubble when it's a reply ────────────────────────
const QuoteBlock = ({ replyTo, isMe }) => (
  <div className={`border-l-[3px] ${isMe ? 'border-white/40 bg-white/10' : 'border-primary/50 bg-primary/5'} px-3 py-1.5`}>
    <p className={`text-[9px] font-black uppercase tracking-wide mb-0.5 ${isMe ? 'text-white/60' : 'text-primary/80'}`}>
      {replyTo.fromDept?.name || '—'}
    </p>
    <p className={`text-[11px] truncate ${isMe ? 'text-white/55' : 'text-muted-foreground'}`}>
      {replyTo.body || mediaPreview(replyTo)}
    </p>
  </div>
);

// ── ReqRefCard — requisition link inside a bubble ────────────────────────────
const ReqRefCard = ({ reqRef, isMe }) => {
  let ref = null;
  try { ref = JSON.parse(reqRef); } catch { return null; }
  if (!ref) return null;

  const handleClick = () => {
    localStorage.setItem('rms_pending_requisition_id', String(ref.id));
    window.dispatchEvent(new CustomEvent('openRequisition', { detail: String(ref.id) }));
  };

  const statusColor = {
    approved: 'text-green-600', pending: 'text-amber-600',
    rejected: 'text-red-600',  treated: 'text-blue-600',
    partial:  'text-orange-600', vetting: 'text-purple-600',
    draft: 'text-gray-500',
  };

  return (
    <button type="button" onClick={handleClick}
      className={`w-full text-left px-2.5 pt-2.5 pb-2 border-b ${isMe ? 'border-white/20' : 'border-border/30'}`}>
      <div className={`flex items-start gap-2 rounded-xl px-2.5 py-2 ${isMe ? 'bg-white/10' : 'bg-primary/5 border border-primary/15'}`}>
        <div className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isMe ? 'bg-white/15' : 'bg-primary/10'}`}>
          <FileText size={13} className={isMe ? 'text-white/70' : 'text-primary'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[9px] font-black uppercase tracking-wide ${isMe ? 'text-white/50' : 'text-muted-foreground'}`}>
            Request Reference
          </p>
          <p className={`text-[12px] font-bold truncate leading-tight mt-0.5 ${isMe ? 'text-white' : 'text-foreground'}`}>
            {ref.title}
          </p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {ref.type && (
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${isMe ? 'bg-white/15 text-white/70' : 'bg-muted text-muted-foreground'}`}>
                {ref.type}
              </span>
            )}
            {ref.amount != null && (
              <span className={`text-[9px] font-semibold ${isMe ? 'text-white/60' : 'text-muted-foreground'}`}>
                ₦{Number(ref.amount).toLocaleString()}
              </span>
            )}
            {ref.status && (
              <span className={`text-[9px] font-black capitalize ${isMe ? 'text-white/60' : (statusColor[ref.status] || 'text-muted-foreground')}`}>
                {ref.status}
              </span>
            )}
          </div>
        </div>
        <ExternalLink size={11} className={`shrink-0 mt-1 ${isMe ? 'text-white/40' : 'text-primary/40'}`} />
      </div>
    </button>
  );
};

// ── ReqRefPicker — bottom sheet to pick a requisition ────────────────────────
const ReqRefPicker = ({ onSelect, onClose }) => {
  const [reqs, setReqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/requisitions', { params: { scope: 'requisitions' } })
      .then(data => setReqs(Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : [])))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = reqs.filter(r =>
    r.title?.toLowerCase().includes(search.toLowerCase()) ||
    r.type?.toLowerCase().includes(search.toLowerCase())
  );

  const statusColor = (s) => ({
    approved: 'bg-green-100 text-green-700', pending: 'bg-amber-100 text-amber-700',
    rejected: 'bg-red-100 text-red-700',     treated: 'bg-blue-100 text-blue-700',
    partial:  'bg-orange-100 text-orange-700', vetting: 'bg-purple-100 text-purple-700',
    draft: 'bg-gray-100 text-gray-600', published: 'bg-sky-100 text-sky-700',
  }[s] || 'bg-gray-100 text-gray-600');

  return (
    <div className="absolute inset-0 z-50 bg-black/50 flex items-end rounded-3xl overflow-hidden" onClick={onClose}>
      <div className="w-full bg-card rounded-t-3xl max-h-[75%] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 shrink-0">
          <p className="font-black text-sm uppercase tracking-wide">Attach Request</p>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-2 border-b border-border/20 shrink-0">
          <div className="flex items-center gap-2 bg-muted/40 rounded-xl px-3 py-2">
            <Search size={13} className="text-muted-foreground shrink-0" />
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search requests…"
              className="flex-1 bg-transparent text-sm outline-none placeholder-muted-foreground" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading && <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-muted-foreground" /></div>}
          {!loading && filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center pt-8">No requests found</p>
          )}
          {filtered.map(r => (
            <button key={r.id} onClick={() => onSelect(r)}
              className="w-full flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors border-b border-border/10 text-left">
              <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center shrink-0 mt-0.5">
                <FileText size={13} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground truncate">{r.title}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {r.type && <span className="text-[10px] text-muted-foreground">{r.type}</span>}
                  {r.amount != null && (
                    <span className="text-[10px] text-muted-foreground">₦{Number(r.amount).toLocaleString()}</span>
                  )}
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize ${statusColor(r.status)}`}>
                    {r.status}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── ActionMenu popup ──────────────────────────────────────────────────────────
const ActionMenu = ({ msg, isMe, onReply, onForward, onCopy, onEdit, onClose }) => {
  const handleShare = () => {
    const text = msg.body || (msg.mediaType === 'audio' ? 'Voice message' : msg.mediaName || 'Media');
    const url = msg.mediaKey ? chatAPI.mediaUrl(msg.mediaKey) : window.location.href;
    if (navigator.share) {
      navigator.share({ title: 'RMS Chat', text, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(msg.mediaKey ? url : text);
      toast.success('Copied to clipboard!');
    }
    onClose();
  };
  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = chatAPI.mediaUrl(msg.mediaKey, true);
    a.download = msg.mediaName || 'file';
    a.click();
    onClose();
  };
  return (
    <div className="flex flex-col overflow-hidden">
      <button onClick={() => { onReply(); onClose(); }}
        className="flex items-center gap-2.5 px-3.5 py-2.5 text-[12px] font-medium hover:bg-muted/50 transition-colors text-foreground text-left w-full">
        <Reply size={13} className="text-muted-foreground shrink-0" /> Reply
      </button>
      <button onClick={() => { onForward(); onClose(); }}
        className="flex items-center gap-2.5 px-3.5 py-2.5 text-[12px] font-medium hover:bg-muted/50 transition-colors text-foreground text-left w-full">
        <Forward size={13} className="text-muted-foreground shrink-0" /> Forward
      </button>
      {!msg.mediaKey && msg.body && (
        <button onClick={() => { onCopy(); onClose(); }}
          className="flex items-center gap-2.5 px-3.5 py-2.5 text-[12px] font-medium hover:bg-muted/50 transition-colors text-foreground text-left w-full">
          <Copy size={13} className="text-muted-foreground shrink-0" /> Copy
        </button>
      )}
      <button onClick={handleShare}
        className="flex items-center gap-2.5 px-3.5 py-2.5 text-[12px] font-medium hover:bg-muted/50 transition-colors text-foreground text-left w-full">
        <Share2 size={13} className="text-muted-foreground shrink-0" /> Share
      </button>
      {msg.mediaKey && (
        <button onClick={handleDownload}
          className="flex items-center gap-2.5 px-3.5 py-2.5 text-[12px] font-medium hover:bg-muted/50 transition-colors text-foreground text-left w-full">
          <Download size={13} className="text-muted-foreground shrink-0" /> Download
        </button>
      )}
      {isMe && !msg.mediaKey && (
        <button onClick={() => { onEdit(); onClose(); }}
          className="flex items-center gap-2.5 px-3.5 py-2.5 text-[12px] font-medium hover:bg-muted/50 transition-colors text-foreground text-left w-full">
          <PenLine size={13} className="text-muted-foreground shrink-0" /> Edit
        </button>
      )}
    </div>
  );
};

// ── Bubble ────────────────────────────────────────────────────────────────────
const Bubble = ({ msg, isMe, onReply, onForward, onPreview, onEdit }) => {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!showMenu) return;
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showMenu]);

  const hasMedia = !!msg.mediaKey;
  const mediaUrl = hasMedia ? chatAPI.mediaUrl(msg.mediaKey) : null;

  return (
    <div className={`group/bubble flex gap-1.5 items-end ${isMe ? 'flex-row-reverse' : ''}`}>
      {!isMe && <Avatar name={msg.fromDept?.name} size={6} />}

      <div className={`max-w-[72%] flex flex-col gap-0.5 ${isMe ? 'items-end' : 'items-start'}`}>
        {!isMe && (
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide pl-1">
            {msg.fromDept?.name}
          </p>
        )}

        <div className={`rounded-2xl overflow-hidden ${
          isMe ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted text-foreground rounded-bl-sm'
        }`}>
          {/* Quote */}
          {msg.replyTo && <QuoteBlock replyTo={msg.replyTo} isMe={isMe} />}

          {/* Request reference */}
          {msg.reqRef && <ReqRefCard reqRef={msg.reqRef} isMe={isMe} />}

          {/* Image — opens preview modal, never navigates */}
          {msg.mediaType === 'image' && mediaUrl && (
            <button type="button" onClick={() => onPreview(msg)} className="block w-full cursor-zoom-in focus:outline-none">
              <ResilientImage src={mediaUrl} alt={msg.mediaName || 'image'} className="max-w-full max-h-[220px] w-full object-cover" />
            </button>
          )}

          {/* Audio */}
          {msg.mediaType === 'audio' && mediaUrl && (
            <div className={`flex items-center gap-2 px-3 py-2 ${isMe ? 'text-primary-foreground' : 'text-foreground'}`}>
              <Mic size={13} className="shrink-0 opacity-60" />
              <audio controls src={mediaUrl} className="h-7" style={{ minWidth: 0, maxWidth: '180px' }} />
            </div>
          )}

          {/* File — opens preview modal */}
          {msg.mediaType === 'file' && (
            <button type="button" onClick={() => onPreview(msg)}
              className={`flex items-center gap-2 px-3 py-2.5 w-full text-left hover:opacity-75 transition-opacity ${isMe ? 'text-primary-foreground' : 'text-foreground'}`}>
              <FileText size={15} className="shrink-0 opacity-70" />
              <span className="text-[12px] font-medium truncate max-w-[140px]">{msg.mediaName || 'File'}</span>
              <Download size={11} className="shrink-0 opacity-50 ml-auto" />
            </button>
          )}

          {/* Text body */}
          {msg.body && (
            <p className="px-3 py-2 text-[13px] leading-relaxed break-words">{msg.body}</p>
          )}
        </div>

        {/* Timestamp + edited marker */}
        <div className={`flex items-center gap-1.5 px-1 ${isMe ? 'flex-row-reverse' : ''}`}>
          <p className="text-[9px] text-muted-foreground/60">{fmt(msg.createdAt)}</p>
          {msg.editedAt && <p className="text-[8px] text-muted-foreground/40 italic">edited</p>}
        </div>
      </div>

      {/* Action trigger — visible on bubble hover */}
      <div ref={menuRef} className={`relative self-end mb-5 opacity-0 group-hover/bubble:opacity-100 transition-opacity shrink-0`}>
        <button type="button" onClick={() => setShowMenu(v => !v)}
          className="w-6 h-6 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground">
          <ChevronDown size={11} />
        </button>

        {showMenu && (
          <div className={`absolute bottom-full mb-1 z-30 bg-card border border-border/60 rounded-xl shadow-2xl overflow-hidden min-w-[140px] ${isMe ? 'right-0' : 'left-0'}`}>
            <ActionMenu
              msg={msg}
              isMe={isMe}
              onReply={() => onReply(msg)}
              onForward={() => onForward(msg)}
              onCopy={() => {
                navigator.clipboard.writeText(msg.body);
                toast.success('Copied!');
              }}
              onEdit={() => onEdit(msg)}
              onClose={() => setShowMenu(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

// ── ReplyBar — shown above input when replying ────────────────────────────────
const ReplyBar = ({ replyingTo, onCancel }) => (
  <div className="px-3 pt-2 shrink-0">
    <div className="flex items-start gap-2 bg-primary/8 border border-primary/20 rounded-xl px-3 py-2">
      <div className="w-0.5 self-stretch bg-primary/60 rounded-full shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[9px] font-black text-primary uppercase tracking-wide mb-0.5">
          {replyingTo.fromDept?.name || 'Message'}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">
          {replyingTo.body || mediaPreview(replyingTo)}
        </p>
      </div>
      <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5">
        <X size={12} />
      </button>
    </div>
  </div>
);

// ── EditBar — shown above input when editing ──────────────────────────────────
const EditBar = ({ onCancel }) => (
  <div className="px-3 pt-2 shrink-0">
    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
      <PenLine size={12} className="text-amber-600 shrink-0" />
      <p className="text-[11px] text-amber-700 font-semibold flex-1">Editing message</p>
      <button onClick={onCancel} className="text-amber-500 hover:text-amber-700 transition-colors shrink-0">
        <X size={12} />
      </button>
    </div>
  </div>
);

// ── ThreadView ────────────────────────────────────────────────────────────────
const ThreadView = ({ thread, myDeptId, onBack, onNewMessage }) => {
  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState('');
  const [sending, setSending]       = useState(false);
  const [loading, setLoading]       = useState(true);

  // Media attach
  const [pendingFile, setPendingFile] = useState(null);
  const [audioBlob, setAudioBlob]     = useState(null);
  const [audioUrl, setAudioUrl]       = useState(null);

  // Voice recording
  const [recording, setRecording]   = useState(false);
  const [recSecs, setRecSecs]       = useState(0);
  const mediaRecorderRef            = useRef(null);
  const audioChunksRef              = useRef([]);

  // Action states
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [previewMsg, setPreviewMsg] = useState(null);
  const [forwardMsg, setForwardMsg] = useState(null);
  const [pendingReqRef, setPendingReqRef] = useState(null); // { id, title, type, amount, status, deptName }
  const [showReqPicker, setShowReqPicker] = useState(false);

  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const fileInputRef = useRef(null);
  const isGroup    = thread.type === 'group';

  // ── load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const data = isGroup ? await chatAPI.group() : await chatAPI.dm(thread.deptId);
      setMessages(data);
      const unread = data.filter(m => m.fromDeptId !== myDeptId && !m.readBy?.includes(myDeptId));
      if (unread.length) chatAPI.read(unread.map(m => m.id)).catch(() => {});
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [thread, isGroup, myDeptId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Recording timer
  useEffect(() => {
    if (!recording) { setRecSecs(0); return; }
    const t = setInterval(() => setRecSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // When entering edit mode, populate input
  useEffect(() => {
    if (editingMsg) { setInput(editingMsg.body); inputRef.current?.focus(); }
  }, [editingMsg]);

  // Cleanup object URLs
  useEffect(() => () => {
    if (pendingFile?.url) URL.revokeObjectURL(pendingFile.url);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, []); // eslint-disable-line

  // ── SSE handler ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      try {
        const msg = JSON.parse(e.detail);

        // Edit event — update existing message in place
        if (msg._action === 'edit') {
          setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, body: msg.body, editedAt: msg.editedAt } : m));
          return;
        }

        const belongs = isGroup
          ? !msg.toDeptId
          : msg.toDeptId && (
              (msg.fromDeptId === thread.deptId && msg.toDeptId === myDeptId) ||
              (msg.fromDeptId === myDeptId && msg.toDeptId === thread.deptId)
            );
        if (belongs) {
          setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
          if (msg.fromDeptId !== myDeptId) chatAPI.read([msg.id]).catch(() => {});
        }
      } catch {}
    };
    window.addEventListener('rms:chatMessage', handler);
    return () => window.removeEventListener('rms:chatMessage', handler);
  }, [thread, isGroup, myDeptId]);

  // ── voice recording ──────────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/ogg')  ? 'audio/ogg' : '';
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorderRef.current = mr;
      mr.start(250);
      setRecording(true);
    } catch (err) {
      toast.error(err.name === 'NotAllowedError' ? 'Microphone permission denied.' : 'Could not start recording.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current.stop();
    setRecording(false);
  };

  const cancelPending = () => {
    if (pendingFile?.url) URL.revokeObjectURL(pendingFile.url);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setPendingFile(null); setAudioBlob(null); setAudioUrl(null);
  };

  // ── send / edit ──────────────────────────────────────────────────────────────
  const handleSend = async () => {
    // ── edit mode ──
    if (editingMsg) {
      const text = input.trim();
      if (!text || sending) return;
      setSending(true);
      try {
        const updated = await chatAPI.edit(editingMsg.id, text);
        setMessages(prev => prev.map(m => m.id === editingMsg.id ? { ...m, body: updated.body, editedAt: updated.editedAt } : m));
        setEditingMsg(null);
        setInput('');
      } catch { toast.error('Failed to save edit.'); }
      finally { setSending(false); }
      return;
    }

    // ── normal send ──
    const text = input.trim();
    const hasMedia = !!(pendingFile || audioBlob);
    if ((!text && !hasMedia && !pendingReqRef) || sending || recording) return;
    setSending(true);
    const savedInput = text;
    setInput('');

    try {
      let mediaKey = null, mediaType = null, mediaName = null, mediaMime = null;

      if (pendingFile) {
        const fd = new FormData();
        fd.append('file', pendingFile.file);
        const up = await chatAPI.upload(fd);
        mediaKey = up.key; mediaType = up.type; mediaName = up.name; mediaMime = up.mime;
      } else if (audioBlob) {
        const ext = audioBlob.type.includes('ogg') ? 'ogg' : audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
        const fd = new FormData();
        fd.append('file', audioBlob, `voice-${Date.now()}.${ext}`);
        const up = await chatAPI.upload(fd);
        mediaKey = up.key; mediaType = 'audio'; mediaName = up.name; mediaMime = audioBlob.type;
      }

      const reqRefStr = pendingReqRef ? JSON.stringify(pendingReqRef) : undefined;

      const msg = await chatAPI.send(
        text,
        isGroup ? undefined : thread.deptId,
        mediaKey, mediaType, mediaName, mediaMime,
        replyingTo?.id,
        reqRefStr
      );
      setMessages(prev => [...prev, msg]);
      if (pendingFile?.url) URL.revokeObjectURL(pendingFile.url);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setPendingFile(null); setAudioBlob(null); setAudioUrl(null);
      setPendingReqRef(null);
      setReplyingTo(null);
      onNewMessage?.();
    } catch {
      toast.error('Failed to send message.');
      setInput(savedInput);
    }
    finally { setSending(false); }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isImg = file.type.startsWith('image/');
    setPendingFile({ file, url: isImg ? URL.createObjectURL(file) : null, type: isImg ? 'image' : 'file' });
    e.target.value = '';
  };

  const cancelEdit = () => { setEditingMsg(null); setInput(''); };

  return (
    <div className="relative flex flex-col h-full">
      {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 shrink-0">
          <button onClick={onBack} className="p-1 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} />
          </button>
          {isGroup
            ? <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Users size={14} className="text-primary" /></div>
            : <Avatar name={thread.deptName} size={8} />
          }
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-foreground truncate">{isGroup ? 'Group Chats' : thread.deptName}</p>
            <p className="text-[10px] text-muted-foreground">{isGroup ? 'Visible to all departments' : 'Direct message'}</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 custom-scrollbar">
          {loading && <div className="flex justify-center pt-6"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>}
          {!loading && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center pt-8">
              <MessageSquare size={28} className="text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No messages yet. Say hello!</p>
            </div>
          )}
          {messages.map(msg => (
            <Bubble
              key={msg.id}
              msg={msg}
              isMe={msg.fromDeptId === myDeptId}
              onReply={(m) => { setReplyingTo(m); inputRef.current?.focus(); }}
              onForward={(m) => setForwardMsg(m)}
              onPreview={(m) => setPreviewMsg(m)}
              onEdit={(m) => setEditingMsg(m)}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Edit bar */}
        {editingMsg && <EditBar onCancel={cancelEdit} />}

        {/* Reply bar */}
        {replyingTo && !editingMsg && <ReplyBar replyingTo={replyingTo} onCancel={() => setReplyingTo(null)} />}

        {/* Pending request reference preview */}
        {pendingReqRef && (
          <div className="px-3 pt-2 shrink-0">
            <div className="flex items-center gap-2 bg-primary/8 border border-primary/20 rounded-xl px-3 py-2">
              <Link2 size={12} className="text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-black text-primary uppercase tracking-wide">Attached Request</p>
                <p className="text-[11px] text-foreground font-semibold truncate">{pendingReqRef.title}</p>
              </div>
              <button onClick={() => setPendingReqRef(null)} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Pending media preview */}
        {(pendingFile || audioUrl) && (
          <div className="px-3 pt-2 shrink-0">
            <div className="inline-flex items-center gap-2 bg-muted/60 border border-border/40 rounded-xl px-2.5 py-1.5 max-w-full">
              {pendingFile?.type === 'image' && pendingFile.url && (
                <img src={pendingFile.url} alt="" className="w-10 h-10 object-cover rounded-lg shrink-0" />
              )}
              {pendingFile?.type === 'file' && <FileText size={15} className="text-muted-foreground shrink-0" />}
              {audioUrl && <><Mic size={13} className="text-primary shrink-0" /><audio controls src={audioUrl} className="h-6 max-w-[140px]" /></>}
              {pendingFile && <span className="text-xs text-foreground truncate max-w-[120px]">{pendingFile.file.name}</span>}
              <button onClick={cancelPending} className="w-4 h-4 rounded-full bg-muted-foreground/20 flex items-center justify-center text-muted-foreground hover:bg-rose-100 hover:text-rose-500 transition-colors shrink-0 ml-1">
                <X size={9} />
              </button>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="px-3 py-3 border-t border-border/40 shrink-0">
          <div className="flex items-end gap-1.5 bg-muted/40 rounded-2xl px-3 py-2">
            <button type="button" onClick={() => fileInputRef.current?.click()}
              disabled={!!audioBlob || recording || !!editingMsg}
              className="text-muted-foreground hover:text-primary transition-colors shrink-0 mb-0.5 disabled:opacity-30" title="Attach file or image">
              <Paperclip size={16} />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" className="hidden" onChange={handleFileSelect} />

            <button type="button" onClick={() => setShowReqPicker(true)}
              disabled={!!editingMsg || recording}
              className={`transition-colors shrink-0 mb-0.5 disabled:opacity-30 ${pendingReqRef ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}
              title="Attach a request reference">
              <Link2 size={16} />
            </button>

            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={recording ? 'Recording…' : editingMsg ? 'Edit your message…' : 'Type a message…'}
              disabled={recording}
              rows={1}
              className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground resize-none outline-none max-h-[80px] leading-relaxed disabled:opacity-40"
              style={{ minHeight: '24px' }}
              onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px'; }}
            />

            {recording && <span className="text-[10px] font-mono text-rose-500 shrink-0 mb-0.5 tabular-nums">{fmtRecTime(recSecs)}</span>}
            {!editingMsg && (
              <button type="button" onClick={recording ? stopRecording : startRecording}
                disabled={!!pendingFile || sending}
                className={`shrink-0 mb-0.5 transition-colors disabled:opacity-30 ${recording ? 'text-rose-500 animate-pulse' : 'text-muted-foreground hover:text-primary'}`}
                title={recording ? 'Stop recording' : 'Record voice note'}>
                {recording ? <StopCircle size={16} /> : <Mic size={16} />}
              </button>
            )}
            {editingMsg && (
              <button type="button" onClick={cancelEdit} className="text-muted-foreground hover:text-foreground shrink-0 mb-0.5 transition-colors" title="Cancel edit">
                <X size={16} />
              </button>
            )}

            <button type="button" onClick={handleSend}
              disabled={(!input.trim() && !pendingFile && !audioBlob && !pendingReqRef) || sending || recording}
              className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground transition-all disabled:opacity-40 shrink-0 hover:bg-primary/90">
              {sending ? <Loader2 size={13} className="animate-spin" /> : editingMsg ? <Check size={13} /> : <Send size={13} />}
            </button>
          </div>
          <p className="text-[9px] text-muted-foreground/50 text-center mt-1">Enter to send · Shift+Enter for new line</p>
        </div>

      {/* Overlays — absolute inside the widget panel so they stay within its bounds */}
      {previewMsg && (
        <MediaPreviewModal
          msg={previewMsg}
          onClose={() => setPreviewMsg(null)}
          onForward={(m) => { setPreviewMsg(null); setForwardMsg(m); }}
        />
      )}
      {forwardMsg && (
        <ForwardModal
          msg={forwardMsg}
          myDeptId={myDeptId}
          onClose={() => setForwardMsg(null)}
          onDone={onNewMessage}
        />
      )}
      {showReqPicker && (
        <ReqRefPicker
          onSelect={(r) => {
            setPendingReqRef({
              id: r.id,
              title: r.title,
              type: r.type,
              amount: r.amount ?? null,
              status: r.status,
              deptName: r.department?.name ?? null,
            });
            setShowReqPicker(false);
          }}
          onClose={() => setShowReqPicker(false)}
        />
      )}
    </div>
  );
};

// ── NewDMView ─────────────────────────────────────────────────────────────────
const NewDMView = ({ myDeptId, onSelect, onBack }) => {
  const [depts, setDepts] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    chatAPI.depts().then(d => setDepts(d.filter(x => x.id !== myDeptId))).catch(() => {});
  }, [myDeptId]);

  const filtered = depts.filter(d => d.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 shrink-0">
        <button onClick={onBack} className="p-1 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} />
        </button>
        <p className="font-bold text-sm text-foreground">New Message</p>
      </div>
      <div className="px-4 py-2 border-b border-border/20 shrink-0">
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search departments…"
          className="w-full text-sm bg-muted/40 rounded-xl px-3 py-2 outline-none placeholder-muted-foreground focus:ring-2 focus:ring-primary/30" />
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {filtered.map(d => (
          <button key={d.id} onClick={() => onSelect(d)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left border-b border-border/10">
            <Avatar name={d.name} size={8} />
            <span className="text-sm font-semibold text-foreground">{d.name}</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="text-xs text-muted-foreground text-center pt-8">No departments found</p>}
      </div>
    </div>
  );
};

// ── InboxView ─────────────────────────────────────────────────────────────────
const InboxView = ({ myDeptId, onOpenThread, onNewDM, conversations, loading }) => {
  const { group, dms } = conversations;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0">
        <p className="font-black text-sm text-foreground uppercase tracking-wide">Messages</p>
        <button onClick={onNewDM}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
          title="Start a direct message">
          <span className="text-[10px] font-black uppercase tracking-widest">Chats</span>
          <Plus size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading && <div className="flex justify-center pt-8"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>}

        {!loading && (
          <>
            <button onClick={() => onOpenThread({ type: 'group' })}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40 transition-colors border-b border-border/20 text-left">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Users size={16} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-sm text-foreground">Group Chats</p>
                  {group?.lastMessage && <p className="text-[10px] text-muted-foreground shrink-0">{fmt(group.lastMessage.createdAt)}</p>}
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {group?.lastMessage ? msgPreviewText(group.lastMessage, myDeptId) : 'Shared channel for all departments'}
                </p>
              </div>
              {group?.unread > 0 && (
                <span className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-[10px] font-black text-primary-foreground shrink-0">
                  {group.unread > 9 ? '9+' : group.unread}
                </span>
              )}
            </button>

            {dms.length > 0 && (
              <div>
                <p className="px-4 pt-3 pb-1 text-[9px] font-black text-muted-foreground uppercase tracking-widest">Direct Messages</p>
                {dms.map(dm => (
                  <button key={dm.deptId} onClick={() => onOpenThread({ type: 'dm', deptId: dm.deptId, deptName: dm.deptName })}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors border-b border-border/10 text-left">
                    <Avatar name={dm.deptName} size={10} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-sm text-foreground">{dm.deptName}</p>
                        {dm.lastMessage && <p className="text-[10px] text-muted-foreground shrink-0">{fmt(dm.lastMessage.createdAt)}</p>}
                      </div>
                      {dm.lastMessage && <p className="text-xs text-muted-foreground truncate mt-0.5">{msgPreviewText(dm.lastMessage, myDeptId)}</p>}
                    </div>
                    {dm.unread > 0 && (
                      <span className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-[10px] font-black text-primary-foreground shrink-0">
                        {dm.unread > 9 ? '9+' : dm.unread}
                      </span>
                    )}
                    <ChevronRight size={14} className="text-muted-foreground/40 shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {dms.length === 0 && !group?.lastMessage && (
              <div className="flex flex-col items-center justify-center gap-3 pt-12 px-6 text-center">
                <MessageCircle size={32} className="text-muted-foreground/20" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  No messages yet. Start a conversation or post to the group channel.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ── drag constants ────────────────────────────────────────────────────────────
const BTN = 56, PW = 340, PH = 540, GAP = 8, EDGE = 12;
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── ChatWidget (main) ─────────────────────────────────────────────────────────
export default function ChatWidget({ initialDeepLink, onDeepLinkConsumed }) {
  const { user } = useAuth();
  const myDeptId = user?.deptId ? parseInt(user.deptId) : null;
  const isActive = !!(user && user.role === 'department' && myDeptId);

  const [open, setOpen]               = useState(false);
  const [screen, setScreen]           = useState('inbox');
  const [activeThread, setActiveThread] = useState(null);
  const [conversations, setConversations] = useState({ group: { unread: 0, lastMessage: null }, dms: [] });
  const [convLoading, setConvLoading] = useState(false);
  const [totalUnread, setTotalUnread] = useState(0);

  // ── draggable position ────────────────────────────────────────────────────
  const [pos, setPos] = useState(null); // null until first paint; { x, y } = button top-left
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ on: false, sx: 0, sy: 0, bx: 0, by: 0, moved: false });

  // On mobile (< lg = 1024px) the floating nav bar sits at bottom-6 and is ~56px tall,
  // so we need at least 96px clearance to stay above it. Desktop has no bottom nav.
  const bottomClear = () => window.innerWidth < 1024 ? 96 : 24;
  const initPos = () => ({ x: window.innerWidth - BTN - 24, y: window.innerHeight - BTN - bottomClear() });

  // Set initial position and keep it in bounds on resize
  useEffect(() => {
    setPos(initPos());
    const onResize = () => setPos(p => ({
      x: clampN(p ? p.x : window.innerWidth - BTN - 24, EDGE, window.innerWidth  - BTN - EDGE),
      y: clampN(p ? p.y : window.innerHeight - BTN - bottomClear(), EDGE, window.innerHeight - BTN - EDGE),
    }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Global pointer/touch move + up listeners for drag
  useEffect(() => {
    const xy = (e) => e.touches
      ? { cx: e.touches[0].clientX, cy: e.touches[0].clientY }
      : { cx: e.clientX, cy: e.clientY };

    const onMove = (e) => {
      const d = dragRef.current;
      if (!d.on) return;
      const { cx, cy } = xy(e);
      const dx = cx - d.sx, dy = cy - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 6) return;
      if (!d.moved) { d.moved = true; if (e.cancelable) e.preventDefault(); }
      setDragging(true);
      setPos({
        x: clampN(d.bx + dx, EDGE, window.innerWidth  - BTN - EDGE),
        y: clampN(d.by + dy, EDGE, window.innerHeight - BTN - EDGE),
      });
    };

    const onUp = () => { dragRef.current.on = false; setTimeout(() => setDragging(false), 0); };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend',  onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend',  onUp);
    };
  }, []);

  const onDragStart = (e) => {
    const p = pos || initPos();
    const { cx, cy } = e.touches
      ? { cx: e.touches[0].clientX, cy: e.touches[0].clientY }
      : { cx: e.clientX, cy: e.clientY };
    dragRef.current = { on: true, sx: cx, sy: cy, bx: p.x, by: p.y, moved: false };
  };

  // Panel anchors near the button; always stays fully inside the viewport
  const panelStyle = useMemo(() => {
    if (!pos) return {};
    const vw = window.innerWidth, vh = window.innerHeight;
    // horizontal: right-align to button, then clamp
    const left = clampN(pos.x + BTN - PW, EDGE, vw - PW - EDGE);
    // vertical: prefer above button; fall back to below; last resort: best fit
    let top;
    if (pos.y - GAP >= PH + EDGE)                   top = pos.y - PH - GAP;
    else if (vh - (pos.y + BTN + GAP) >= PH + EDGE) top = pos.y + BTN + GAP;
    else                                              top = clampN(pos.y - PH - GAP, EDGE, vh - PH - EDGE);
    return { left: `${left}px`, top: `${top}px` };
  }, [pos]);
  // ─────────────────────────────────────────────────────────────────────────

  const loadConversations = useCallback(async () => {
    if (!isActive) return;
    setConvLoading(true);
    try {
      const data = await chatAPI.conversations();
      if (data && typeof data === 'object') {
        setConversations(data);
        const unread = (data.group?.unread || 0) + (data.dms || []).reduce((s, d) => s + (d.unread || 0), 0);
        setTotalUnread(unread);
      }
    } catch {}
    finally { setConvLoading(false); }
  }, [isActive]);

  useEffect(() => { if (isActive) loadConversations(); }, [isActive, loadConversations]);

  useEffect(() => {
    if (!isActive || open) return;
    const t = setInterval(loadConversations, 30000);
    return () => clearInterval(t);
  }, [isActive, open, loadConversations]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e) => {
      try {
        const msg = JSON.parse(e.detail);
        if (msg._action === 'edit' || msg.fromDeptId === myDeptId) return;
        loadConversations();
        const inRightThread = open && screen === 'thread' && (
          (!msg.toDeptId && activeThread?.type === 'group') ||
          (msg.toDeptId && activeThread?.type === 'dm' && activeThread?.deptId === msg.fromDeptId)
        );
        if (!inRightThread) {
          const label = msg.toDeptId ? msg.fromDept?.name : `📢 ${msg.fromDept?.name} (All)`;
          const preview = msg.body || mediaPreview(msg);
          toast(
            (t) => (
              <button onClick={() => {
                toast.dismiss(t.id);
                openThread(msg.toDeptId
                  ? { type: 'dm', deptId: msg.fromDeptId, deptName: msg.fromDept?.name }
                  : { type: 'group' });
              }} className="text-left w-full">
                <p className="font-bold text-xs">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">{preview}</p>
              </button>
            ),
            { icon: '💬', duration: 5000 }
          );
        }
      } catch {}
    };
    window.addEventListener('rms:chatMessage', handler);
    return () => window.removeEventListener('rms:chatMessage', handler);
  }, [isActive, open, screen, activeThread, myDeptId, loadConversations]);

  useEffect(() => {
    const link = initialDeepLink;
    if (!link || !isActive) return;
    if (link === 'group') openThread({ type: 'group' });
    else if (link.startsWith('dm:')) {
      const deptId = parseInt(link.slice(3));
      if (!isNaN(deptId)) openThread({ type: 'dm', deptId, deptName: '' });
    }
    onDeepLinkConsumed?.();
  }, [initialDeepLink, isActive]);

  const openThread = (thread) => { setActiveThread(thread); setScreen('thread'); setOpen(true); };
  const handleOpenInbox = () => { setScreen('inbox'); setOpen(true); loadConversations(); };

  if (!isActive) return null;

  const btnStyle = pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : { bottom: `${bottomClear()}px`, right: '24px' };

  return (
    <>
      {/* Floating button — draggable */}
      <button
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
        onClick={() => { if (dragRef.current.moved) return; open ? setOpen(false) : handleOpenInbox(); }}
        style={btnStyle}
        className={`fixed z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-2xl flex items-center justify-center hover:bg-primary/90 active:scale-95 select-none touch-none ${dragging ? 'cursor-grabbing shadow-xl scale-105' : 'cursor-grab'}`}
        title="Messages (drag to move)">
        {open ? <X size={22} /> : <MessageCircle size={22} />}
        {!open && totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-rose-500 border-2 border-background flex items-center justify-center text-[9px] font-black text-white pointer-events-none">
            {totalUnread > 9 ? '9+' : totalUnread}
          </span>
        )}
      </button>

      {/* Panel — floats near the button */}
      {open && (
        <div
          className="fixed z-50 w-[340px] h-[540px] bg-card border border-border/60 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in duration-200"
          style={panelStyle}
        >
          {screen === 'inbox' && (
            <InboxView myDeptId={myDeptId} conversations={conversations} loading={convLoading}
              onOpenThread={openThread} onNewDM={() => setScreen('new')} />
          )}
          {screen === 'thread' && activeThread && (
            <ThreadView thread={activeThread} myDeptId={myDeptId}
              onBack={() => { setScreen('inbox'); loadConversations(); }}
              onNewMessage={loadConversations} />
          )}
          {screen === 'new' && (
            <NewDMView myDeptId={myDeptId} onBack={() => setScreen('inbox')}
              onSelect={(dept) => openThread({ type: 'dm', deptId: dept.id, deptName: dept.name })} />
          )}
        </div>
      )}
    </>
  );
}
