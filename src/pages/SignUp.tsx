import { Card, Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';

export default function SignUp() {
  return (
    <div className="ac-auth-wrap">
      <Card className="ac-auth-card shadow">
        <Card.Body className="p-4 text-center">
          <div style={{ fontSize: '2.5rem', color: '#94a3b8' }}>
            <i className="bi bi-lock" />
          </div>
          <h4 className="mt-2 mb-1">Sign-ups are closed</h4>
          <p className="text-muted mb-4">
            ApexGMVOS is an internal platform. Accounts are created by the administrator — please contact your admin to request access.
          </p>
          <Button as={Link as any} to="/login" variant="primary">Back to sign in</Button>
        </Card.Body>
      </Card>
    </div>
  );
}
