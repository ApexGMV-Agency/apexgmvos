import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

/**
 * Live mirror of a report's `content` for whoever is NOT holding the edit lock.
 *
 * The editor autosaves every second or so, so a read-only viewer can simply
 * re-read the row and follow along — no reload needed. This polls rather than
 * using Realtime because `weekly_reports`/`monthly_reports` aren't in the
 * `supabase_realtime` publication, and their `content` jsonb is large enough
 * that shipping every keystroke through Realtime would be wasteful.
 *
 * It only runs while `active` (i.e. locked out), skips hidden tabs, and skips
 * the callback when nothing changed — so the cost is one small select every
 * few seconds for the handful of people watching a report being edited.
 */
export function useLiveReportContent(opts: {
  table: 'weekly_reports' | 'monthly_reports';
  id: string | undefined;
  active: boolean;
  onContent: (content: any) => void;
  intervalMs?: number;
}) {
  // 1.5s keeps the lag behind the editor's ~1.2s autosave debounce small enough
  // to read as live without hammering the table.
  const { table, id, active, onContent, intervalMs = 1500 } = opts;

  // Keep the callback in a ref so a new closure each render doesn't restart the poll.
  const onContentRef = useRef(onContent);
  onContentRef.current = onContent;
  const lastSeenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !id) { lastSeenRef.current = null; return; }
    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      inFlight = true;
      const { data, error } = await supabase.from(table).select('content').eq('id', id).single();
      inFlight = false;
      if (cancelled || error || !data) return;
      const key = JSON.stringify((data as any).content);
      if (key === lastSeenRef.current) return;   // unchanged since last poll
      lastSeenRef.current = key;
      onContentRef.current((data as any).content);
    };

    void tick();   // show the editor's current state immediately
    const timer = setInterval(() => void tick(), intervalMs);
    // Catch up right away when the viewer comes back to the tab.
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [table, id, active, intervalMs]);
}
