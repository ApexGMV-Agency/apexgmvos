// Public creator contract signing page — /sign/:token (no auth).
//
// The handler generates the link from the Paid Collab workspace's Contract
// column. Here the creator READS THE AGREEMENT AS A WEB PAGE — the same
// `ContractDoc` HTML the handler previews in the workspace, rendered from the
// same `buildContractModel` the PDF uses, so the page and the downloadable PDF
// can never say different things. They type their name, draw (or upload) a
// signature and confirm ONCE — the signature is frozen server-side afterwards,
// so re-opening the link only offers the signed PDF download.
//
// Everything runs through two service-role edge functions:
//   get-creator-contract  → payload + signing state
//   sign-creator-contract → one-shot signature, notifies the handler(s)

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import { svgToPngDataUrl } from '../lib/imageUpload';
import { useSignaturePad } from '../lib/signaturePad';
import ContractDoc from './handler-collab/ContractDoc';
import type { ContractInput } from './handler-collab/contractPdf';
import './handler-collab/handlerCollab.css';

type ContractState = {
  payload: Record<string, any>;
  brand_name: string;
  creator_name: string;
  signed_at: string | null;
  signer_name: string | null;
  signer_signature: string | null;
};

export default function SignContract() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [contract, setContract] = useState<ContractState | null>(null);

  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [uploadedSig, setUploadedSig] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [err, setErr] = useState('');

  // Pointer/touch handling lives in the shared hook — see src/lib/signaturePad.ts
  // for why the old inline onPointer* + setPointerCapture version never worked on iOS.
  const pad = useSignaturePad({ onStrokeStart: () => setUploadedSig(null) });
  const { dirty: padDirty, clear: clearPad } = pad;

  /* ── load the contract ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-creator-contract', { body: { token } });
        if (error) throw await fnError(error);
        if (!alive) return;
        setContract(data.contract as ContractState);
        setName((data.contract?.signer_name || data.contract?.creator_name || '') as string);
      } catch (e: any) {
        if (alive) setLoadErr(e.message || 'Could not open this signing link.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [token]);

  /* ── the agreement the creator is signing (or their signed copy) ── */
  const signed = !!contract?.signed_at;
  // Same input the PDF is built from, so what they read here is what they sign
  // and what the downloaded copy says.
  const docInput = useMemo<ContractInput | null>(() => (contract ? {
    ...(contract.payload as any),
    creatorSignatureDataUrl: contract.signer_signature || null,
    creatorSignedName: contract.signer_name || '',
    creatorSignedAt: contract.signed_at || null,
  } : null), [contract]);

  async function onUploadSvg(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setUploadedSig(await svgToPngDataUrl(file));
      clearPad();
    } catch (ex: any) { setErr(`Could not read that SVG: ${ex.message || ''}`); }
  }

  async function sign() {
    setErr('');
    const cleanName = name.trim();
    if (!cleanName) { setErr('Please type your full name.'); return; }
    const signature = uploadedSig || pad.toDataURL();
    if (!signature) { setErr('Please draw or upload your signature.'); return; }
    if (!agreed) { setErr('Please confirm you have read and agree to the agreement.'); return; }
    setSigning(true);
    try {
      const { data, error } = await supabase.functions.invoke('sign-creator-contract', {
        body: { token, signer_name: cleanName, signature, agreed: true },
      });
      if (error) throw await fnError(error);
      setContract(prev => (prev ? { ...prev, ...data.contract } : prev));
    } catch (e: any) {
      setErr(e.message || 'Could not submit your signature.');
    }
    setSigning(false);
  }

  async function download() {
    if (!contract) return;
    try {
      const { downloadCreatorContract } = await import('./handler-collab/contractPdf');
      await downloadCreatorContract({
        ...(contract.payload as any),
        creatorSignatureDataUrl: contract.signer_signature || null,
        creatorSignedName: contract.signer_name || '',
        creatorSignedAt: contract.signed_at || null,
      });
    } catch (e: any) { setErr(e.message || 'Could not build the PDF.'); }
  }

  if (loading) return <div className="pc-app pc-sign-page"><div className="pc-spinner" /></div>;

  if (loadErr || !contract) {
    return (
      <div className="pc-app pc-sign-page">
        <div className="pc-sign-card pc-sign-msg">
          <div className="pc-empty-icon">🔒</div>
          <h2>Link unavailable</h2>
          <p>{loadErr || 'This signing link is not valid.'}</p>
          <p className="pc-sign-fine">If you think this is a mistake, contact the person who sent you the link.</p>
        </div>
      </div>
    );
  }

  const previewSig = uploadedSig || null;

  return (
    <div className="pc-app pc-sign-page">
      <div className="pc-sign-head">
        <div>
          <div className="pc-sign-brand">{contract.brand_name}</div>
          <h1>Content Creation Agreement</h1>
          <div className="pc-sign-sub">Prepared for {contract.creator_name || contract.payload?.username || 'you'}</div>
        </div>
        {signed && <span className="pc-sign-badge"><i className="bi bi-patch-check-fill" /> Signed</span>}
      </div>

      <div className="pc-sign-card">
        <div className="pc-sign-cardhead">
          <span>{signed ? 'Your signed agreement' : 'Read the full agreement'}</span>
          <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={download} disabled={!signed}>
            {signed ? 'Download PDF' : 'Download available after signing'}
          </button>
        </div>
        <div className="pc-sign-doc">
          {docInput && <ContractDoc input={docInput} />}
        </div>
      </div>

      {signed ? (
        <div className="pc-sign-card pc-sign-done">
          <i className="bi bi-patch-check-fill" />
          <div>
            <b>Signed by {contract.signer_name}</b>
            <div className="pc-sign-fine">{new Date(contract.signed_at as string).toLocaleString()}</div>
            <div className="pc-sign-fine">This agreement is final — the signature can no longer be changed. Download your copy above.</div>
          </div>
        </div>
      ) : (
        <div className="pc-sign-card">
          <div className="pc-sign-cardhead"><span>Sign the agreement</span></div>
          <div className="pc-sign-body">
            <div className="pc-field">
              <label>Your full name</label>
              <input className="pc-input" placeholder="Full legal name" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="pc-field">
              <label>Your signature</label>
              {previewSig && (
                <div className="pc-sig-preview">
                  <img src={previewSig} alt="Signature" />
                  <span className="pc-sig-preview-l">Uploaded signature</span>
                  <button type="button" className="pc-multix" title="Remove" onClick={() => setUploadedSig(null)}>×</button>
                </div>
              )}
              <canvas ref={pad.ref} className="pc-sigpad" />
              <div className="pc-sig-actions">
                <span className="pc-sig-hint">Draw above with your mouse or finger, or</span>
                <label className="pc-btn pc-btn-ghost pc-btn-sm pc-sign-upload" style={{ display: 'flex', alignItems: 'center', gap: '0.5em', margin: '0', color:'#000000' }}>
                  Upload SVG
                  <input type="file" accept=".svg,image/svg+xml" style={{ display: 'none' }} onChange={onUploadSvg} />
                </label>
                {padDirty && <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={clearPad}>Clear</button>}
              </div>
            </div>
            <label className="pc-sign-agree">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              <span>I have read the agreement above and agree to its terms. I understand that signing is final and my signature cannot be changed afterwards.</span>
            </label>
            {err && <div className="pc-formerr">{err}</div>}
            <button className="pc-btn pc-btn-primary pc-sign-submit" onClick={sign} disabled={signing}>
              {signing ? 'Signing…' : 'Sign & submit'}
            </button>
            <div className="pc-sign-fine">Once submitted, {contract.brand_name} is notified and you can download your signed copy right here.</div>
          </div>
        </div>
      )}
    </div>
  );
}
