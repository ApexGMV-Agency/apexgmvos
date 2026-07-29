import DOMPurify from 'dompurify';

/**
 * Single sanitizer for all stored rich-text (insights, approval, custom-section
 * bodies). Allows inline `style` and `class` so the advanced Insights dividers
 * (thickness / colour / wavy & ornamental styles) survive into the read-only
 * dashboard and shared client view. Everything else stays on DOMPurify defaults.
 */
export function sanitizeRich(html: string | null | undefined): string {
  return DOMPurify.sanitize(html ?? '', { ADD_ATTR: ['style', 'class', 'target'] });
}
