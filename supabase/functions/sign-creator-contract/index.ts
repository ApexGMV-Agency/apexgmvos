// Supabase Edge Function: sign-creator-contract
// Public — the creator signs their contract from the /sign/:token page.
//
// Signing is ONE-SHOT: a row that already has signed_at is refused (409), so a
// signature can never be edited or replaced through the share link. A
// deactivated link is refused too (410). On success the brand's assigned
// paid-collab handler(s) + the link's creator get a notification telling them
// which creator signed.
//
// Deploy: supabase functions deploy sign-creator-contract

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_SIG_CHARS = 600_000; // ~450KB PNG data URL — plenty for a canvas scrawl

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const token = body.token;
    const signerName = String(body.signer_name ?? '').trim().slice(0, 120);
    const signature = String(body.signature ?? '');
    if (!token) return json({ error: 'token required' }, 400);
    if (!signerName) return json({ error: 'Please type your full name before signing.' }, 400);
    if (!/^data:image\/(png|jpeg);base64,/.test(signature)) {
      return json({ error: 'Please add your signature before confirming.' }, 400);
    }
    if (signature.length > MAX_SIG_CHARS) return json({ error: 'Signature image is too large.' }, 413);
    if (body.agreed !== true) return json({ error: 'Please confirm you have read and agree to the agreement.' }, 400);

    const { data: row } = await admin
      .from('handler_contract_signatures')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (!row) return json({ error: 'This signing link is not valid.' }, 404);
    if (!row.active) return json({ error: 'This signing link has been deactivated by the brand.' }, 410);
    if (row.signed_at) return json({ error: 'This contract has already been signed and cannot be changed.' }, 409);

    // Guarded update: the `signed_at is null` filter makes a double submit a
    // no-op instead of overwriting the first signature.
    const { data: updated, error } = await admin
      .from('handler_contract_signatures')
      .update({
        signed_at: new Date().toISOString(),
        signer_name: signerName,
        signer_signature: signature,
        signer_user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300),
      })
      .eq('id', row.id)
      .is('signed_at', null)
      .select()
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!updated) return json({ error: 'This contract has already been signed and cannot be changed.' }, 409);

    // Notify the brand's handler(s) + whoever created the link.
    try {
      const [{ data: brand }, { data: creator }, { data: handlerRows }] = await Promise.all([
        admin.from('brands').select('id,name').eq('id', row.brand_id).maybeSingle(),
        admin.from('handler_collab_creators').select('id,name,onboarded_on').eq('id', row.creator_id).maybeSingle(),
        admin.from('paid_collab_handler_brands').select('handler_id').eq('brand_id', row.brand_id),
      ]);
      const recipients = new Set<string>();
      (handlerRows ?? []).forEach((r: any) => recipients.add(r.handler_id));
      if (row.created_by) recipients.add(row.created_by);

      const creatorLabel = creator?.name || signerName;
      const title = `${creatorLabel} signed the contract`;
      const bodyText = `${signerName} signed the Content Creation Agreement for ${creatorLabel} on ${brand?.name ?? 'a brand'}.`;
      const month = creator?.onboarded_on ? String(creator.onboarded_on).slice(0, 7) : '';
      const linkUrl = `/paid-collab?brand=${encodeURIComponent(row.brand_id)}${month ? `&month=${month}` : ''}`;
      const rows = Array.from(recipients).map(uid => ({
        user_id: uid,
        type: 'contract_signed',
        title,
        body: bodyText,
        link: linkUrl,
        payload: { brand_id: row.brand_id, creator_id: row.creator_id, kind: 'contract_signed' },
      }));
      if (rows.length) await admin.from('notifications').insert(rows);

      if (Deno.env.get('VAPID_PUBLIC_KEY') && rows.length) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
            body: JSON.stringify({ user_ids: Array.from(recipients), title, body: bodyText, link: linkUrl }),
          });
        } catch (_) { /* best effort */ }
      }
    } catch (notifyErr) {
      console.error('Notification dispatch failed:', notifyErr);
    }

    return json({
      contract: {
        signed_at: updated.signed_at,
        signer_name: updated.signer_name,
        signer_signature: updated.signer_signature,
      },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
