import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Spinner } from 'react-bootstrap';
import SopSectionsView from './SopSectionsView';
import { loadSharedSop, type SharedSop as SharedSopData } from './sopApi';
import { sopHeading } from './sopSections';

/** Public, read-only SOP at /sop/<token>. No auth; the sop_shared RPC gates it. */
export default function SharedSop() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SharedSopData | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    loadSharedSop(token ?? '')
      .then(d => { if (!alive) return; setData(d); setState(d ? 'ok' : 'missing'); })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    if (data) document.title = `${sopHeading(data.brandName)} · ApexGMV`;
  }, [data]);

  return (
    <div className="ac-sop-public">
      <header className="ac-sop-public-bar">
        <img src="/apex-mobile-logo.svg" alt="" width={26} height={24} />
        <span>ApexGMV</span>
      </header>
      <main className="ac-sop-public-main">
        {state === 'loading' && <div className="text-center py-5"><Spinner animation="border" /></div>}
        {(state === 'missing' || state === 'error') && (
          <div className="ac-sop-blank">
            <i className="bi bi-link-45deg" />
            <h3>{state === 'missing' ? 'This link isn\'t available' : 'Something went wrong'}</h3>
            <p>{state === 'missing'
              ? 'It may have been turned off or replaced with a new one. Ask the person who sent it for the current link.'
              : 'Please refresh the page to try again.'}</p>
          </div>
        )}
        {state === 'ok' && data && (
          <SopSectionsView brandName={data.brandName} sections={data.sections} live={data.live} updatedAt={data.updatedAt} />
        )}
      </main>
    </div>
  );
}
