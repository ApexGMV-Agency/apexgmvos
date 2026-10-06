import { useEffect, useMemo, useRef, useState } from 'react';
import ReactQuill, { Quill } from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { showToast } from '../../lib/copyToast';

const Delta = Quill.import('delta') as any;

const IMAGE_REFUSED = 'Pasted images aren\'t supported — use the image button and paste a link.';

/**
 * One Quill 2 canvas for one WRITTEN SOP section. The toolbar is our own JSX,
 * bound by an id minted per mount, so several editors on the page never share
 * a toolbar. Supports tables, checklists, colour/background, fonts and images
 * by URL; image FILES (paste or drop) are refused so nothing ends up inlined
 * as a multi-megabyte data: URI in the jsonb.
 */
export default function SopEditor({ value, onChange, placeholder }: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const [toolbarId] = useState(() => `sop-tb-${Math.random().toString(36).slice(2, 10)}`);
  const wrapRef = useRef<HTMLDivElement>(null);

  const modules = useMemo(() => ({
    table: true,
    toolbar: {
      container: `#${toolbarId}`,
      handlers: {
        image(this: any) {
          const url = window.prompt('Image URL (https://…)')?.trim();
          if (!url) return;
          if (!/^https?:\/\//i.test(url)) { showToast('Use an http(s) image link'); return; }
          const q = this.quill;
          const range = q.getSelection(true) ?? { index: q.getLength(), length: 0 };
          q.insertEmbed(range.index, 'image', url, 'user');
          q.setSelection(range.index + 1, 0, 'silent');
        },
        'table-insert'(this: any) { this.quill.getModule('table').insertTable(3, 3); },
        'table-row'(this: any) { this.quill.getModule('table').insertRowBelow(); },
        'table-col'(this: any) { this.quill.getModule('table').insertColumnRight(); },
        'table-del-row'(this: any) { this.quill.getModule('table').deleteRow(); },
        'table-del-col'(this: any) { this.quill.getModule('table').deleteColumn(); },
        'table-delete'(this: any) { this.quill.getModule('table').deleteTable(); },
      },
    },
    // No mimetypes → the uploader ignores dropped/pasted files entirely.
    uploader: { mimetypes: [] },
    clipboard: {
      matchers: [
        // Pasted HTML carrying inline image data: drop just that image.
        ['IMG', (node: HTMLImageElement, delta: any) =>
          /^(data|blob):/i.test(node.getAttribute('src') || '') ? new Delta() : delta],
      ],
    },
  }), [toolbarId]);

  // Tell the user why a pasted/dropped image file did nothing.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const hasImageFile = (dt: DataTransfer | null) =>
      !!dt && Array.from(dt.files || []).some(f => f.type.startsWith('image/'));
    const onPaste = (e: ClipboardEvent) => {
      if (hasImageFile(e.clipboardData) && !e.clipboardData?.getData('text/html')) {
        e.preventDefault(); e.stopPropagation(); showToast(IMAGE_REFUSED);
      }
    };
    const onDrop = (e: DragEvent) => {
      if (hasImageFile(e.dataTransfer)) { e.preventDefault(); e.stopPropagation(); showToast(IMAGE_REFUSED); }
    };
    el.addEventListener('paste', onPaste, true);
    el.addEventListener('drop', onDrop, true);
    return () => { el.removeEventListener('paste', onPaste, true); el.removeEventListener('drop', onDrop, true); };
  }, []);

  return (
    <div className="ac-sop-editor" ref={wrapRef}>
      <div id={toolbarId} className="ac-sop-toolbar">
        <span className="ql-formats">
          <select className="ql-header" defaultValue="">
            <option value="1" /><option value="2" /><option value="3" /><option value="" />
          </select>
          <select className="ql-font" defaultValue="">
            <option value="" /><option value="serif" /><option value="monospace" />
          </select>
        </span>
        <span className="ql-formats">
          <button type="button" className="ql-bold" /><button type="button" className="ql-italic" />
          <button type="button" className="ql-underline" /><button type="button" className="ql-strike" />
        </span>
        <span className="ql-formats">
          <select className="ql-color" /><select className="ql-background" />
        </span>
        <span className="ql-formats">
          <button type="button" className="ql-list" value="ordered" />
          <button type="button" className="ql-list" value="bullet" />
          <button type="button" className="ql-list" value="check" />
          <button type="button" className="ql-indent" value="-1" />
          <button type="button" className="ql-indent" value="+1" />
          <select className="ql-align" />
        </span>
        <span className="ql-formats">
          <button type="button" className="ql-link" />
          <button type="button" className="ql-image" title="Insert image by URL" />
          <button type="button" className="ql-blockquote" />
        </span>
        <span className="ql-formats ac-sop-tb-table">
          <button type="button" className="ql-table-insert" title="Insert a 3×3 table"><i className="bi bi-table" /></button>
          <button type="button" className="ql-table-row" title="Add row below"><i className="bi bi-plus-square" /><small>R</small></button>
          <button type="button" className="ql-table-col" title="Add column right"><i className="bi bi-plus-square" /><small>C</small></button>
          <button type="button" className="ql-table-del-row" title="Delete row"><i className="bi bi-dash-square" /><small>R</small></button>
          <button type="button" className="ql-table-del-col" title="Delete column"><i className="bi bi-dash-square" /><small>C</small></button>
          <button type="button" className="ql-table-delete" title="Delete table"><i className="bi bi-trash3" /></button>
        </span>
        <span className="ql-formats"><button type="button" className="ql-clean" /></span>
      </div>
      <ReactQuill
        theme="snow"
        modules={modules}
        value={value}
        placeholder={placeholder}
        // Only user edits count — Quill's own normalising on mount must not
        // trigger an autosave.
        onChange={(html, _delta, source) => { if (source === 'user') onChange(html); }}
      />
    </div>
  );
}
