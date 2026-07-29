import { Alert, Button, Spinner } from 'react-bootstrap';
import type { EditLock } from '../lib/useEditLock';

/**
 * The two edit-lock banners for a report editor, in one place:
 *
 *  - Locked out → who is editing, plus either "Take over editing" (this user
 *    outranks them) or "Request edit access" (they must be asked first).
 *  - Holding control while someone asks for it → Allow / Deny prompt.
 *
 * See useEditLock for the seniority rules behind which button appears.
 */
export default function EditLockBanner({ lock }: { lock: EditLock }) {
  const { incomingRequest, isLockedOut, editorName } = lock;

  if (incomingRequest) {
    return (
      <Alert variant="warning" className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
        <div className="d-flex align-items-center gap-2">
          <i className="bi bi-hand-index-thumb-fill" />
          <div>
            <strong>{incomingRequest.name}</strong> is asking to take over editing.{' '}
            Allowing it saves your work and puts you in read-only mode.
          </div>
        </div>
        <div className="d-flex gap-2">
          <Button size="sm" variant="outline-secondary" onClick={() => lock.respondToRequest(false)}>
            <i className="bi bi-x-lg me-1" /> Deny
          </Button>
          <Button size="sm" variant="warning" onClick={() => lock.respondToRequest(true)}>
            <i className="bi bi-check-lg me-1" /> Allow
          </Button>
        </div>
      </Alert>
    );
  }

  if (!isLockedOut || !editorName) return null;

  return (
    <Alert variant="info" className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
      <div className="d-flex align-items-center gap-2">
        <i className="bi bi-pencil-fill" />
        <div>
          <strong>{editorName}</strong> is currently editing this report.{' '}
          You're in read-only mode, following their changes live — no need to reload.
          {lock.requestStatus === 'denied' && (
            <div className="text-danger mt-1">
              <i className="bi bi-x-circle me-1" />
              {editorName} denied your request. You can ask again once they're ready.
            </div>
          )}
        </div>
      </div>
      {lock.canForceTakeOver ? (
        <Button size="sm" variant="outline-primary" onClick={lock.takeOver}>
          <i className="bi bi-unlock me-1" /> Take over editing
        </Button>
      ) : lock.requestStatus === 'pending' ? (
        <Button size="sm" variant="outline-primary" disabled>
          <Spinner animation="border" size="sm" className="me-1" style={{ width: 13, height: 13 }} />
          Waiting for {editorName}…
        </Button>
      ) : (
        <Button size="sm" variant="outline-primary" onClick={lock.requestTakeOver}>
          <i className="bi bi-hand-index-thumb me-1" />
          {lock.requestStatus === 'denied' ? 'Ask again' : 'Request edit access'}
        </Button>
      )}
    </Alert>
  );
}
