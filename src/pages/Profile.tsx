import { FormEvent, useEffect, useRef, useState } from 'react';
import { Form, Button, Alert, Row, Col, Spinner } from 'react-bootstrap';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { uploadAvatar } from '../lib/imageUpload';
import { initials } from '../components/Avatar';

const ROLE_LABELS: Record<string, string> = {
  bob: 'Admin',
  team_lead: 'Team Lead',
  apc: 'Account Manager',
  ads_manager: 'Ads Manager',
  pending: 'Pending',
};

/** Password input with a show/hide toggle. */
function PasswordField({
  label, value, onChange, autoComplete, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Form.Group className="mb-3">
      <Form.Label className="ac-profile-label">{label}</Form.Label>
      <div className="ac-profile-pw">
        <Form.Control
          type={show ? 'text' : 'password'}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="ac-profile-pw-toggle"
          onClick={() => setShow(s => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          title={show ? 'Hide password' : 'Show password'}
        >
          <i className={`bi ${show ? 'bi-eye-slash' : 'bi-eye'}`} />
        </button>
      </div>
    </Form.Group>
  );
}

export default function Profile() {
  const { profile, user, refreshProfile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const avatarUrl = profile?.avatar_url;
  useEffect(() => { setImgFailed(false); }, [avatarUrl]);

  const displayName = profile?.full_name || profile?.email || 'User';
  const email = profile?.email || user?.email || '—';
  const roleLabel = profile?.is_superbob
    ? 'Super Boss'
    : profile?.role ? (ROLE_LABELS[profile.role] ?? profile.role) : '—';
  // Live confirm-match hint once the user starts typing a confirmation.
  const mismatch = confirm.length > 0 && password !== confirm;

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file || !user) return;
    setPhotoErr(null);

    if (!file.type.startsWith('image/')) {
      setPhotoErr('Please choose an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoErr('Image must be 5 MB or smaller.');
      return;
    }

    setPhotoBusy(true);
    try {
      const url = await uploadAvatar(user.id, file);
      const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id);
      if (error) throw error;
      await refreshProfile();
    } catch (e: any) {
      setPhotoErr(e?.message ?? 'Failed to update photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const onRemovePhoto = async () => {
    if (!user) return;
    setPhotoErr(null);
    setPhotoBusy(true);
    try {
      const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', user.id);
      if (error) throw error;
      await refreshProfile();
    } catch (e: any) {
      setPhotoErr(e?.message ?? 'Failed to remove photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    const acctEmail = profile?.email || user?.email;
    if (!acctEmail) {
      setErr('Could not determine your account email. Please sign in again.');
      return;
    }
    if (password.length < 6 || password.length > 72) {
      setErr('Password must be between 6 and 72 characters.');
      return;
    }
    if (password !== confirm) {
      setErr('Passwords do not match.');
      return;
    }
    if (password === currentPassword) {
      setErr('New password must be different from your current password.');
      return;
    }

    setBusy(true);
    // Verify the current password by re-authenticating before allowing a change —
    // updateUser() alone does NOT check the existing password.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: acctEmail,
      password: currentPassword,
    });
    if (verifyError) {
      setBusy(false);
      setErr('Your current password is incorrect.');
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setCurrentPassword('');
    setPassword('');
    setConfirm('');
    setMsg('Your password has been updated.');
  };

  const showImg = !!avatarUrl && !imgFailed;

  return (
    <div className="ac-profile-page">
      {/* Hero header — identity at a glance */}
      <div className="ac-profile-hero">
        <div className="ac-profile-hero-glow" aria-hidden />
        <div className="ac-profile-identity">
          <div className="ac-profile-avatar-wrap">
            <div className="ac-profile-avatar">
              {showImg
                ? <img src={avatarUrl!} alt={displayName} onError={() => setImgFailed(true)} draggable={false} />
                : <span>{initials(displayName)}</span>}
              {photoBusy && (
                <span className="ac-profile-avatar-loading">
                  <Spinner animation="border" size="sm" />
                </span>
              )}
            </div>
            <button
              type="button"
              className="ac-profile-avatar-edit"
              onClick={() => fileRef.current?.click()}
              disabled={photoBusy}
              aria-label="Change profile photo"
              title="Change profile photo"
            >
              <i className="bi bi-camera-fill" />
            </button>
          </div>

          <div className="ac-profile-id-text">
            <h1 className="ac-profile-name">{profile?.full_name || 'Your profile'}</h1>
            <div className="ac-profile-email">
              <i className="bi bi-envelope" />{email}
            </div>
            <span className="ac-profile-role-pill">
              <i className="bi bi-shield-check" />{roleLabel}
            </span>
          </div>

          <div className="ac-profile-photo-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="d-none"
              onChange={onPickPhoto}
            />
            <Button
              size="sm"
              variant="light"
              className="ac-profile-hero-btn"
              disabled={photoBusy}
              onClick={() => fileRef.current?.click()}
            >
              <i className="bi bi-upload me-1" />
              {photoBusy ? 'Uploading…' : (avatarUrl ? 'Change photo' : 'Upload photo')}
            </Button>
            {avatarUrl && (
              <Button
                size="sm"
                variant="outline-light"
                className="ac-profile-hero-btn"
                disabled={photoBusy}
                onClick={onRemovePhoto}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      {photoErr && <Alert variant="danger" className="py-2 mt-3 mb-0">{photoErr}</Alert>}

      <Row className="g-4 mt-1">
        {/* Account details */}
        <Col lg={5}>
          <div className="ac-profile-card h-100">
            <div className="ac-profile-card-head">
              <i className="bi bi-person-badge" />
              <h2>Account details</h2>
            </div>
            <dl className="ac-profile-dl mb-0">
              <div className="ac-profile-dl-row">
                <dt><i className="bi bi-person" />Name</dt>
                <dd>{profile?.full_name || <span className="text-muted">Not set</span>}</dd>
              </div>
              <div className="ac-profile-dl-row">
                <dt><i className="bi bi-envelope" />Email</dt>
                <dd>{email}</dd>
              </div>
              <div className="ac-profile-dl-row">
                <dt><i className="bi bi-shield-check" />Role</dt>
                <dd><span className="ac-profile-role-chip">{roleLabel}</span></dd>
              </div>
            </dl>
            <p className="ac-profile-hint mb-0">
              <i className="bi bi-info-circle" />
              Name, email and role are managed by your administrator.
            </p>
          </div>
        </Col>

        {/* Security / password */}
        <Col lg={7}>
          <div className="ac-profile-card h-100">
            <div className="ac-profile-card-head">
              <i className="bi bi-key" />
              <h2>Change password</h2>
            </div>

            {err && <Alert variant="danger" className="py-2">{err}</Alert>}
            {msg && <Alert variant="success" className="py-2">{msg}</Alert>}

            <Form onSubmit={onSubmit}>
              <PasswordField
                label="Current password"
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
              />
              <Row className="g-3">
                <Col md={6}>
                  <PasswordField
                    label="New password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                    placeholder="At least 6 characters"
                  />
                </Col>
                <Col md={6}>
                  <PasswordField
                    label="Confirm new password"
                    value={confirm}
                    onChange={setConfirm}
                    autoComplete="new-password"
                  />
                </Col>
              </Row>
              {mismatch && (
                <div className="ac-profile-match-warn">
                  <i className="bi bi-exclamation-circle" />Passwords don’t match yet.
                </div>
              )}
              <Button type="submit" disabled={busy} className="mt-2">
                {busy && <Spinner animation="border" size="sm" className="me-2" />}
                {busy ? 'Updating…' : 'Update password'}
              </Button>
            </Form>

            <div className="ac-profile-callout">
              <i className="bi bi-life-preserver" />
              <div>
                <strong>Forgot your password?</strong>
                <div className="text-muted">
                  If you can’t sign in, contact your administrator (Bob) to have it reset for you.
                </div>
              </div>
            </div>
          </div>
        </Col>
      </Row>
    </div>
  );
}
