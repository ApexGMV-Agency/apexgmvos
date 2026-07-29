import { useEffect, useRef, useState } from 'react';
import { Form } from 'react-bootstrap';

/**
 * Nullable numeric input for the v2 report form.
 * Emits `null` when the field is cleared (so "not entered" stays distinct from a
 * real 0), and avoids the leading-zero bug by keeping its own text state.
 */
export default function NumField({
  value, onChange, size, step, min, max, placeholder = '—', disabled,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  size?: 'sm' | 'lg';
  step?: string | number;
  min?: number | string;
  max?: number | string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const toText = (v: number | null) => (v == null ? '' : String(v));
  const [text, setText] = useState<string>(() => toText(value));
  const last = useRef<number | null>(value);

  useEffect(() => {
    if (value !== last.current) {
      setText(toText(value));
      last.current = value;
    }
  }, [value]);

  return (
    <Form.Control
      type="number"
      size={size}
      step={step}
      min={min}
      max={max}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onWheel={e => (e.currentTarget as HTMLInputElement).blur()}
      onChange={e => {
        const v = e.target.value;
        setText(v);
        if (v === '') { last.current = null; onChange(null); return; }
        const n = Number(v);
        if (Number.isFinite(n)) { last.current = n; onChange(n); }
      }}
    />
  );
}
