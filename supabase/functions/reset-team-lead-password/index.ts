// Supabase Edge Function: reset-team-lead-password
// Bob calls this to set a new password for any Team Lead user.
// Deploy: supabase functions deploy reset-team-lead-password

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
      .select('role').eq('id', userRes.user.id).single();
    if (callerProfile?.role !== 'bob') return json({ error: 'Forbidden — only Bob can reset Team Lead passwords' }, 403);

    const { user_id, password } = await req.json();
    if (!user_id || !password) return json({ error: 'user_id and password required' }, 400);
    if (String(password).length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

    const { data: targetProfile } = await admin.from('profiles')
      .select('role, email').eq('id', user_id).single();
    if (!targetProfile) return json({ error: 'Target user not found' }, 404);
    if (targetProfile.role !== 'team_lead') return json({ error: 'Can only reset Team Lead passwords via this endpoint' }, 403);

    const { error } = await admin.auth.admin.updateUserById(user_id, { password });
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
