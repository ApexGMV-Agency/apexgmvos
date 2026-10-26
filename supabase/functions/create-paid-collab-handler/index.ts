// Supabase Edge Function: create-paid-collab-handler
// Any Bob (incl. the Super Boss) calls this to create a Paid Collab Handler
// (email + password) and hand them brands.
// Only brands whose scope contains 'paid_creator' can be assigned.
// Deploy: supabase functions deploy create-paid-collab-handler
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (auto-provided).

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1. Verify caller is a Bob. Pass the JWT explicitly — a no-arg getUser()
    // reads the (empty) server-side session and 401s every real user.
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Not authenticated' }, 401);
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userRes.user) return json({ error: 'Not authenticated' }, 401);

    const { data: callerProfile } = await admin
      .from('profiles').select('role').eq('id', userRes.user.id).single();
    if (callerProfile?.role !== 'bob') {
      return json({ error: 'Forbidden — only Bob can create Paid Collab Handlers' }, 403);
    }

    // 2. Parse + validate body
    const { email, password, full_name, brand_ids } = await req.json();
    if (!email || !password) return json({ error: 'email and password required' }, 400);
    if (String(password).length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);
    if (String(password).length > 72) return json({ error: 'Password must be 72 characters or fewer' }, 400);
    const wanted: string[] = Array.isArray(brand_ids) ? brand_ids.filter((x: unknown) => typeof x === 'string') : [];

    // Only paid-collab brands are assignable (set_paid_collab_handler_brands enforces the same).
    let brandIds: string[] = [];
    if (wanted.length > 0) {
      const { data: rows, error: bErr } = await admin
        .from('brands').select('id, scope').in('id', wanted);
      if (bErr) return json({ error: bErr.message }, 400);
      const bad = (rows ?? []).filter(b => !(b.scope ?? []).includes('paid_creator'));
      if (bad.length > 0) return json({ error: 'Only brands with the Paid Collab scope can be assigned to a handler' }, 400);
      brandIds = (rows ?? []).map(b => b.id);
    }

    // 3. Create the auth user (email auto-confirmed so they can log in immediately)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? '' },
    });
    if (createErr || !created.user) {
      const msg = createErr?.message ?? 'Could not create user';
      if (/already|registered|exists/i.test(msg)) {
        return json({ error: 'A user with this email already exists.' }, 409);
      }
      return json({ error: msg }, 400);
    }
    const newUserId = created.user.id;

    // 4. Upsert profile with role=paid_collab_handler (trigger may have created it as 'pending').
    const { error: profErr } = await admin
      .from('profiles')
      .upsert({
        id: newUserId,
        email,
        full_name: full_name ?? '',
        role: 'paid_collab_handler',
        is_superbob: false,
        team_lead_id: null,
      });
    if (profErr) return json({ error: profErr.message }, 400);

    // 5. Brand assignments
    if (brandIds.length > 0) {
      const { error: aErr } = await admin
        .from('paid_collab_handler_brands')
        .insert(brandIds.map(brand_id => ({ handler_id: newUserId, brand_id })));
      if (aErr) return json({ error: aErr.message }, 400);
    }

    // 6. Welcome notification (best-effort)
    try {
      await admin.from('notifications').insert({
        user_id: newUserId, type: 'brand_assignment',
        title: 'Welcome to the Paid Collab workspace',
        body: brandIds.length
          ? `You have ${brandIds.length} brand${brandIds.length === 1 ? '' : 's'} to run.`
          : 'Your brands will appear here once Bob assigns them.',
        link: '/paid-collab',
        payload: { kind: 'paid_collab_brand_assigned' },
      });
    } catch (_) { /* notifications are best-effort */ }

    return json({ id: newUserId, email });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
