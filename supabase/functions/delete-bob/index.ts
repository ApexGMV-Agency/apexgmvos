// Supabase Edge Function: delete-bob
// Super Bob calls this to permanently remove a (regular) Bob account.
// Super Bob accounts and the caller's own account can never be deleted here,
// so at least one Super Bob always survives.
// Deploy: supabase functions deploy delete-bob

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

    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: 'Not authenticated' }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: callerProfile } = await admin.from('profiles')
      .select('role, is_superbob').eq('id', userRes.user.id).single();
    if (callerProfile?.role !== 'bob' || !callerProfile?.is_superbob) {
      return json({ error: 'Forbidden — only the Super Bob can delete Bob accounts' }, 403);
    }

    const { user_id } = await req.json();
    if (!user_id) return json({ error: 'user_id required' }, 400);
    if (user_id === userRes.user.id) return json({ error: 'You cannot delete your own account' }, 400);

    const { data: targetProfile } = await admin.from('profiles')
      .select('role, is_superbob, email').eq('id', user_id).single();
    if (!targetProfile) return json({ error: 'Target user not found' }, 404);
    if (targetProfile.role !== 'bob') return json({ error: 'Can only delete Bob accounts via this endpoint' }, 403);
    if (targetProfile.is_superbob) return json({ error: 'Super Bob accounts cannot be deleted' }, 403);

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
