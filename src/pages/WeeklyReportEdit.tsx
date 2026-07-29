import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import WeeklyReportEditClassic from './WeeklyReportEditClassic';
import WeeklyReportEditV2 from './WeeklyReportEditV2';
import WeeklyReportEditV3 from './WeeklyReportEditV3';

/**
 * Routes a weekly report to the right editor based on the format it was created
 * with. Newest reports carry `content.format_version === 'v3'` (12-section
 * TikTok-Shop template); `'v2'` = the earlier 14-section format; everything
 * else — including every legacy report — uses the original classic editor.
 */
export default function WeeklyReportEdit() {
  const { id } = useParams<{ id: string }>();
  const [fmt, setFmt] = useState<'classic' | 'v2' | 'v3' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.from('weekly_reports').select('content').eq('id', id).single();
      if (!alive) return;
      if (error) { setErr(error.message); return; }
      const v = (data?.content as any)?.format_version;
      setFmt(v === 'v3' ? 'v3' : v === 'v2' ? 'v2' : 'classic');
    })();
    return () => { alive = false; };
  }, [id]);

  if (err) return <Alert variant="danger">{err}</Alert>;
  if (!fmt) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  return fmt === 'v3' ? <WeeklyReportEditV3 />
    : fmt === 'v2' ? <WeeklyReportEditV2 />
    : <WeeklyReportEditClassic />;
}
