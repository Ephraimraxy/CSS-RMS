import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Image, X, Check, Loader2, ChevronDown } from 'lucide-react';
import { adminAPI } from '../lib/api';

const API_BASE = import.meta.env.VITE_API_URL || '';
const serveUrl = (key) => `${API_BASE}/api/admin/media/serve?key=${encodeURIComponent(key)}`;

export default function ImagePickerDropdown({ value, onChange, placeholder = 'Select an image…', className = '' }) {
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  const load = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const data = await adminAPI.listMedia();
      setImages(data || []);
    } catch { setImages([]); }
    finally { setLoading(false); }
  }, [loading]);

  useEffect(() => {
    if (open) load();
  }, [open]);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = images.find(img => serveUrl(img.key) === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border/50 bg-white hover:border-primary/40 transition-all text-left"
      >
        {value ? (
          <img src={value} alt="" className="w-7 h-7 rounded-lg object-cover shrink-0 border border-border/30" onError={e => e.target.style.display='none'} />
        ) : (
          <div className="w-7 h-7 rounded-lg bg-muted/40 border border-border/30 flex items-center justify-center shrink-0">
            <Image size={13} className="text-muted-foreground/50" />
          </div>
        )}
        <span className={`flex-1 text-sm truncate ${value ? 'text-foreground' : 'text-muted-foreground'}`}>
          {selected?.name || (value ? 'Custom URL' : placeholder)}
        </span>
        {value && (
          <button type="button" onClick={e => { e.stopPropagation(); onChange(''); }}
            className="p-0.5 rounded-md hover:bg-muted/60 text-muted-foreground/50 hover:text-muted-foreground transition-all shrink-0">
            <X size={12} />
          </button>
        )}
        <ChevronDown size={13} className={`text-muted-foreground/50 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1.5 left-0 right-0 bg-white border border-border/50 rounded-2xl shadow-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={18} className="animate-spin text-muted-foreground/40" />
            </div>
          ) : images.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-xs text-muted-foreground">No images in library yet.</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">Upload images from System Settings → Images.</p>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto p-2 grid grid-cols-3 gap-1.5">
              {images.map(img => {
                const url = serveUrl(img.key);
                const isSelected = value === url;
                return (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => { onChange(url); setOpen(false); }}
                    className={`relative group rounded-xl overflow-hidden border-2 transition-all aspect-square ${isSelected ? 'border-primary shadow-md shadow-primary/20' : 'border-transparent hover:border-primary/40'}`}
                  >
                    <img src={url} alt={img.name} className="w-full h-full object-cover" />
                    {isSelected && (
                      <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                        <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow">
                          <Check size={11} className="text-white" />
                        </div>
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-black/50 px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-[8px] text-white truncate">{img.name}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
