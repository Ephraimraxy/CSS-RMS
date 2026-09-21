import { useState, useRef, useEffect, useCallback } from 'react';

const MAX_RETRIES = 3;

/**
 * Drop-in replacement for <img> that never shows a broken-image icon.
 *
 * When the image fails to load it retries up to MAX_RETRIES times with
 * exponential backoff (500ms → 1s → 2s). If all retries fail it shows
 * the `fallback` prop (or a default initials tile derived from `alt`).
 *
 * While loading it shows a subtle animated skeleton in the same dimensions.
 *
 * Props:
 *   src        — image URL (changing src resets retry state)
 *   alt        — alt text; first char used for initials fallback
 *   className  — applied to both the skeleton and the <img>
 *   fallback   — custom React node to show on permanent failure
 *   wrapperClassName — className on the outer wrapper div
 *   ...rest    — forwarded to <img>
 */
export default function ResilientImage({ src, alt = '', className = '', fallback, wrapperClassName = '', ...rest }) {
  const [activeSrc, setActiveSrc]   = useState(src);
  const [loading,   setLoading]     = useState(true);
  const [failed,    setFailed]      = useState(false);
  const retryCount  = useRef(0);
  const timerRef    = useRef(null);

  // Reset when src changes
  useEffect(() => {
    retryCount.current = 0;
    setActiveSrc(src);
    setLoading(true);
    setFailed(false);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [src]);

  const handleError = useCallback(() => {
    if (retryCount.current >= MAX_RETRIES) {
      setFailed(true);
      setLoading(false);
      return;
    }
    const delay = 500 * Math.pow(2, retryCount.current); // 500ms, 1s, 2s
    retryCount.current += 1;
    timerRef.current = setTimeout(() => {
      // Append a retry counter to bypass any in-flight browser cache entry
      try {
        const url = new URL(activeSrc, window.location.href);
        url.searchParams.set('_retry', retryCount.current);
        setActiveSrc(url.toString());
      } catch {
        setActiveSrc(activeSrc + (activeSrc.includes('?') ? '&' : '?') + `_retry=${retryCount.current}`);
      }
    }, delay);
  }, [activeSrc]);

  const initials = (alt || '?')[0].toUpperCase();

  const defaultFallback = (
    <div
      className={`flex items-center justify-center bg-primary/10 text-primary font-black text-xs select-none ${className}`}
      aria-label={alt}
      title={alt}
    >
      {initials}
    </div>
  );

  if (failed) return fallback || defaultFallback;

  return (
    <div className={`relative ${wrapperClassName}`} style={{ display: 'contents' }}>
      {loading && (
        <div
          className={`absolute inset-0 bg-muted animate-pulse rounded-[inherit] ${className}`}
          aria-hidden="true"
        />
      )}
      <img
        src={activeSrc}
        alt={alt}
        className={className}
        style={{ opacity: loading ? 0 : 1, transition: 'opacity 0.2s' }}
        onLoad={() => setLoading(false)}
        onError={handleError}
        {...rest}
      />
    </div>
  );
}
