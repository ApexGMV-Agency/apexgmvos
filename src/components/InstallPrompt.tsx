import { useEffect, useState } from 'react';

/**
 * PWA install banner. Appears when the browser fires `beforeinstallprompt`
 * (i.e. the app is installable and not already installed). Self-contained
 * inline styles so it works regardless of the app's stylesheet.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return localStorage.getItem('ac_pwa_dismissed') === '1'; } catch { return false; }
  });

  useEffect(() => {
    const onPrompt = (e: any) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => {
      setDeferred(null);
      try { localStorage.setItem('ac_pwa_dismissed', '1'); } catch { /* ignore */ }
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!deferred || hidden) return null;

  const install = async () => {
    try { deferred.prompt(); await deferred.userChoice; } catch { /* ignore */ }
    setDeferred(null);
  };
  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem('ac_pwa_dismissed', '1'); } catch { /* ignore */ }
  };

  const wrap: React.CSSProperties = {
    position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 1090,
    display: 'flex', alignItems: 'center', gap: 12, width: 'calc(100% - 24px)', maxWidth: 440,
    background: 'var(--ac-surface-raised)', border: '1px solid var(--ac-border)', borderRadius: 14, padding: '12px 14px',
    boxShadow: '0 14px 38px rgba(0,0,0,.65)',
  };

  return (
    <div style={wrap} role="dialog" aria-label="Install ApexGMVOS">
      <img src="/web-app-manifest-192x192.png" alt="" width={44} height={44} style={{ borderRadius: 11, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--ac-text-primary)' }}>Install ApexGMVOS</div>
        <div style={{ fontSize: '.82rem', color: 'var(--ac-text-secondary)' }}>Add it to your device for quick, app-like access.</div>
      </div>
      <button className="btn btn-primary btn-sm" onClick={install} style={{ whiteSpace: 'nowrap' }}>
        <i className="bi bi-download me-1" />Install
      </button>
      <button onClick={dismiss} aria-label="Dismiss"
        style={{ border: 0, background: 'transparent', color: 'var(--ac-text-secondary)', fontSize: '.9rem', padding: 4, cursor: 'pointer' }}>
        <i className="bi bi-x-lg" />
      </button>
    </div>
  );
}
