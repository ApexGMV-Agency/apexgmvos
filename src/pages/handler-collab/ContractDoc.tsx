// Section-wise HTML rendering of the Content Creation Agreement.
//
// It renders from the SAME `buildContractModel` the PDF uses (contractPdf.ts),
// so the on-screen preview and the downloaded/signed PDF can never say
// different things. Passing an `edit` API turns the numbered sections into
// editable cards (bordered, highlighted heading, top-right Edit button) and
// lets the handler add / remove / reset sections — used by the Contract
// signing-link modal.
import { useEffect, useRef } from 'react';
import type { ContractInput, CSeg, CBlock, CSection } from './contractPdf';
import { buildContractModel, fmtContractDate } from './contractPdf';

// Editing surface the modal wires in. Absent → plain read-only render.
export type ContractEditApi = {
  editingId: string | null;
  draftHeading: string;
  draftBody: string;
  onHeading: (v: string) => void;
  onBody: (v: string) => void;
  start: (section: CSection) => void;   // open the editor for a section
  save: () => void;
  cancel: () => void;
  add: () => void;                      // append a new custom section
  remove: (id: string) => void;         // delete a custom section
  reset: (id: string) => void;          // revert a built-in section to template
  busy: boolean;
  locked?: boolean;                     // signed → no editing
};

// A run of text — bold and/or a clickable link.
function Segs({ segs }: { segs: CSeg[] }) {
  return (
    <>
      {segs.map((s, i) => {
        const body = s.b ? <strong>{s.t}</strong> : <>{s.t}</>;
        const node = s.url
          ? <a href={s.url} target="_blank" rel="noreferrer" className="pc-cdoc-link">{body}</a>
          : body;
        return <span key={i}>{i > 0 ? ' ' : ''}{node}</span>;
      })}
    </>
  );
}

// A paragraph or a bullet/sub-bullet, mirroring the PDF's indent + marker.
function Block({ b }: { b: CBlock }) {
  if (b.bullet) {
    const sub = (b.indent || 0) >= 44;
    return (
      <div className={`pc-cdoc-li ${b.bullet}${sub ? ' sub' : ''}`}>
        <span className="pc-cdoc-marker" />
        <span className="pc-cdoc-litext"><Segs segs={b.segs} /></span>
      </div>
    );
  }
  return (
    <p className={`pc-cdoc-p${b.size && b.size <= 9 ? ' fine' : ''}${b.indent ? ' ind' : ''}`}><Segs segs={b.segs} /></p>
  );
}

// The blank line / embedded signature image next to a "Signature:" label.
function SigLine({ img }: { img?: string | null }) {
  return (
    <div className="pc-cdoc-sigline">
      <strong>Signature:</strong>
      {/* The signature sits ON the ruled line, the way the PDF draws it — so the
          rule WRAPS the image instead of trailing after it with a gap. */}
      <span className={`pc-cdoc-sigrule${img ? ' filled' : ''}`}>
        {img ? <img src={img} alt="Signature" className="pc-cdoc-sigimg" /> : null}
      </span>
    </div>
  );
}

// §1's featured-product + content-guide reference links (auto, not editable).
function ReferenceLinks({ facts }: { facts: any }) {
  if (!facts.prodLinks.length && !facts.guideUrl) return null;
  return (
    <div className="pc-cdoc-links">
      {facts.prodLinks.length > 0 && (
        <>
          <p className="pc-cdoc-p">
            <strong>Featured product link{facts.prodLinks.length > 1 ? 's' : ''}:</strong>
          </p>
          {facts.prodLinks.map((p: any, i: number) => (
            <div key={i} className="pc-cdoc-li dot">
              <span className="pc-cdoc-marker" />
              <span className="pc-cdoc-litext">
                <a href={p.url} target="_blank" rel="noreferrer" className="pc-cdoc-link">{p.name}</a>
                <span className="pc-cdoc-rawurl">{p.url}</span>
              </span>
            </div>
          ))}
        </>
      )}
      {facts.guideUrl && (
        <>
          <p className="pc-cdoc-p"><strong>Brand content guide:</strong></p>
          <a href={facts.guideUrl} target="_blank" rel="noreferrer" className="pc-cdoc-link pc-cdoc-guidelink">{facts.guideUrl}</a>
        </>
      )}
    </div>
  );
}

// One numbered section — plain when read-only, a bordered editable card when
// the modal passes an `edit` API.
function SectionCard({ section, index, edit, extra }: {
  section: CSection; index: number; edit?: ContractEditApi; extra?: React.ReactNode;
}) {
  const editing = !!edit && edit.editingId === section.id;

  if (editing) {
    return (
      <section className="pc-cdoc-sec editing" data-cid={section.id}>
        <div className="pc-cdoc-editbar">
          <span className="pc-cdoc-editbar-l"><i className="bi bi-pencil-square" /> Editing section</span>
          <div className="pc-cdoc-editbar-actions">
            {section.custom
              ? <button type="button" className="pc-cdoc-textbtn danger" onClick={() => edit!.remove(section.id)} disabled={edit!.busy}>Delete section</button>
              : section.edited
                ? <button type="button" className="pc-cdoc-textbtn" onClick={() => edit!.reset(section.id)} disabled={edit!.busy}>Reset to default</button>
                : null}
          </div>
        </div>
        <label className="pc-cdoc-flabel">Heading</label>
        <input className="pc-cdoc-finput" value={edit!.draftHeading} onChange={e => edit!.onHeading(e.target.value)} placeholder="Section heading" />
        <label className="pc-cdoc-flabel">Body</label>
        <textarea className="pc-cdoc-ftext" value={edit!.draftBody} onChange={e => edit!.onBody(e.target.value)} rows={9}
          placeholder={'One paragraph per line.\nStart a line with "- " for a bullet.\nWrap words in **stars** for bold, or [words](https://…) for a link.'} />
        {/* The body arrives pre-filled WITH this notation (blocksToText writes
            it), so the hint describes what is already on screen — which is what
            makes it obvious the marks are editable like any other word. */}
        <div className="pc-cdoc-fhint">
          One line per paragraph. Begin a line with <code>-</code> for a bullet (indent two spaces for a sub-bullet).
          Every word is yours to change, including the <code>and</code> / <code>or</code> between products.
          <code>**bold**</code> stays bold and <code>[words](https://…)</code> stays a link.
        </div>
        <div className="pc-cdoc-editactions">
          <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => edit!.cancel()} disabled={edit!.busy}>Cancel</button>
          <button type="button" className="pc-btn pc-btn-primary pc-btn-sm" onClick={() => edit!.save()} disabled={edit!.busy}>{edit!.busy ? 'Saving…' : 'Save section'}</button>
        </div>
      </section>
    );
  }

  const hasEdit = !!edit;
  const editable = hasEdit && !edit!.locked;
  return (
    <section className={`pc-cdoc-sec${hasEdit ? ' cardable' : ''}`} data-cid={section.id}>
      <div className="pc-cdoc-sechead">
        <h2 className="pc-cdoc-heading">{section.heading}</h2>
        {section.custom && <span className="pc-cdoc-tag custom">Custom</span>}
        {section.edited && <span className="pc-cdoc-tag edited">Edited</span>}
        {editable && (
          <button type="button" className="pc-cdoc-editbtn" onClick={() => edit!.start(section)} disabled={edit!.busy}
            title="Edit this section" aria-label={`Edit ${section.heading}`}>
            <i className="bi bi-pencil" /> Edit
          </button>
        )}
      </div>
      <div className="pc-cdoc-secbody">
        {section.blocks.map((b, i) => <Block key={i} b={b} />)}
        {index === 0 && extra}
      </div>
    </section>
  );
}

export default function ContractDoc({ input, edit }: { input: ContractInput; edit?: ContractEditApi }) {
  const model = buildContractModel(input);
  const f = model.facts;
  const creatorSigned = !!f.creatorSignatureDataUrl;
  const creatorName = (f.creatorSignedName || '').trim() || f.creatorName;
  const rootRef = useRef<HTMLDivElement>(null);

  // Bring the section being edited into view (also when the sidebar triggers it).
  useEffect(() => {
    if (!edit?.editingId || !rootRef.current) return;
    const el = rootRef.current.querySelector(`[data-cid="${edit.editingId}"]`);
    try { (el as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch { /* noop */ }
  }, [edit?.editingId]);

  const canAdd = !!edit && !edit.locked;

  return (
    <div className="pc-cdoc" ref={rootRef}>
      <h1 className="pc-cdoc-title">{model.title}</h1>

      <div className="pc-cdoc-parties">
        {model.parties.map((b, i) => <Block key={i} b={b} />)}
      </div>

      {model.sections.map((s, si) => (
        <SectionCard key={s.id} section={s} index={si} edit={edit}
          extra={<ReferenceLinks facts={f} />} />
      ))}

      {canAdd && (
        <button type="button" className="pc-cdoc-addsec" onClick={() => edit!.add()} disabled={edit!.busy}>
          <i className="bi bi-plus-lg" /> Add a section
        </button>
      )}

      {/* ── signatures ── */}
      <div className="pc-cdoc-rule" />
      <div className="pc-cdoc-sig">
        <p className="pc-cdoc-signlabel">Brand Representative</p>
        <p className="pc-cdoc-p"><strong>Brand:</strong> {f.brand}</p>
        {f.repName && <p className="pc-cdoc-p"><strong>Representative:</strong> {f.repName}</p>}
        <SigLine img={f.signatureDataUrl} />
        <p className="pc-cdoc-p"><strong>Date:</strong> {f.dateTxt}</p>
      </div>

      <div className="pc-cdoc-rule" />
      <div className="pc-cdoc-sig">
        <p className="pc-cdoc-signlabel">Creator</p>
        <p className="pc-cdoc-p"><strong>Username:</strong> {f.username || <span className="pc-cdoc-blank" />}</p>
        <p className="pc-cdoc-p"><strong>Name:</strong> {creatorName || <span className="pc-cdoc-blank" />}</p>
        {creatorSigned ? (
          <>
            <SigLine img={f.creatorSignatureDataUrl} />
            <p className="pc-cdoc-p"><strong>Date:</strong> {fmtContractDate(f.creatorSignedAt ? String(f.creatorSignedAt).slice(0, 10) : null)}</p>
            <p className="pc-cdoc-p fine">Signed electronically via the ApexGMV contract link.</p>
          </>
        ) : (
          <>
            <p className="pc-cdoc-p"><strong>Signature:</strong> <span className="pc-cdoc-blank" /></p>
            <p className="pc-cdoc-p"><strong>Date:</strong> <span className="pc-cdoc-blank" /></p>
          </>
        )}
      </div>
    </div>
  );
}
