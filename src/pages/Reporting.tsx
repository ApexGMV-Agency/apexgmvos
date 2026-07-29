import { Card } from 'react-bootstrap';

export default function Reporting({ kind }: { kind: string }) {
  return (
    <>
      <h2 className="mb-4">{kind} Reporting</h2>
      <Card body>
        <p className="mb-0 text-muted">{kind} report content coming soon.</p>
      </Card>
    </>
  );
}
