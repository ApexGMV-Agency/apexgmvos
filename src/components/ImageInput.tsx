import { useRef, useState } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { uploadReportImage } from '../lib/imageUpload';

interface Props {
  value: string;                                       // current image URL ('' if none)
  onChange: (url: string) => void;
  brandId?: string;
  reportType?: 'weekly' | 'monthly';
  /** Hint shown when no image is uploaded */
  placeholder?: string;
}

export default function ImageInput({ value, onChange, brandId, reportType = 'monthly', placeholder = 'Upload an image' }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErr('Pick an image file (PNG, JPG, etc.)');
      return;
    }
    setErr(null);
    setUploading(true);
    try {
      const url = await uploadReportImage(file, { brandId, reportType });
      onChange(url);
    } catch (e: any) {
      setErr(e?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="ac-image-input">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      {value ? (
        <div className="d-flex align-items-start gap-2">
          <img src={value} alt="Section image" style={{ maxWidth: 280, maxHeight: 180, borderRadius: 8, border: '1px solid #e5e7eb' }} />
          <div className="d-flex flex-column gap-1">
            <Button size="sm" variant="outline-primary" disabled={uploading} onClick={() => inputRef.current?.click()}>
              <i className="bi bi-arrow-repeat me-1" /> Replace
            </Button>
            <Button size="sm" variant="outline-danger" disabled={uploading} onClick={() => onChange('')}>
              <i className="bi bi-trash me-1" /> Remove
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline-secondary" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <><Spinner as="span" animation="border" size="sm" className="me-1" /> Uploading…</> : <><i className="bi bi-image me-1" /> {placeholder}</>}
        </Button>
      )}
      {err && <div className="small text-danger mt-1">{err}</div>}
    </div>
  );
}
