// Supabase Edge Function: delete-apc
// Bob calls this to permanently remove an APC account.
// Deploy in dashboard: Edge Functions → Create → name "delete-apc"
// Verify JWT: can stay ON (we verify the caller is Bob anyway).

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;

    // 1. Verify caller is Bob
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: 'Not authenticated' }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: callerProfile } = await admin.from('profiles')
      .select('role').eq('id', userRes.user.id).single();
    if (callerProfile?.role !== 'bob') return json({ error: 'Forbidden — only Bob can delete APCs' }, 403);

    // 2. Parse + validate
    const { user_id } = await req.json();
    if (!user_id) return json({ error: 'user_id required' }, 400);
    if (user_id === userRes.user.id) return json({ error: 'You cannot delete your own account' }, 400);

    // 3. Confirm target is an APC (defense in depth — Bob can't accidentally delete another Bob)
    const { data: targetProfile } = await admin.from('profiles')
      .select('role, email').eq('id', user_id).single();
    if (!targetProfile) return json({ error: 'Target user not found' }, 404);
    if (targetProfile.role !== 'apc') return json({ error: 'Can only delete APC accounts via this endpoint' }, 403);

    // 4. Delete auth user (profile cascades via FK on public.profiles.id → auth.users.id)
    const { error } = await admin.auth.admin.deleteUser(user_id);
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true, email: targetProfile.email });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
