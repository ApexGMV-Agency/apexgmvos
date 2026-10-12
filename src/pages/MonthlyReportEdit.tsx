import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import MonthlyReportEditClassic from './MonthlyReportEditClassic';
import ReportEditV3 from './ReportEditV3';

/**
 * Routes a monthly report to the right editor based on the format it was
 * created with. New reports carry `content.format_version === 'v3'` — the same
 * 12-section template as the weekly report; everything else (every legacy
 * monthly report) uses the original classic editor.
 */
export default function MonthlyReportEdit() {
  const { id } = useParams<{ id: string }>();
  const [fmt, setFmt] = useState<'classic' | 'v3' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.from('monthly_reports').select('content').eq('id', id).single();
      if (!alive) return;
      if (error) { setErr(error.message); return; }
      setFmt((data?.content as any)?.format_version === 'v3' ? 'v3' : 'classic');
    })();
    return () => { alive = false; };
  }, [id]);

  if (err) return <Alert variant="danger">{err}</Alert>;
  if (!fmt) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  return fmt === 'v3' ? <ReportEditV3 kind="monthly" /> : <MonthlyReportEditClassic />;
}
