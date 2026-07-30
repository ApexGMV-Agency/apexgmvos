import { useEffect } from 'react';
import { Badge, Card, Container, ListGroup } from 'react-bootstrap';
import { Link } from 'react-router-dom';

function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · ApexGMVOS`;
  }, [title]);
}

export default function PrivacyPolicy() {
  usePageTitle('Privacy Policy');

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, var(--ac-surface-strong) 0%, var(--ac-surface-raised) 36%, var(--ac-surface-strong) 100%)' }}>
      <Container className="py-5">
        <div className="mx-auto" style={{ maxWidth: 920 }}>
          <div className="mb-4 text-center">
            <img
              src="/apex_logo.svg"
              alt="ApexGMV"
              style={{ height: 64, width: 'auto', objectFit: 'contain' }}
              className="mb-4"
            />
            <Badge bg="warning" text="dark" pill className="mb-3">Public document</Badge>
            <h1 className="display-6 mb-2">Privacy Policy</h1>
            <p className="text-muted mb-0">
              ApexGMVOS is an internal business platform for ApexGMV and authorized collaborators.
              This page explains what we collect, how we use it, and how we protect it.
            </p>
          </div>

          <Card className="shadow-sm mb-4">
            <Card.Body className="p-4 p-md-5">
              <h2 className="h4 mb-3">What we collect</h2>
              <ListGroup variant="flush">
                <ListGroup.Item className="px-0">Account details such as name, email address, role, and profile photo.</ListGroup.Item>
                <ListGroup.Item className="px-0">Workflow data you create or upload, including reports, notes, chats, tasks, and shared files.</ListGroup.Item>
                <ListGroup.Item className="px-0">Usage data such as sign-in activity, timestamps, notifications, and device or browser information.</ListGroup.Item>
              </ListGroup>

              <h2 className="h4 mt-4 mb-3">How we use it</h2>
              <ListGroup variant="flush">
                <ListGroup.Item className="px-0">To provide access to the platform and manage roles, permissions, and collaboration.</ListGroup.Item>
                <ListGroup.Item className="px-0">To operate reporting, paid-collab workflows, messaging, reminders, and notifications.</ListGroup.Item>
                <ListGroup.Item className="px-0">To maintain security, prevent abuse, and keep audit trails for internal operations.</ListGroup.Item>
              </ListGroup>

              <h2 className="h4 mt-4 mb-3">How we share information</h2>
              <p className="mb-2">
                We do not sell personal information. Access is limited to authorized internal staff and
                approved collaborators who need it for business operations.
              </p>
              <p className="mb-0">
                We may also disclose data when required by law, to protect our rights, or to support service providers
                that help us run the platform.
              </p>
            </Card.Body>
          </Card>

          <Card className="shadow-sm mb-4">
            <Card.Body className="p-4 p-md-5">
              <h2 className="h4 mb-3">Retention and security</h2>
              <p className="mb-0">
                We retain information for as long as needed for business, legal, and operational purposes.
                Access controls, logging, and platform safeguards are used to help protect company data, but
                no system can guarantee absolute security.
              </p>
            </Card.Body>
          </Card>

          <Card className="shadow-sm">
            <Card.Body className="p-4 p-md-5 d-flex flex-column flex-md-row justify-content-between gap-3 align-items-md-center">
              <div>
                <h2 className="h5 mb-1">Questions or requests?</h2>
                <p className="text-muted mb-0">Contact your administrator or ApexGMV management for access, corrections, or policy questions.</p>
              </div>
              <Link className="btn btn-primary" to="/login">Back to sign in</Link>
            </Card.Body>
          </Card>
        </div>
      </Container>
    </div>
  );
}