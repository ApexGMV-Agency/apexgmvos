import './tableExportModal.css';
import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import {
  orderedColumns,
  sanitizeExcluded,
  writeTable,
  type ExportColumn,
  type ExportFormat,
} from '../../lib/tableExport';

/**
 * "Export…" — pick the rows, the file type and the columns, then get a file.
 *
 * Generic over the row type: everything specific to a table lives in the
 * `columns` registry its caller passes. Wears the `.ac-acx-*` skin, which is
 * the shared export-dialog styling (first written for the ad-code export, and
 * now the look of every export dialog).
 *
 * Everything the dialog decides is stated on the button before it runs: how
 * many rows, how many columns, and which file type. An export that turns out
 * to be the wrong half of the data is only discovered once it is open in
 * Excel, so the cost of saying it here is one line and the cost of not saying
 * it is a re-export.
 */

/** The file-type choice is stored ONCE, app-wide: it is a preference about
 *  spreadsheets ("my machine opens .csv properly"), not about which table you
 *  happened to be exporting. Column choices are per-table, hence the caller's
 *  own `storeKey`. */
const FORMAT_KEY = 'ac_export_format';

function readFormat(): ExportFormat {
  // CSV is the only format (xlsx was removed from this app).
  return 'csv';
}

function readExcluded(storeKey: string, keys: readonly string[]): Set<string> {
  try { return sanitizeExcluded(JSON.parse(localStorage.getItem(storeKey) || '[]'), keys); }
  catch { return new Set(); }
}

export default function TableExportModal<R>({
  show, onHide, title, columns, storeKey, filtered, all, filterLabel, entryWord, sheet, slug, topSlot, expandColumns, extraSheets,
}: {
  show: boolean;
  onHide: () => void;
  /** Dialog heading — name the table, not the action. */
  title: string;
  columns: readonly ExportColumn<R>[];
  /** localStorage key for THIS table's column preference. */
  storeKey: string;
  /** What the table's filters currently leave on screen. */
  filtered: readonly R[];
  /** Every row loaded, whatever the filters say. */
  all: readonly R[];
  /** Names the active filter, for the row-scope choice. */
  filterLabel: string;
  /** What one row is called here — "creator", "deal". */
  entryWord: string;
  /** Worksheet name inside an .xlsx. */
  sheet: string;
  /** Filename stem; the date and extension are added. */
  slug: string;
  /** Optional caller-owned section rendered first (e.g. a month picker). */
  topSlot?: ReactNode;
  /** Optional: turn the chosen columns into the columns actually written
   *  (e.g. one "Video links" pick → Video 1, Video 2 …). */
  expandColumns?: (chosen: ExportColumn<R>[], rows: readonly R[]) => ExportColumn<R>[];
  /** .xlsx only: extra sheets written after the main one. */
  extraSheets?: (rows: readonly R[]) => { name: string; cells: (string | number)[][]; widths?: number[] }[];
}) {
  const keys = useMemo(() => columns.map(c => c.key), [columns]);
  const [excluded, setExcluded] = useState<Set<string>>(() => readExcluded(storeKey, keys));
  const [format, setFormat] = useState<ExportFormat>(readFormat);
  const [scope, setScope] = useState<'filtered' | 'all'>('filtered');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Offered only when the two differ: with no filter active they are the same
  // list, and a control whose options do the same thing is noise.
  const canChooseScope = filtered.length !== all.length;
  const rows = canChooseScope && scope === 'all' ? all : filtered;
  const chosen = useMemo(() => orderedColumns(columns, excluded), [columns, excluded]);

  const persistExcluded = (next: Set<string>) => {
    setExcluded(next);
    try { localStorage.setItem(storeKey, JSON.stringify([...next])); }
    catch { /* private mode: session-only is fine */ }
  };
  const persistFormat = (next: ExportFormat) => {
    setFormat(next);
    try { localStorage.setItem(FORMAT_KEY, next); } catch { /* ignore */ }
  };
  const toggle = (key: string) => {
    const next = new Set(excluded);
    next.has(key) ? next.delete(key) : next.add(key);
    persistExcluded(next);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await writeTable(rows, expandColumns ? expandColumns(chosen, rows) : chosen, { format, sheet, slug, extraSheets: extraSheets ? extraSheets(rows) : undefined });
      onHide();
    } catch (e: any) {
      setError(e?.message || 'The export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={busy ? () => {} : onHide} centered size="lg">
      <Modal.Header closeButton={!busy}>
        <Modal.Title as="h5">
          <i className="bi bi-download me-2" /> {title}
        </Modal.Title>
      </Modal.Header>

      <Modal.Body className="ac-acx-body">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}

        {topSlot}

        {canChooseScope && (
          <section className="ac-acx-sec">
            <h6 className="ac-acx-head">Rows</h6>
            <div className="ac-acx-seg">
              <button type="button" className={`ac-acx-segbtn ${scope === 'filtered' ? 'on' : ''}`}
                onClick={() => setScope('filtered')}>
                {filterLabel} <span className="ac-acx-segnum">{filtered.length}</span>
              </button>
              <button type="button" className={`ac-acx-segbtn ${scope === 'all' ? 'on' : ''}`}
                onClick={() => setScope('all')}>
                Everything <span className="ac-acx-segnum">{all.length}</span>
              </button>
            </div>
          </section>
        )}


        <section className="ac-acx-sec">
          <div className="ac-acx-headrow">
            <h6 className="ac-acx-head mb-0">Columns</h6>
            <div className="ac-acx-headacts">
              <button type="button" className="ac-acx-link" onClick={() => persistExcluded(new Set())}>
                Select all
              </button>
              <span className="ac-acx-sep">·</span>
              {/* Deliberately leaves the FIRST column on: "none" is not a file
                  anyone wants, and the button is next to "Select all" where a
                  mis-click is cheap. */}
              <button type="button" className="ac-acx-link"
                onClick={() => persistExcluded(new Set(keys.slice(1)))}>
                Clear
              </button>
            </div>
          </div>
          <div className="ac-acx-grid">
            {columns.map(c => (
              <Form.Check key={c.key} type="checkbox" id={`ac-tex-${c.key}`} className="ac-acx-check"
                checked={!excluded.has(c.key)} onChange={() => toggle(c.key)}
                label={
                  <span className="ac-acx-label">
                    {c.label}
                    {c.hint && <span className="ac-acx-hint">{c.hint}</span>}
                  </span>
                } />
            ))}
          </div>
        </section>
      </Modal.Body>

      <Modal.Footer className="ac-acx-foot">
        <span className="ac-acx-summary">
          {chosen.length === 0
            ? 'Pick at least one column.'
            : `${rows.length} ${entryWord}${rows.length === 1 ? '' : 's'} · ${chosen.length} column${chosen.length === 1 ? '' : 's'} · .${format}`}
        </span>
        <div className="ac-acx-footbtns">
          <Button variant="outline-secondary" onClick={onHide} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy || !chosen.length || !rows.length}>
            {busy
              ? <><Spinner animation="border" size="sm" className="me-1" /> Building</>
              : <><i className="bi bi-download me-1" /> Export .{format}</>}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
