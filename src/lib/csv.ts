// Minimal CSV helper — quotes any cell that needs it, joins with \r\n
// per RFC 4180. Triggers a download via a temporary anchor.

function quote(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map(r => r.map(quote).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  // Prepend UTF-8 BOM so Excel opens accented chars correctly.
  const csv = '﻿' + toCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
