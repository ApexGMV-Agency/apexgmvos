import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

/**
 * Collaborative "editing lock" for a single record, built on Supabase Realtime
 * presence + broadcast (no DB schema). Everyone editing the same record joins a
 * presence channel; all clients deterministically agree on a single OWNER, who
 * alone may write. Everyone else is locked out (read-only) until the owner
 * leaves, or until they get control through the take-over rules below.
 *
 * Owner = the present client with the highest `claimSeq` (raised by a granted
 * take-over), tie-broken by earliest join, then userId — so every client
 * computes the same owner from the same presence state.
 *
 * TAKE-OVER RULES (seniority ladder, see `editRank`):
 *   Super Boss > Bob > Team Lead > APC > everyone else
 *   - Outranking the current editor  → take over immediately, no permission.
 *   - Same rank or lower             → send a REQUEST the editor must approve.
 * So a Team Lead pulls a report off an APC directly, an APC has to ask a Team
 * Lead or Bob, Bob takes over anyone below him, and only the Super Boss can
 * take a report off a Bob without asking.
 *
 * This is a cooperative, client-side protocol — it prevents teammates from
 * silently clobbering each other, not a security boundary. Who may actually
 * write a report is still enforced by RLS.
 *
 * The lock auto-releases the instant a tab closes/crashes (presence times out),
 * so there are no stuck locks to clean up.
 */

/** Seniority for take-overs — a strictly higher rank never has to ask. */
export function editRank(role?: string | null, isSuperbob?: boolean | null): number {
  if (isSuperbob) return 4;
  switch (role) {
    case 'bob': return 3;
    case 'team_lead': return 2;
    case 'apc': return 1;
    default: return 0;   // ads_manager, paid-collab handler, anyone else
  }
}

interface PresenceMeta {
  clientId: string; // per-TAB id — two tabs of one person are two clients
  userId: string;
  name: string;
  joinedAt: number; // ms epoch — when this client first opened the editor
  claimSeq: number; // take-over counter; higher wins ownership
  rank: number;     // seniority (editRank) — decides who must ask permission
}

/** A teammate asking THIS client (the current editor) to hand over control. */
export interface EditAccessRequest { clientId: string; name: string; }

/** Where this client's own outgoing take-over request stands. */
export type EditRequestStatus = 'idle' | 'pending' | 'denied';

/**
 * Per-tab, per-record editing identity — kept across reloads in sessionStorage.
 *
 * `left` separates the two ways an editor can disappear:
 *   - RELOAD (F5, crash): React's cleanup never runs, so `left` stays false and
 *     the tab re-claims its slot with the same standing — otherwise its own
 *     not-yet-expired presence row would sit there as a ghost owner and lock it
 *     out of its own report.
 *   - LEAVING (navigating off the editor): cleanup runs and marks `left`, so
 *     coming back later is a FRESH join at the back of the queue. Someone who
 *     took over while you were gone keeps control, and you have to take it back
 *     deliberately.
 */
interface TabIdentity { clientId: string; joinedAt: number; claimSeq: number; left?: boolean; }

const identityKey = (kind: string, id?: string) => `ac_editlock:${kind}:${id ?? '-'}`;

function newClientId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `c${Date.now()}${Math.random().toString(36).slice(2)}`;
}

function loadIdentity(kind: string, id?: string): TabIdentity {
  const fresh = (clientId = newClientId()): TabIdentity =>
    ({ clientId, joinedAt: Date.now(), claimSeq: 0 });
  try {
    const raw = sessionStorage.getItem(identityKey(kind, id));
    let made: TabIdentity;
    if (raw) {
      const p = JSON.parse(raw) as TabIdentity;
      if (p?.clientId && typeof p.joinedAt === 'number') {
        // Reload → keep our standing. Re-entry after leaving → queue at the back,
        // reusing the clientId so any leftover presence row is replaced.
        made = p.left
          ? fresh(p.clientId)
          : { clientId: p.clientId, joinedAt: p.joinedAt, claimSeq: p.claimSeq ?? 0 };
      } else {
        made = fresh();
      }
    } else {
      made = fresh();
    }
    sessionStorage.setItem(identityKey(kind, id), JSON.stringify(made));
    return made;
  } catch {
    return fresh();   // private mode / storage disabled — per-load identity is fine
  }
}

function saveIdentity(kind: string, id: string | undefined, v: TabIdentity) {
  try { sessionStorage.setItem(identityKey(kind, id), JSON.stringify(v)); } catch { /* noop */ }
}

const REQUEST_EVENT = 'lock-request';
const RESPONSE_EVENT = 'lock-response';
/** Give up on an unanswered request rather than leaving the asker stuck. */
const REQUEST_TIMEOUT_MS = 60_000;

export interface EditLock {
  /** Presence has synced at least once — until then we optimistically allow editing. */
  ready: boolean;
  /** This client currently holds the edit lock (optimistically true until synced). */
  isOwner: boolean;
  /** Someone else currently owns the edit lock; this client must stay read-only. */
  isLockedOut: boolean;
  /** Name of the current owner when locked out (null otherwise). */
  editorName: string | null;
  /** Name of whoever currently holds control, whether that's me or someone else. */
  controllerName: string | null;
  /** How many other people (distinct users) are present on this record. */
  othersCount: number;
  /** True when this client outranks the editor and may seize control unasked. */
  canForceTakeOver: boolean;
  /** Force ownership to this client (bumps the loser to read-only). */
  takeOver: () => void;
  /** Outrank the editor → take over now; otherwise ask them for control. */
  requestTakeOver: () => void;
  /** Status of this client's own outgoing request. */
  requestStatus: EditRequestStatus;
  /** A teammate is asking THIS client to hand over control (owner only). */
  incomingRequest: EditAccessRequest | null;
  /** Answer the incoming request — granting hands control to the asker. */
  respondToRequest: (granted: boolean) => void;
}

export function useEditLock(opts: {
  kind: string;
  id: string | undefined;
  userId: string | undefined;
  name: string;
  role?: string | null;
  isSuperbob?: boolean | null;
  enabled?: boolean;
}): EditLock {
  const { kind, id, userId, name, role, isSuperbob, enabled = true } = opts;

  const [ready, setReady] = useState(false);
  const [ownerMeta, setOwnerMeta] = useState<PresenceMeta | null>(null);
  const [metas, setMetas] = useState<PresenceMeta[]>([]);
  const [incomingRequest, setIncomingRequest] = useState<EditAccessRequest | null>(null);
  const [requestStatus, setRequestStatus] = useState<EditRequestStatus>('idle');

  // Presence is keyed per TAB, not per user: keying by userId merged a person's
  // two tabs into one entry, so both believed they held the lock and both wrote.
  // The identity is persisted in sessionStorage (per tab, survives reload) so a
  // refresh RE-CLAIMS the same presence slot instead of joining as a stranger —
  // otherwise the pre-refresh entry lingers as a ghost owner until it times out,
  // which locked the refreshed tab out of its own report.
  const identity = useRef<TabIdentity | null>(null);
  if (!identity.current) identity.current = loadIdentity(kind, id);
  const clientIdRef = useRef<string>(identity.current.clientId);
  const joinedAtRef = useRef<number>(identity.current.joinedAt);
  const claimSeqRef = useRef<number>(identity.current.claimSeq);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const metasRef = useRef<PresenceMeta[]>([]);
  const isOwnerRef = useRef(true);
  const requestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest identity, so take-over re-tracks with it without re-subscribing.
  const nameRef = useRef(name);
  nameRef.current = name;
  const rank = editRank(role, isSuperbob);
  const rankRef = useRef(rank);
  rankRef.current = rank;

  const track = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !userId) return;
    void ch.track({
      clientId: clientIdRef.current,
      userId,
      name: nameRef.current,
      joinedAt: joinedAtRef.current,
      claimSeq: claimSeqRef.current,
      rank: rankRef.current,
    } as PresenceMeta);
  }, [userId]);

  /** Claim ownership outright by outbidding every present claim. */
  const takeOver = useCallback(() => {
    if (!channelRef.current || !userId) return;
    const maxSeq = metasRef.current.reduce((m, x) => Math.max(m, x.claimSeq ?? 0), 0);
    claimSeqRef.current = maxSeq + 1;
    // Remember the claim so a reload doesn't hand control back to whoever we
    // just took it from.
    saveIdentity(kind, id, {
      clientId: clientIdRef.current,
      joinedAt: joinedAtRef.current,
      claimSeq: claimSeqRef.current,
    });
    setRequestStatus('idle');
    track();
  }, [userId, track, kind, id]);

  useEffect(() => {
    if (!enabled || !id || !userId) return;

    const channel = supabase.channel(`report-edit:${kind}:${id}`, {
      config: { presence: { key: clientIdRef.current } },
    });
    channelRef.current = channel;

    const sync = () => {
      const state = channel.presenceState<PresenceMeta>();
      const list = (Object.values(state).flat() as PresenceMeta[])
        .filter(m => !!m && !!m.userId && !!m.clientId);
      const owner = list.length === 0 ? null : [...list].sort((a, b) => {
        if (b.claimSeq !== a.claimSeq) return b.claimSeq - a.claimSeq;   // higher claim wins
        if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;   // earlier join wins
        return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0;  // stable
      })[0];
      metasRef.current = list;
      isOwnerRef.current = !owner || owner.clientId === clientIdRef.current;
      setMetas(list);
      setOwnerMeta(owner);
      // Drop a request whose asker has left, and any prompt aimed at a client
      // that no longer holds control.
      setIncomingRequest(cur => {
        if (!cur) return cur;
        if (!isOwnerRef.current) return null;
        return list.some(m => m.clientId === cur.clientId) ? cur : null;
      });
      // Control arrived (granted, or the editor simply left) — nothing to wait for.
      if (isOwnerRef.current) setRequestStatus(s => (s === 'pending' ? 'idle' : s));
    };

    channel
      .on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .on('broadcast', { event: REQUEST_EVENT }, ({ payload }) => {
        // Only the current editor is asked, and only they can answer.
        if (payload?.toId !== clientIdRef.current || !isOwnerRef.current) return;
        setIncomingRequest({ clientId: payload.fromId, name: payload.fromName || 'A teammate' });
      })
      .on('broadcast', { event: RESPONSE_EVENT }, ({ payload }) => {
        if (payload?.toId !== clientIdRef.current) return;
        if (requestTimerRef.current) clearTimeout(requestTimerRef.current);
        if (payload.granted) takeOver();
        else setRequestStatus('denied');
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            clientId: clientIdRef.current,
            userId,
            name: nameRef.current,
            joinedAt: joinedAtRef.current,
            claimSeq: claimSeqRef.current,
            rank: rankRef.current,
          } as PresenceMeta);
          setReady(true);
        }
      });

    // Leave presence the moment the tab goes away, so a closed editor doesn't
    // linger as a ghost owner and lock everyone else out until it times out.
    const release = () => { try { void channel.untrack(); } catch { /* noop */ } };
    window.addEventListener('pagehide', release);

    return () => {
      window.removeEventListener('pagehide', release);
      // Cleanup runs when we navigate AWAY from the editor, but not on a reload
      // — so this is what tells the next mount it must re-join at the back of
      // the queue instead of reclaiming control it walked away from.
      saveIdentity(kind, id, {
        clientId: clientIdRef.current,
        joinedAt: joinedAtRef.current,
        claimSeq: claimSeqRef.current,
        left: true,
      });
      if (requestTimerRef.current) clearTimeout(requestTimerRef.current);
      setReady(false);
      setOwnerMeta(null);
      setMetas([]);
      setIncomingRequest(null);
      setRequestStatus('idle');
      metasRef.current = [];
      isOwnerRef.current = true;
      channelRef.current = null;
      try { supabase.removeChannel(channel); } catch { /* noop */ }
    };
  }, [enabled, kind, id, userId, takeOver]);

  const isOwner = !ownerMeta || ownerMeta.clientId === clientIdRef.current;
  const isLockedOut = ready && !isOwner;
  // Reclaiming control from your own other tab never needs permission.
  const canForceTakeOver = !ownerMeta
    || ownerMeta.userId === userId
    || rank > (ownerMeta.rank ?? 0);

  const requestTakeOver = useCallback(() => {
    const ch = channelRef.current;
    const owner = ownerMeta;
    if (!ch || !userId || !owner || owner.clientId === clientIdRef.current) return;
    // Outranking the editor — or reclaiming from your own other tab — needs no
    // permission.
    if (owner.userId === userId || rank > (owner.rank ?? 0)) { takeOver(); return; }
    setRequestStatus('pending');
    if (requestTimerRef.current) clearTimeout(requestTimerRef.current);
    requestTimerRef.current = setTimeout(
      () => setRequestStatus(s => (s === 'pending' ? 'idle' : s)),
      REQUEST_TIMEOUT_MS,
    );
    void ch.send({
      type: 'broadcast',
      event: REQUEST_EVENT,
      payload: { fromId: clientIdRef.current, fromName: nameRef.current, toId: owner.clientId },
    });
  }, [ownerMeta, rank, userId, takeOver]);

  const respondToRequest = useCallback((granted: boolean) => {
    const ch = channelRef.current;
    const asker = incomingRequest;
    setIncomingRequest(null);
    if (!ch || !userId || !asker) return;
    void ch.send({
      type: 'broadcast',
      event: RESPONSE_EVENT,
      payload: { fromId: clientIdRef.current, toId: asker.clientId, granted },
    });
  }, [incomingRequest, userId]);

  const othersCount = new Set(
    metas.filter(m => m.userId && m.userId !== userId).map(m => m.userId),
  ).size;

  return {
    ready,
    isOwner: ready ? isOwner : true,
    isLockedOut,
    editorName: isLockedOut
      ? (ownerMeta?.userId === userId ? 'You, in another tab' : (ownerMeta?.name ?? null))
      : null,
    controllerName: ownerMeta?.name ?? null,
    othersCount,
    canForceTakeOver,
    takeOver,
    requestTakeOver,
    requestStatus,
    incomingRequest: isOwner ? incomingRequest : null,
    respondToRequest,
  };
}
