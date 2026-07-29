import type { NavigateFunction } from 'react-router-dom';

/**
 * Go back one entry in history (so the Back button returns to wherever the user
 * came from — brand detail, chat, a task deep link, …). Falls back to the given
 * route when there is nothing to go back to (direct link / fresh tab).
 */
export function goBack(nav: NavigateFunction, fallback: string) {
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  if (typeof idx === 'number' ? idx > 0 : window.history.length > 1) nav(-1);
  else nav(fallback);
}
