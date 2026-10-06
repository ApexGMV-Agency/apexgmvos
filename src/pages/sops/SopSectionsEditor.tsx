import { Button, Form } from 'react-bootstrap';
import SopEditor from './SopEditor';
import { SectionBody } from './SopSectionsView';
import {
  isFixed, isWritten, newExtraSection, sectionIcon,
  type SopLive, type SopSection,
} from './sopSections';

const PLACEHOLDER: Record<string, string> = {
  gmv_max: 'Budget, ROI targets, which products get spend, creative rules…',
  discounts: 'What is running right now — codes, % off, start/end dates, which products…',
};

/**
 * Edit view. The spine cards carry a "Standard" chip and can't be removed,
 * moved or renamed; derived spine sections show a read-only live preview.
 * Extra sections keep an editable heading and move among themselves only.
 */
export default function SopSectionsEditor({ sections, live, onChange }: {
  sections: SopSection[];
  live: SopLive;
  onChange: (next: SopSection[]) => void;
}) {
  const firstExtra = sections.findIndex(s => !isFixed(s));
  const extraStart = firstExtra === -1 ? sections.length : firstExtra;

  const patch = (id: string, p: Partial<SopSection>) =>
    onChange(sections.map(s => (s.id === id ? { ...s, ...p } : s)));

  const move = (idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    if (idx < extraStart || to < extraStart || to >= sections.length) return;
    const next = sections.slice();
    [next[idx], next[to]] = [next[to], next[idx]];
    onChange(next);
  };

  const remove = (s: SopSection) => {
    if (!window.confirm(`Remove the section "${s.title}"? Its text will be lost.`)) return;
    onChange(sections.filter(x => x.id !== s.id));
  };

  return (
    <div className="ac-sop-sheet ac-sop-edit">
      {sections.map((s, i) => {
        const fixed = isFixed(s);
        const written = isWritten(s.kind);
        return (
          <section key={s.id} className="ac-sop-card">
            <div className="ac-sop-edit-head">
              <span className="ac-sop-card-num">{i + 1}</span>
              <i className={`bi ${sectionIcon(s)}`} />
              {fixed ? (
                <h2 className="ac-sop-card-title mb-0">{s.title}</h2>
              ) : (
                <Form.Control
                  className="ac-sop-title-input"
                  value={s.title}
                  maxLength={120}
                  aria-label="Section heading"
                  onChange={e => patch(s.id, { title: e.target.value })}
                />
              )}
              <div className="ms-auto d-flex align-items-center gap-1">
                {fixed ? (
                  <>
                    <span className="ac-sop-chip">Standard</span>
                    {!written && <span className="ac-sop-chip ac-sop-chip-muted"><i className="bi bi-lightning-charge" /> Live data</span>}
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="light" disabled={i <= extraStart} onClick={() => move(i, -1)} title="Move up">
                      <i className="bi bi-arrow-up" />
                    </Button>
                    <Button size="sm" variant="light" disabled={i >= sections.length - 1} onClick={() => move(i, 1)} title="Move down">
                      <i className="bi bi-arrow-down" />
                    </Button>
                    <Button size="sm" variant="light" className="text-danger" onClick={() => remove(s)} title="Remove section">
                      <i className="bi bi-trash3" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {written ? (
              <SopEditor
                value={s.body ?? ''}
                placeholder={PLACEHOLDER[s.id] ?? 'Write this section…'}
                onChange={html => patch(s.id, { body: html })}
              />
            ) : (
              <div className="ac-sop-preview">
                <div className="ac-sop-preview-note">
                  <i className="bi bi-eye" /> Filled in automatically from the brand's {
                    s.kind === 'focus_products' ? 'Products and Sample Seeding tabs'
                      : s.kind === 'tasks' ? 'scope tags'
                      : 'Resources tab'
                  } — edit it there.
                </div>
                <SectionBody section={s} live={live} />
              </div>
            )}
          </section>
        );
      })}

      <Button variant="outline-success" className="ac-sop-add" onClick={() => onChange([...sections, newExtraSection()])}>
        <i className="bi bi-plus-lg me-1" /> Add section
      </Button>
    </div>
  );
}
