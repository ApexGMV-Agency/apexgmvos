// Supabase Edge Function: get-creator-contract
// Public — resolves a creator contract signing token into everything the public
// /sign/:token page needs: the contract payload snapshot (so the PDF the creator
// reads is exactly what the handler generated) and the current signing state.
//
// Returns 410 when the handler deactivated the link. Once signed, the signer's
// name + signature come back so the page can render the signed copy (read-only).
//
// Deploy: supabase functions deploy get-creator-contract

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { token } = await req.json();
    if (!token) return json({ error: 'token required' }, 400);

    const { data: row } = await admin
      .from('handler_contract_signatures')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (!row) return json({ error: 'This signing link is not valid.' }, 404);
    // Deactivating stops SIGNING, not access to an executed agreement: a signed
    // contract stays readable/downloadable for the creator (and is the link the
    // brand-side read views open). Only an unsigned deactivated link is closed.
    if (!row.active && !row.signed_at) {
      return json({ error: 'This signing link has been deactivated by the brand.' }, 410);
    }

    const { data: creator } = await admin
      .from('handler_collab_creators')
      .select('id, name')
      .eq('id', row.creator_id)
      .maybeSingle();
    const { data: brand } = await admin
      .from('brands')
      .select('id, name')
      .eq('id', row.brand_id)
      .maybeSingle();

    return json({
      contract: {
        payload: row.payload ?? {},
        brand_name: brand?.name ?? row.payload?.brandName ?? 'Brand',
        creator_name: creator?.name ?? row.payload?.creatorName ?? '',
        signed_at: row.signed_at,
        signer_name: row.signer_name,
        signer_signature: row.signer_signature,
      },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
