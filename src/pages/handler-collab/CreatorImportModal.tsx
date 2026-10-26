/* ════════════════════════════════════════════════════════════
   Creators Database — import a spreadsheet.

   Pick a .csv, see exactly what it will do, then let it do it.

   ‼️ EVERY DECISION IS IN `lib/creatorDbImport`, which is pure. This file
   reads the bytes, shows the verdict and drives the writes; it decides
   nothing about what a column means or which row counts as a duplicate. That
   split is what lets the rules be checked without a browser.

   ‼️ NOTHING IS WRITTEN UNTIL THE REVIEW STEP IS PASSED. Picking a file
   parses it and shows the outcome row by row; the import only runs on a
   second, deliberate click. An import is not undoable in bulk — the only way
   back is deleting the rows one at a time — so "see it before it happens" is
   the guard rail, not a confirm dialog after the fact.
════════════════════════════════════════════════════════════ */
import React, { useMemo, useRef, useState } from 'react';
import * as store from './store';
import { downloadCsv, parseCsv } from '../../lib/csv';
import {
  IMPORT_FIELDS, TEMPLATE_EXAMPLE, TEMPLATE_HEADERS,
  parseCreatorSheet, rowsToWrite,
  type ParseResult, type ParsedCreator,
} from '../../lib/creatorDbImport';

const ACCEPT = '.csv,text/csv';

/* The first sheet as a grid of strings.
   `raw: false` asks for the FORMATTED value, so a date cell arrives as the
   date somebody sees in Excel rather than a serial number, and a phone number
   keeps its leading zero. CSV is read as text and de-BOM'd first: our own
   export writes a BOM (so Excel reads it as UTF-8), and left in place it
   becomes part of the first header, which then matches nothing. */
async function readGrid(file: File): Promise<unknown[][]> {
  // CSV only (xlsx was removed from this app). Excel / Sheets: File → Download → CSV.
  if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
    throw new Error('Please upload a .csv file — in Excel or Google Sheets use File → Download → CSV.');
  }
  return parseCsv(await file.text());
}

function downloadTemplate() {
  downloadCsv('apexgmv-creators-import-template.csv', [TEMPLATE_HEADERS, TEMPLATE_EXAMPLE]);
}

const STATUS_META: Record<ParsedCreator['status'], { label: string; cls: string }> = {
  new: { label: 'Will be added', cls: 'ok' },
  existing: { label: 'Already in the database', cls: 'dup' },
  duplicate: { label: 'Repeated in this file', cls: 'dup' },
  refused: { label: 'Cannot be imported', cls: 'bad' },
};

export interface CreatorImportModalProps {
  /** Identities already BANKED, keyed by `store.creatorGlobalKey`. */
  bankedKeys: ReadonlySet<string>;
  /** Identities known from deals but never banked — importing those is still
      an insert, it just is not a stranger. */
  knownKeys?: ReadonlySet<string>;
  /** Banked identity → the `creator_directory` row id, for the update path. */
  dirIdByKey: Record<string, string>;
  handlerName?: string;
  onClose: () => void;
  /** Called once anything landed, so the caller can re-read the directory. */
  onImported: () => void | Promise<void>;
}

export default function CreatorImportModal({
  bankedKeys, knownKeys, dirIdByKey, handlerName = '', onClose, onImported,
}: CreatorImportModalProps) {
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [report, setReport] = useState<{ added: number; updated: number; skipped: number; failed: { line: number; message: string }[] } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const willWrite = useMemo(
    () => (result ? rowsToWrite(result, updateExisting) : []),
    [result, updateExisting],
  );

  async function take(file: File | null | undefined) {
    if (!file) return;
    setReading(true); setErr(''); setResult(null); setReport(null);
    setFileName(file.name);
    try {
      const grid = await readGrid(file);
      const parsed = parseCreatorSheet(grid, {
        keyOf: store.creatorGlobalKey,
        existingKeys: bankedKeys,
        knownKeys,
      });
      if (!parsed.ok) setErr(parsed.error || 'That file could not be read.');
      setResult(parsed);
    } catch (e: any) {
      setErr(e?.message || 'That file could not be read.');
    } finally {
      setReading(false);
    }
  }

  async function run() {
    if (!result || busy || !willWrite.length) return;
    setBusy(true); setErr('');
    const adds = willWrite.filter(r => r.status === 'new');
    const updates = willWrite.filter(r => r.status === 'existing');
    setProgress({ done: 0, total: adds.length + updates.length });
    const failed: { line: number; message: string }[] = [];
    let added = 0, updated = 0;

    try {
      if (adds.length) {
        const res = await store.addDirectoryCreatorsBulk(
          adds.map(r => r.data), handlerName,
          (done) => setProgress(p => ({ ...p, done })),
        );
        added = res.inserted.length;
        res.failed.forEach(f => failed.push({ line: adds[f.index]?.line ?? 0, message: f.message }));
      }
      /* Updates go one at a time: they are keyed by row id, there is no
         multi-row UPDATE to batch them into, and an import that updates is
         the rarer half. */
      for (const r of updates) {
        try {
          /* A banked identity always has a row id — the set and the map are
             built from the same list. Guarded anyway rather than letting an
             undefined id reach `.eq('id', …)`, where the failure would read as
             a server error instead of a stale list. */
          const id = dirIdByKey[r.key];
          if (!id) throw new Error('That entry is no longer in the database — reopen this dialog and try again.');
          await store.updateDirectoryCreator(id, r.data);
          updated++;
        } catch (e: any) {
          failed.push({ line: r.line, message: e?.message || 'Could not save' });
        }
        setProgress(p => ({ ...p, done: p.done + 1 }));
      }
      setReport({
        added, updated,
        skipped: result.counts.total - added - updated - failed.length,
        failed,
      });
      if (added || updated) await onImported();
    } catch (e: any) {
      setErr(e?.message || 'The import stopped part way through.');
    } finally {
      setBusy(false);
    }
  }

  const counts = result?.counts;

  return (
    <div className={`pc-overlay ${busy ? 'is-busy' : ''}`} onClick={busy ? undefined : onClose}>
      <div className="pc-modal pc-modal-scroll pc-cdb-modal pc-imp-modal" onClick={e => e.stopPropagation()}>
        <h3>Import creators</h3>
        <div className="pc-modal-sub">
          From a .csv or Excel file. Nothing is saved until you press Import.
        </div>

        <div className="pc-modal-body">
          {err && <div className="pc-inline-err">{err}</div>}

          {report ? (
            <div className="pc-imp-report">
              <div className="pc-imp-done"><i className="bi bi-check-circle-fill" /> Import finished</div>
              <ul className="pc-imp-lines">
                <li><b>{report.added}</b> creator{report.added === 1 ? '' : 's'} added</li>
                {report.updated > 0 && <li><b>{report.updated}</b> existing entr{report.updated === 1 ? 'y' : 'ies'} updated</li>}
                {report.skipped > 0 && <li><b>{report.skipped}</b> row{report.skipped === 1 ? '' : 's'} skipped</li>}
                {report.failed.length > 0 && (
                  <li className="bad">
                    <b>{report.failed.length}</b> row{report.failed.length === 1 ? '' : 's'} could not be saved:
                    <ul>{report.failed.slice(0, 8).map((f, i) => <li key={i}>Row {f.line} — {f.message}</li>)}</ul>
                  </li>
                )}
              </ul>
            </div>
          ) : (
            <>
              {/* ── pick ── */}
              <div
                className={`pc-imp-drop ${drag ? 'over' : ''}`}
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); take(e.dataTransfer?.files?.[0]); }}
                onClick={() => inputRef.current?.click()}
                role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
              >
                <i className={`bi ${reading ? 'bi-arrow-repeat' : 'bi-filetype-csv'}`} />
                <div className="pc-imp-droptxt">
                  {reading ? 'Reading the file…'
                    : fileName ? <><b>{fileName}</b><span>Click or drop another file to replace it</span></>
                      : <><b>Choose a file, or drop one here</b><span>.csv — from Excel or Sheets use File → Download → CSV</span></>}
                </div>
                <input ref={inputRef} type="file" accept={ACCEPT} hidden
                  onChange={e => { take(e.target.files?.[0]); e.target.value = ''; }} />
              </div>

              {!result && (
                <div className="pc-imp-help">
                  <div className="pc-imp-helphead">The first row should name the columns. These are read:</div>
                  <div className="pc-imp-fields">
                    {IMPORT_FIELDS.map(f => (
                      <span key={f.key} className="pc-imp-field" title={f.hint || ''}>
                        {f.label}{f.key === 'name' && <em> required</em>}
                      </span>
                    ))}
                  </div>
                  <div className="pc-sig-hint">
                    Spelling is forgiving — “Handle”, “Niche” and “Phone number” all land in the right place, and any
                    column we do not recognise is ignored rather than guessed at.
                  </div>
                  <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={downloadTemplate}>
                    <i className="bi bi-download" style={{ marginRight: 6 }} />Download a template
                  </button>
                </div>
              )}

              {/* ── review ── */}
              {result?.ok && counts && (
                <>
                  <div className="pc-imp-counts">
                    <span className="pc-imp-count ok"><b>{counts.new}</b> to add</span>
                    {counts.existing > 0 && <span className="pc-imp-count dup"><b>{counts.existing}</b> already on record</span>}
                    {counts.duplicate > 0 && <span className="pc-imp-count dup"><b>{counts.duplicate}</b> repeated in the file</span>}
                    {counts.refused > 0 && <span className="pc-imp-count bad"><b>{counts.refused}</b> unusable</span>}
                    <span className="pc-imp-count"><b>{counts.total}</b> rows read</span>
                  </div>

                  <div className="pc-imp-map">
                    <b>Columns matched:</b> {result.matched.map(m => m.field.label).join(', ') || '—'}
                    {result.ignored.length > 0 && (
                      <div className="pc-sig-hint">
                        Ignored: {result.ignored.join(', ')} — nothing in the database stores these.
                      </div>
                    )}
                  </div>

                  {counts.existing > 0 && (
                    <label className="pc-imp-upd">
                      <input type="checkbox" checked={updateExisting} disabled={busy}
                        onChange={e => setUpdateExisting(e.target.checked)} />
                      <span>
                        <b>Update the {counts.existing} creator{counts.existing === 1 ? '' : 's'} already on record</b>
                        <em>Their details are replaced with what this file says. Off by default: an import is usually a
                          list of new people, and overwriting a colleague’s curated entry is not undoable.</em>
                      </span>
                    </label>
                  )}

                  <div className="pc-imp-tablewrap">
                    <table className="pc-imp-table">
                      <thead>
                        <tr><th>Row</th><th>Name</th><th>Handle</th><th>Contact</th><th>Outcome</th></tr>
                      </thead>
                      <tbody>
                        {result.rows.map(r => {
                          const meta = STATUS_META[r.status];
                          const writing = willWrite.includes(r);
                          return (
                            <tr key={r.line} className={meta.cls}>
                              <td className="pc-imp-line">{r.line}</td>
                              <td>{r.data.name || <i>—</i>}</td>
                              <td className="pc-imp-handle">{r.data.tiktok_handle.split('\n')[0] || '—'}</td>
                              <td className="pc-imp-contact">{[r.data.email, r.data.phone].filter(Boolean).join(' · ') || '—'}</td>
                              <td>
                                <span className={`pc-imp-chip ${meta.cls}`}>
                                  {writing && r.status === 'existing' ? 'Will be updated' : meta.label}
                                </span>
                                {r.reason && r.status !== 'new' && <div className="pc-imp-why">{r.reason}</div>}
                                {r.warnings.map((w, i) => <div key={i} className="pc-imp-warn">{w}</div>)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="pc-modal-actions">
          {report ? (
            <button className="pc-btn pc-btn-primary" onClick={onClose}>Done</button>
          ) : (
            <>
              <button className="pc-btn pc-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="pc-btn pc-btn-primary" onClick={run} disabled={busy || !willWrite.length}>
                {busy
                  ? `Importing… ${progress.done}/${progress.total}`
                  : willWrite.length
                    ? `Import ${willWrite.length} creator${willWrite.length === 1 ? '' : 's'}`
                    : 'Nothing to import'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
