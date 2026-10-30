import { useMemo } from 'react';

/**
 * Renders a Claude-written brief. The sandbox is the whole security model:
 * `allow-scripts` lets the page run its own JS, and WITHOUT `allow-same-origin`
 * it gets an opaque origin — no access to our cookies, localStorage (the
 * Supabase session) or the parent DOM. Never add allow-same-origin here.
 * Links open in a new tab (injected <base target="_blank">).
 */
export default function BriefFrame({ html, title, className }: { html: string; title: string; className?: string }) {
  const doc = useMemo(() => withBlankTarget(html), [html]);
  return (
    <iframe
      className={className}
      title={title}
      srcDoc={doc}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
    />
  );
}

function withBlankTarget(html: string): string {
  if (/<base\s/i.test(html)) return html;
  const base = '<base target="_blank">';
  const head = html.match(/<head[^>]*>/i);
  if (head) return html.replace(head[0], head[0] + base);
  return base + html;
}
