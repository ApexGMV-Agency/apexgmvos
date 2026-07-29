// Supabase Edge Function: create-apc
// Bob calls this to create a new APC user (email + password) and assign brands.
// Deploy: supabase functions deploy create-apc --no-verify-jwt=false
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided by Supabase)

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

    // 1. Verify caller is Bob using their JWT
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userRes.user) {
      return json({ error: 'Not authenticated' }, 401);
    }
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: callerProfile } = await admin
      .from('profiles').select('role').eq('id', userRes.user.id).single();
    // Bob can create any APC; a Team Lead can create APCs they own (scoped below).
    const callerRole = callerProfile?.role;
    if (callerRole !== 'bob' && callerRole !== 'team_lead') {
      return json({ error: 'Forbidden — only Bob or a Team Lead can create APCs' }, 403);
    }
    const isTeamLead = callerRole === 'team_lead';

    // 2. Parse + validate body
    const { email, password, full_name, brand_ids, can_edit_brands, can_manage_gmv_max } = await req.json();
    if (!email || !password || !Array.isArray(brand_ids)) {
      return json({ error: 'email, password, brand_ids required' }, 400);
    }
    if (String(password).length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);
    if (String(password).length > 72) return json({ error: 'Password must be 72 characters or fewer' }, 400);

    // A Team Lead may only assign brands that Bob granted them (team_lead_brands).
    if (isTeamLead && brand_ids.length > 0) {
      const { data: granted } = await admin
        .from('team_lead_brands').select('brand_id').eq('team_lead_id', userRes.user.id);
      const allowed = new Set((granted ?? []).map((r: { brand_id: string }) => r.brand_id));
      const bad = brand_ids.filter((b: string) => !allowed.has(b));
      if (bad.length > 0) {
        return json({ error: 'You can only assign brands that have been assigned to you.' }, 403);
      }
    }

    // One brand -> one APC: reject brands already held by another APC.
    if (brand_ids.length > 0) {
      const { data: taken } = await admin
        .from('apc_brands').select('brand_id').in('brand_id', brand_ids);
      if ((taken ?? []).length > 0) {
        return json({ error: 'One or more of those brands is already assigned to another APC.' }, 409);
      }
    }

    // 3. Create the auth user (email auto-confirmed so APC can log in immediately)
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

    // 4. Upsert profile with role=apc (trigger may have created it as 'pending').
    //    Team-Lead-created APCs are owned by that lead (team_lead_id).
    const { error: profErr } = await admin
      .from('profiles')
      .upsert({
        id: newUserId,
        email,
        full_name: full_name ?? '',
        role: 'apc',
        can_edit_brands: !!can_edit_brands,
        can_manage_gmv_max: !!can_manage_gmv_max,
        team_lead_id: isTeamLead ? userRes.user.id : null,
      });
    if (profErr) return json({ error: profErr.message }, 400);

    // 5. Assign brands
    if (brand_ids.length > 0) {
      const rows = brand_ids.map((bid: string) => ({ apc_id: newUserId, brand_id: bid }));
      const { error: asgErr } = await admin.from('apc_brands').insert(rows);
      if (asgErr) return json({ error: asgErr.message }, 400);
    }

    // 6. Welcome notification — which Team Lead (if any) + which brands.
    try {
      const notes: Array<Record<string, unknown>> = [];
      if (isTeamLead) {
        const { data: lead } = await admin.from('profiles')
          .select('full_name, email').eq('id', userRes.user.id).single();
        const leadName = lead?.full_name || lead?.email || 'your Team Lead';
        notes.push({
          user_id: newUserId, type: 'team_assignment',
          title: 'Welcome to the team',
          body: `You report to ${leadName}.`,
          link: '/brands',
          payload: { team_lead_id: userRes.user.id, kind: 'apc_assigned' },
        });
      }
      if (brand_ids.length > 0) {
        const { data: bs } = await admin.from('brands').select('name').in('id', brand_ids);
        const names = (bs ?? []).map((b: { name: string }) => b.name).join(', ');
        notes.push({
          user_id: newUserId, type: 'brand_assignment',
          title: `Brand${brand_ids.length > 1 ? 's' : ''} assigned to you`,
          body: names || 'A brand',
          link: '/brands',
          payload: { brand_ids, kind: 'brand_assigned' },
        });
      }
      if (notes.length > 0) await admin.from('notifications').insert(notes);
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
