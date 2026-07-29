/* ════════════════════════════════════════════════════════════
   Copy-to-clipboard + lightweight toast. Self-contained (no React
   provider) so it works in every shell: the handler workspace, the
   client app, Bob/APC brand detail, and the public share link.
════════════════════════════════════════════════════════════ */

export function copyText(t: string) {
  try { if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(t); return; } } catch { /* ignore */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  } catch { /* ignore */ }
}

export type CopyKind = 'Link' | 'Email' | 'Text';

// Classify a payout value so the toast / tooltip can say the right thing.
export function payoutKind(v?: string | null): CopyKind {
  const t = (v || '').trim();
  if (!t) return 'Text';
  if (/^https?:\/\//i.test(t) || /^(www\.|paypal\.me\/|paypal\.com\/)/i.test(t)) return 'Link';
  if (t.includes('@')) return 'Email';
  return 'Text';
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string) {
  if (typeof document === 'undefined') return;
  try {
    const id = 'ac-copy-toast';
    let el = document.getElementById(id) as HTMLDivElement | null;
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      Object.assign(el.style, {
        position: 'fixed', left: '50%', bottom: '28px', zIndex: '99999',
        background: '#1f2430', color: '#fff', padding: '10px 18px', borderRadius: '999px',
        fontSize: '13px', fontWeight: '700', fontFamily: 'inherit',
        boxShadow: '0 12px 36px rgba(0,0,0,.32)', display: 'inline-flex', alignItems: 'center',
        gap: '8px', pointerEvents: 'none', transition: 'opacity .18s ease, transform .18s ease',
      } as Partial<CSSStyleDeclaration>);
      document.body.appendChild(el);
    }
    el.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#34d399" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span></span>';
    (el.querySelector('span') as HTMLElement).textContent = message;
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(8px)';
    requestAnimationFrame(() => {
      if (!el) return;
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (!el) return;
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(8px)';
    }, 1700);
  } catch { /* ignore */ }
}

// Copy text and surface a "<kind> copied" toast.
export function copyWithToast(text: string, kind?: CopyKind) {
  const t = (text || '').trim();
  if (!t) return;
  copyText(t);
  const k = kind || payoutKind(t);
  showToast(k === 'Link' ? 'Link copied' : k === 'Email' ? 'Email copied' : 'Copied');
}
