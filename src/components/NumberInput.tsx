import { useEffect, useRef, useState } from 'react';
import { Form } from 'react-bootstrap';

type FormControlProps = React.ComponentProps<typeof Form.Control>;
type Props = Omit<FormControlProps, 'value' | 'onChange' | 'type' | 'as'> & {
  value: number | null;
  onChange: (n: number) => void;
  /**
   * Treat zero as "not entered" — display empty unless the user actively typed it.
   * Default true: lets the user type 0 without it being eaten or producing leading zeros
   * when they later type another digit.
   */
  blankZero?: boolean;
  step?: string | number;
  min?: number | string;
  max?: number | string;
  placeholder?: string;
};

const toDisplay = (v: number | null, blankZero: boolean) => {
  if (v == null) return '';
  if (blankZero && v === 0) return '';
  return String(v);
};

export default function NumberInput({ value, onChange, blankZero = true, ...rest }: Props) {
  const [text, setText] = useState<string>(() => toDisplay(value, blankZero));
  const lastEmittedRef = useRef<number>(value ?? 0);

  // Sync from outside changes (e.g. resetting form, loading data)
  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      setText(toDisplay(value, blankZero));
      lastEmittedRef.current = value ?? 0;
    }
  }, [value, blankZero]);

  return (
    <Form.Control
      {...rest}
      type="number"
      value={text}
      // Disable mouse-wheel changing the value — scrolling the page while a
      // number input is focused must NOT alter the input. Blurring is the
      // cross-browser standard fix.
      onWheel={e => (e.currentTarget as HTMLInputElement).blur()}
      onChange={e => {
        const v = e.target.value;
        setText(v);
        const parsed = v === '' ? 0 : Number(v);
        if (Number.isFinite(parsed)) {
          lastEmittedRef.current = parsed;
          onChange(parsed);
        }
      }}
    />
  );
}
