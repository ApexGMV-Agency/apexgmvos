// Supabase Edge Function: create-bob
// Super Bob calls this to create a new Bob (admin) user. The new account is a
// regular Bob (is_superbob=false) with full Bob access everywhere.
// Deploy: supabase functions deploy create-bob
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
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;

    // 1. Verify caller is a Super Bob
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: 'Not authenticated' }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: callerProfile } = await admin
      .from('profiles').select('role, is_superbob').eq('id', userRes.user.id).single();
    if (callerProfile?.role !== 'bob' || !callerProfile?.is_superbob) {
      return json({ error: 'Forbidden — only the Super Bob can create Bob accounts' }, 403);
    }

    // 2. Parse + validate body
    const { email, password, full_name } = await req.json();
    if (!email || !password) {
      return json({ error: 'email and password required' }, 400);
    }
    if (String(password).length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);
    if (String(password).length > 72) return json({ error: 'Password must be 72 characters or fewer' }, 400);

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

    // 4. Upsert profile with role=bob (regular Bob, not Super Bob).
    const { error: profErr } = await admin
      .from('profiles')
      .upsert({
        id: newUserId,
        email,
        full_name: full_name ?? '',
        role: 'bob',
        is_superbob: false,
        can_edit_brands: true,
        can_manage_gmv_max: true,
        team_lead_id: null,
      });
    if (profErr) return json({ error: profErr.message }, 400);

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
