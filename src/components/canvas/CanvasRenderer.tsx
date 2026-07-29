import { CanvasSchema, CanvasBlock as Block, MetricBag } from '../../lib/reportingCanvas';
import CanvasBlockView from './CanvasBlock';

interface Props {
  schema: CanvasSchema;
  metricBag?: MetricBag;
  currency?: string;
  /** Add print-friendly background (no grid pattern, white). */
  print?: boolean;
}

/**
 * Read-only canvas renderer. Used in report-view pages to display a published
 * template populated with real metric data. Has NO DnD context, NO selection,
 * NO inline editing — drag/resize handlers no-op via `readOnly`.
 */
export default function CanvasRenderer({ schema, metricBag, currency, print }: Props) {
  const padding = schema.canvas.padding ?? 32;
  return (
    <div className="d-flex justify-content-center">
      <div
        className={`shadow-sm rounded position-relative ${print ? '' : 'ac-canvas-surface'}`}
        style={{
          width: schema.canvas.width,
          maxWidth: '100%',
          minHeight: 400,
          background: schema.canvas.background ?? '#fff',
          padding,
        }}
      >
        {schema.blocks.map(b => (
          <CanvasBlockView
            key={b.id}
            block={b}
            canvasWidth={schema.canvas.width}
            selected={false}
            readOnly
            metricBag={metricBag}
            currency={currency}
            onSelect={() => {}}
            onChange={() => {}}
            onDelete={() => {}}
          />
        ))}
        {schema.blocks.length === 0 && (
          <div className="text-center text-muted py-5 small">
            <i className="bi bi-easel2 fs-3 d-block mb-1 opacity-50" />
            This template has no blocks yet.
          </div>
        )}
      </div>
    </div>
  );
}
