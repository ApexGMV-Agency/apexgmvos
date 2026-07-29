// Supabase Edge Function: send-push
// Called by other edge functions (with service-role auth header) to fan out
// web push notifications to a list of user_ids using the stored subscriptions.
// Deploy via Dashboard. Turn "Verify JWT" OFF (we verify the service key header ourselves).
//
// Required secrets (Supabase → Project Settings → Functions → <send-push> → Secrets):
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT   (e.g. "mailto:you@example.com")

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@apexgmvos.com';

    if (!vapidPublic || !vapidPrivate) {
      return json({ error: 'VAPID keys not configured' }, 500);
    }

    // Only allow calls bearing the service role key (i.e. from other edge functions / cron)
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.includes(serviceKey)) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const { user_ids, title, body, link, tag } = await req.json();
    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return json({ error: 'user_ids required' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: subs, error } = await admin.from('push_subscriptions')
      .select('*').in('user_id', user_ids);
    if (error) return json({ error: error.message }, 500);
    if (!subs || subs.length === 0) return json({ sent: 0 });

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const payload = JSON.stringify({
      title: title ?? 'ApexGMVOS',
      body: body ?? '',
      link: link ?? '/',
      tag: tag ?? 'apexgmvos',
    });

    const stale: string[] = [];
    let sent = 0;
    await Promise.all(subs.map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (e: any) {
        // 404/410 = subscription dead; clean it up
        if (e?.statusCode === 404 || e?.statusCode === 410) stale.push(s.id);
      }
    }));

    if (stale.length > 0) {
      await admin.from('push_subscriptions').delete().in('id', stale);
    }
    return json({ sent, pruned: stale.length });
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
