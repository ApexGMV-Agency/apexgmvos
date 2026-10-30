import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Spinner } from 'react-bootstrap';
import BriefFrame from './BriefFrame';
import { loadSharedBrief, type SharedBrief as SharedBriefData } from './briefApi';
import './briefs.css';

/** Public, read-only content brief at /brief/<token>. The content_brief_shared RPC gates it. */
export default function SharedBrief() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SharedBriefData | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    loadSharedBrief(token ?? '')
      .then(d => { if (!alive) return; setData(d); setState(d ? 'ok' : 'missing'); })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    if (data) document.title = `${data.name} · ${data.brandName} · ApexGMV`;
  }, [data]);

  if (state === 'ok' && data) {
    return (
      <div className="ac-brief-public">
        <BriefFrame html={data.html} title={data.name} className="ac-brief-public-frame" />
      </div>
    );
  }

  return (
    <div className="ac-brief-public">
      <header className="ac-brief-public-bar">
        <img src="/apex-mobile-logo.svg" alt="" width={26} height={24} />
        <span>ApexGMV</span>
      </header>
      {state === 'loading'
        ? <div className="text-center py-5"><Spinner animation="border" /></div>
        : (
          <div className="ac-brief-blank">
            <i className="bi bi-link-45deg" />
            <h3>{state === 'missing' ? 'This link isn\'t available' : 'Something went wrong'}</h3>
            <p>{state === 'missing'
              ? 'It may have been turned off or replaced with a new one. Ask the person who sent it for the current link.'
              : 'Please refresh the page to try again.'}</p>
          </div>
        )}
    </div>
  );
}
