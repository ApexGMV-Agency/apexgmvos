import { useDraggable } from '@dnd-kit/core';
import { BlockType, METRIC_CATALOG, SECTION_PRESETS } from '../../lib/reportingCanvas';
import { Badge } from 'react-bootstrap';

interface ToolboxItem {
  type: BlockType;
  icon: string;
  label: string;
  note: string;
}

const ITEMS: ToolboxItem[] = [
  { type: 'heading',  icon: 'bi-type-h1',         label: 'Heading',   note: 'Section title' },
  { type: 'text',     icon: 'bi-text-paragraph',  label: 'Text',      note: 'Paragraph / rich text' },
  { type: 'image',    icon: 'bi-image',           label: 'Image',     note: 'Logo or visual' },
  { type: 'kpi',      icon: 'bi-bar-chart-line',  label: 'KPI',       note: 'Single big number' },
  { type: 'metric',   icon: 'bi-calculator',      label: 'Metric',    note: 'Bound to catalog' },
  { type: 'table',    icon: 'bi-table',           label: 'Table',     note: 'Rows + columns' },
  { type: 'chart',    icon: 'bi-graph-up-arrow',  label: 'Chart',     note: 'Line / bar / area' },
  { type: 'divider',  icon: 'bi-hr',              label: 'Divider',   note: 'Section break' },
  { type: 'spacer',   icon: 'bi-arrows-vertical', label: 'Spacer',    note: 'Vertical gap' },
];

interface ToolboxProps {
  onInsertSection?: (presetKey: string) => void;
}

export default function Toolbox({ onInsertSection }: ToolboxProps) {
  return (
    <div className="border-end bg-light" style={{ width: 240, overflowY: 'auto', flexShrink: 0 }}>
      <div className="px-3 py-2 border-bottom small fw-bold text-uppercase text-muted">
        <i className="bi bi-grid-3x3-gap me-1" />Blocks
      </div>
      <div className="p-2">
        {ITEMS.map(item => (
          <DraggableToolboxItem key={item.type} item={item} />
        ))}
      </div>

      {onInsertSection && (
        <>
          <div className="px-3 py-2 border-top border-bottom small fw-bold text-uppercase text-muted">
            <i className="bi bi-layout-text-window me-1" />Sections
          </div>
          <div className="p-2">
            {SECTION_PRESETS.map(s => (
              <button
                key={s.key}
                type="button"
                className="d-flex align-items-center gap-2 px-2 py-2 rounded bg-white border mb-1 w-100 text-start ac-canvas-toolbox-item"
                onClick={() => onInsertSection(s.key)}
                title={`Insert "${s.label}" section`}
              >
                <i className={`bi ${s.icon} fs-5 text-warning`} />
                <div className="flex-grow-1 min-w-0">
                  <div className="small fw-semibold">{s.label}</div>
                  <div className="text-muted" style={{ fontSize: '.7rem' }}>{s.description}</div>
                </div>
                <i className="bi bi-plus-circle text-muted" />
              </button>
            ))}
          </div>
        </>
      )}

      <div className="px-3 py-2 border-top border-bottom small fw-bold text-uppercase text-muted">
        <i className="bi bi-bookmark-star me-1" />Metric catalog
      </div>
      <div className="p-2 small">
        {METRIC_CATALOG.slice(0, 8).map(m => (
          <div key={m.key} className="d-flex justify-content-between mb-1">
            <span>{m.label}</span>
            <Badge bg="light" text="dark" className="border" style={{ fontSize: '.65rem' }}>
              {m.format}
            </Badge>
          </div>
        ))}
        <div className="text-muted small mt-2">
          + {METRIC_CATALOG.length - 8} more — pick any from the Metric block's properties.
        </div>
      </div>
    </div>
  );
}

function DraggableToolboxItem({ item }: { item: ToolboxItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `toolbox:${item.type}`,
    data: { kind: 'toolbox', type: item.type },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="d-flex align-items-center gap-2 px-2 py-2 rounded bg-white border mb-1 ac-canvas-toolbox-item"
      style={{
        cursor: 'grab',
        opacity: isDragging ? 0.4 : 1,
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <i className={`bi ${item.icon} fs-5 text-primary`} />
      <div className="flex-grow-1 min-w-0">
        <div className="small fw-semibold">{item.label}</div>
        <div className="text-muted" style={{ fontSize: '.7rem' }}>{item.note}</div>
      </div>
      <i className="bi bi-grip-vertical text-muted" style={{ fontSize: '.85rem' }} />
    </div>
  );
}
