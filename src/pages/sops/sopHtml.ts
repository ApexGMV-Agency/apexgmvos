import DOMPurify from 'dompurify';

/**
 * The single sanitiser for SOP HTML (app, PDF and public page). Keeps inline
 * `style` (colour, background, fonts, alignment), `class` (Quill's ql-* and
 * divider classes) and the data-* attributes Quill 2 relies on — `data-list`
 * for bullet/ordered/check lists, `data-row` for table rows. Links open in a
 * new tab.
 */
export function sopHtml(html: string | null | undefined): string {
  const clean = DOMPurify.sanitize(html ?? '', {
    ADD_ATTR: ['style', 'class', 'target', 'data-list', 'data-row'],
  });
  const tmp = document.createElement('div');
  tmp.innerHTML = clean;
  tmp.querySelectorAll('a[href]').forEach(a => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  // Quill's editor-only UI spans never belong in a rendered document.
  tmp.querySelectorAll('.ql-ui').forEach(n => n.remove());
  return tmp.innerHTML;
}
