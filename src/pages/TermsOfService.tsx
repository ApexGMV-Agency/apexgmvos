import { useEffect } from 'react';
import { Badge, Card, Container, ListGroup } from 'react-bootstrap';
import { Link } from 'react-router-dom';

function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · ApexGMVOS`;
  }, [title]);
}

export default function TermsOfService() {
  usePageTitle('Terms of Service');

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #141620 0%, #232638 26%, #f5f2ec 26%, #f5f2ec 100%)' }}>
      <Container className="py-5">
        <div className="mx-auto" style={{ maxWidth: 920 }}>
          <div className="mb-4 text-center text-white" style={{ marginTop: '2rem' }}>
            <img
              src="/apex_logo.svg"
              alt="ApexGMV"
              style={{ height: 64, width: 'auto', objectFit: 'contain' }}
              className="mb-4"
            />
            <Badge bg="warning" text="dark" pill className="mb-3">Public document</Badge>
            <h1 className="display-6 mb-2 text-white">Terms of Service</h1>
            <p className="mb-0 text-white-50">
              These terms govern access to ApexGMVOS, an internal company platform used by ApexGMV
              and approved collaborators.
            </p>
          </div>

          <Card className="shadow-sm mb-4">
            <Card.Body className="p-4 p-md-5">
              <h2 className="h4 mb-3">Authorized use only</h2>
              <p className="mb-0">
                You may use ApexGMVOS only if you have been explicitly authorized by ApexGMV. You are
                responsible for keeping your account credentials private and for all activity performed under
                your account.
              </p>
            </Card.Body>
          </Card>

          <Card className="shadow-sm mb-4">
            <Card.Body className="p-4 p-md-5">
              <h2 className="h4 mb-3">Acceptable use</h2>
              <ListGroup variant="flush">
                <ListGroup.Item className="px-0">Do not misuse the platform, interfere with its operation, or attempt unauthorized access.</ListGroup.Item>
                <ListGroup.Item className="px-0">Do not upload harmful, unlawful, infringing, or confidential material unless you are permitted to do so.</ListGroup.Item>
                <ListGroup.Item className="px-0">Use the platform only for legitimate company work and approved collaboration.</ListGroup.Item>
              </ListGroup>
            </Card.Body>
          </Card>

          <Card className="shadow-sm mb-4">
            <Card.Body className="p-4 p-md-5">
              <h2 className="h4 mb-3">Service changes and termination</h2>
              <p className="mb-2">
                ApexGMV may update, suspend, or discontinue any part of the service at any time.
              </p>
              <p className="mb-0">
                Access may be suspended or removed if a user violates these terms, company policy, or security requirements.
              </p>
            </Card.Body>
          </Card>

          <Card className="shadow-sm">
            <Card.Body className="p-4 p-md-5 d-flex flex-column flex-md-row justify-content-between gap-3 align-items-md-center">
              <div>
                <h2 className="h5 mb-1">Need help?</h2>
                <p className="text-muted mb-0">If you have questions about access or usage, contact your administrator.</p>
              </div>
              <Link className="btn btn-primary" to="/login">Back to sign in</Link>
            </Card.Body>
          </Card>
        </div>
      </Container>
    </div>
  );
}