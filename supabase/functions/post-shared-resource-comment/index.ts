// Supabase Edge Function: post-shared-resource-comment
// Public — validates a share token, confirms the resource is in the link's resource_ids,
// and inserts a client comment on the resource. Notifies Bob + assigned APCs.
// Deploy in dashboard (Edge Functions → "post-shared-resource-comment")

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
    const admin = createClient(supabaseUrl, serviceKey);

    const { token, resource_id, author_name, body, parent_id } = await req.json();
    if (!token || !resource_id || !author_name || !body) {
      return json({ error: 'token, resource_id, author_name, body required' }, 400);
    }
    if (String(body).trim().length === 0) return json({ error: 'Empty comment' }, 400);

    const { data: link } = await admin.from('report_share_links')
      .select('*').eq('token', token).maybeSingle();
    if (!link) return json({ error: 'Invalid link' }, 404);
    if (link.revoked_at) return json({ error: 'Link revoked' }, 410);

    const { data: resource } = await admin.from('resources')
      .select('id,name,scope,brand_id,is_shared').eq('id', resource_id).maybeSingle();
    if (!resource) return json({ error: 'Resource not found' }, 404);
    if (resource.is_shared === false) return json({ error: 'Resource is not shared' }, 403);

    const linkMode: 'brand' | 'general' = link.link_mode === 'general' ? 'general' : 'brand';

    if (linkMode === 'general') {
      // Must be a general resource explicitly listed on this link.
      if (resource.scope !== 'general') return json({ error: 'Resource not on this link' }, 403);
      const explicitIds: string[] = link.resource_ids ?? [];
      if (!explicitIds.includes(resource_id)) return json({ error: 'Resource not on this link' }, 403);
    } else if (resource.scope === 'brand') {
      // Brand-scope resources additionally require brand.share_enabled AND that brand to be in this link.
      const linkBrandIds: string[] = link.brand_ids ?? [];
      if (!resource.brand_id || !linkBrandIds.includes(resource.brand_id)) {
        return json({ error: 'Resource not on this link' }, 403);
      }
      const { data: brand } = await admin.from('brands')
        .select('share_enabled').eq('id', resource.brand_id).maybeSingle();
      if (!brand?.share_enabled) return json({ error: 'Sharing is disabled for this brand' }, 403);
    }

    if (parent_id) {
      const { data: parent } = await admin.from('resource_comments')
        .select('resource_id').eq('id', parent_id).maybeSingle();
      if (!parent || parent.resource_id !== resource_id) return json({ error: 'Invalid parent' }, 400);
    }

    const cleanName = String(author_name).trim().slice(0, 80);
    const cleanBody = String(body).trim().slice(0, 4000);

    const { data: inserted, error } = await admin.from('resource_comments').insert({
      resource_id,
      parent_id: parent_id ?? null,
      author_type: 'client',
      author_name: cleanName,
      body: cleanBody,
    }).select().single();
    if (error) return json({ error: error.message }, 500);

    // Notify Bob + (for brand resources) APCs assigned to that brand. Best-effort.
    try {
      const [{ data: bobs }, { data: apcRows }] = await Promise.all([
        admin.from('profiles').select('id').eq('role', 'bob'),
        resource.scope === 'brand' && resource.brand_id
          ? admin.from('apc_brands').select('apc_id').eq('brand_id', resource.brand_id)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const recipientIds = new Set<string>();
      (bobs ?? []).forEach((p: any) => recipientIds.add(p.id));
      (apcRows ?? []).forEach((r: any) => recipientIds.add(r.apc_id));

      const title = `New comment on resource "${resource.name}"`;
      const bodyText = `${cleanName}: "${cleanBody.slice(0, 140)}${cleanBody.length > 140 ? '…' : ''}"`;
      const link = `/resources?resource=${resource_id}&comment=${(inserted as any).id}`;
      const payload = {
        resource_id,
        comment_id: (inserted as any).id,
        brand_id: resource.brand_id ?? null,
      };
      const rows = Array.from(recipientIds).map(uid => ({
        user_id: uid, type: 'client_resource_comment', title, body: bodyText, link, payload,
      }));
      if (rows.length > 0) await admin.from('notifications').insert(rows);

      // Optional web push fan-out
      const vapidConfigured = !!Deno.env.get('VAPID_PUBLIC_KEY');
      if (vapidConfigured && rows.length > 0) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
            body: JSON.stringify({ user_ids: Array.from(recipientIds), title, body: bodyText, link }),
          });
        } catch (_) { /* best effort */ }
      }
    } catch (notifyErr) {
      console.error('Notification dispatch failed:', notifyErr);
    }

    return json({ comment: inserted });
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
