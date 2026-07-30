import { FormEvent, useState } from 'react';
import { Card, Form, Button, Alert } from 'react-bootstrap';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Login() {
  const { signIn, session } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) setErr(error); else nav('/');
  };

  return (
    <div className="ac-auth-wrap">
      <Card className="ac-auth-card shadow">
        <Card.Body className="p-4">
          {/* Same mark + wordmark lockup the sidebar uses, so the sign-in
              screen matches the chrome it hands off to. */}
          <div className="ac-auth-brand mb-3">
            <img src="/apex-mobile-logo.svg" alt="" width={38} height={35} />
            <span className="ac-auth-brand-text">
              ApexGMVOS
              <small>by ApexGMV</small>
            </span>
          </div>
          <p className="text-muted mb-4">Sign in to your account</p>
          {err && <Alert variant="danger">{err}</Alert>}
          <Form onSubmit={onSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Password</Form.Label>
              <Form.Control type="password" required value={password} onChange={e => setPassword(e.target.value)} />
            </Form.Group>
            <Button type="submit" disabled={busy} className="w-100">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </Form>
          <p className="text-center mt-3 mb-0 small text-muted">
            Accounts are created by your administrator.
          </p>
        </Card.Body>
      </Card>
    </div>
  );
}
