import { useDroppable } from '@dnd-kit/core';
import { CanvasSchema, CanvasBlock as Block, MetricBag } from '../../lib/reportingCanvas';
import CanvasBlockView from './CanvasBlock';

interface Props {
  schema: CanvasSchema;
  selectedId: string | null;
  readOnly?: boolean;
  metricBag?: MetricBag;
  currency?: string;
  onSelect: (id: string | null) => void;
  onBlockChange: (b: Block) => void;
  onBlockDelete: (id: string) => void;
  canvasRef?: (el: HTMLDivElement | null) => void;
}

export default function CanvasArea({
  schema, selectedId, readOnly, metricBag, currency, onSelect, onBlockChange, onBlockDelete, canvasRef,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas-surface', disabled: readOnly });
  const padding = schema.canvas.padding ?? 32;

  return (
    <div
      className="flex-grow-1 overflow-auto"
      style={{ background: '#f3f4f6' }}
      onPointerDown={(e) => {
        // Deselect when clicking the workspace background.
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      <div className="d-flex justify-content-center py-4 px-3">
        <div
          ref={(n) => { setNodeRef(n); canvasRef?.(n); }}
          id="canvas-surface"
          className="shadow-sm rounded position-relative ac-canvas-surface"
          style={{
            width: schema.canvas.width,
            minHeight: 800,
            background: schema.canvas.background ?? '#fff',
            padding,
            outline: isOver ? '2px dashed #e8862e' : 'none',
            outlineOffset: '-2px',
          }}
          onPointerDown={(e) => {
            // Clicking empty canvas deselects.
            if (e.target === e.currentTarget) onSelect(null);
          }}
        >
          {schema.blocks.length === 0 && (
            <div className="text-center text-muted py-5 my-5" style={{ pointerEvents: 'none' }}>
              <i className="bi bi-easel2 fs-1 d-block mb-2 opacity-50" />
              <div className="fw-bold mb-1">Canvas is empty</div>
              <div className="small">Drag blocks from the left panel to start designing your template.</div>
            </div>
          )}

          {schema.blocks.map(b => (
            <CanvasBlockView
              key={b.id}
              block={b}
              canvasWidth={schema.canvas.width}
              selected={selectedId === b.id}
              readOnly={readOnly}
              metricBag={metricBag}
              currency={currency}
              onSelect={() => onSelect(b.id)}
              onChange={onBlockChange}
              onDelete={() => onBlockDelete(b.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
