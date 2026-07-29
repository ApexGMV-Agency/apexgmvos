import { useState } from 'react';
import { Button, Form, Alert, Collapse } from 'react-bootstrap';
import { parseTopVideos, ParsedTopVideo } from '../../lib/topVideoParser';

/**
 * "Paste & parse" helper for the Top Videos section. The user pastes the copied
 * rows from the TikTok Shop video list; we extract each video and hand the rows
 * back to the editor. Manual editing of the table still works alongside this.
 */
export default function VideoPasteBar({ onParsed }: { onParsed: (rows: ParsedTopVideo[]) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'warning'; text: string } | null>(null);

  const doParse = () => {
    const rows = parseTopVideos(text);
    if (rows.length === 0) {
      setMsg({ kind: 'warning', text: 'Couldn’t find any videos in the pasted text. Copy the rows from the TikTok Shop video list, or add rows manually below.' });
      return;
    }
    onParsed(rows);
    setMsg({ kind: 'success', text: `Parsed ${rows.length} video${rows.length === 1 ? '' : 's'} and filled the table below. Review, tweak if needed, then save.` });
  };

  return (
    <div className="mb-3">
      <div className="d-flex justify-content-end mb-2">
        <Button size="sm" variant="outline-info" onClick={() => setOpen(o => !o)}>
          <i className="bi bi-clipboard-plus me-1" />{open ? 'Hide paste box' : 'Paste & parse'}
        </Button>
      </div>
      <Collapse in={open}>
        <div>
          <Form.Text className="text-muted d-block mb-1">
            Copy the video rows from the TikTok Shop video list and paste them here — we’ll build each video link from the creator handle + video ID and fill Product, GMV and items sold.
          </Form.Text>
          <Form.Control
            as="textarea"
            rows={6}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Paste the copied TikTok Shop video rows here…"
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.8rem' }}
          />
          <div className="d-flex gap-2 mt-2">
            <Button size="sm" variant="primary" onClick={doParse} disabled={!text.trim()}>
              <i className="bi bi-magic me-1" />Parse &amp; fill
            </Button>
            <Button size="sm" variant="outline-secondary" onClick={() => { setText(''); setMsg(null); }}>Clear</Button>
          </div>
        </div>
      </Collapse>
      {msg && (
        <Alert variant={msg.kind} className="py-2 small mt-2 mb-0" dismissible onClose={() => setMsg(null)}>{msg.text}</Alert>
      )}
    </div>
  );
}
