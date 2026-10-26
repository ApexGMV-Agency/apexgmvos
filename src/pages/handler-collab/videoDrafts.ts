/* ════════════════════════════════════════════════════════════════════════
   Video DRAFTS — a creator's draft of a deal video, reviewed by the handler
   before it is posted.

   A draft belongs to ONE video slot (8.1), so it lives on that slot's row in
   handler_collab_creators.video_codes:

     { video, adCode, auth, …,
       drafts: [ { n: 1, url, status: 'rejected', reason, at, reviewedAt, reviewedBy },
                 { n: 2, url, adCode?, status: 'review', at } ] }

   A draft may carry its AD CODE (optional — often it only exists once the
   draft is posted). It stays on the draft; "Use as posted link" copies it into
   the slot's adCode only when that field is still empty.

   ‼️ A DRAFT URL NEVER GOES INTO `video`. That one rule is what keeps every
   existing reader safe: the posted-video count, "all videos posted →
   Payment Pending", Best Videos, the ad-code columns, exports and every
   client surface read `video` only, so a draft cannot be counted, starred or
   shown to a client by accident.

   ‼️ HANDLER-ONLY. Nothing outside the handler workspace renders drafts, and
   get-shared-reports strips the key before the share link's payload leaves
   the server.

   The DB counts drafts as ACTIVITY (migration 20261017090000): a new draft
   restarts the 7-day follow-up timer, exactly like a posted video does.
   draftCount() below is the front-end twin of handler_collab_draft_count().

   PURE — no React, no Supabase.
════════════════════════════════════════════════════════════════════════ */

export type DraftStatus = 'review' | 'approved' | 'rejected';

export interface VideoDraft {
  n: number;              // 1-based draft number for its slot: D1, D2, …
  url: string;
  adCode?: string;        // the draft's ad code, when the creator already has one
  status: DraftStatus;
  at: string;             // when it was submitted (ISO)
  reason?: string;        // why it was rejected — required on reject
  reviewedAt?: string;
  reviewedBy?: string;
}

const STATUSES: DraftStatus[] = ['review', 'approved', 'rejected'];

export const DRAFT_STATUS_META: Record<DraftStatus, { label: string; cls: string; icon: string }> = {
  review:   { label: 'Under review', cls: 'review',   icon: 'bi-hourglass-split' },
  approved: { label: 'Approved',     cls: 'approved', icon: 'bi-check-circle-fill' },
  rejected: { label: 'Rejected',     cls: 'rejected', icon: 'bi-x-circle-fill' },
};

/** Read a row's drafts defensively: a hand-edited or older row may carry
 *  junk, and this list is rendered and written back whole. */
export function normalizeDrafts(raw: unknown): VideoDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: VideoDraft[] = [];
  for (const d of raw) {
    if (!d || typeof d !== 'object') continue;
    const r = d as Record<string, unknown>;
    const url = String(r.url ?? '').trim();
    if (!url) continue;
    const status = STATUSES.includes(r.status as DraftStatus) ? (r.status as DraftStatus) : 'review';
    const draft: VideoDraft = {
      n: 0,
      url,
      status,
      at: typeof r.at === 'string' ? r.at : '',
    };
    if (typeof r.adCode === 'string' && r.adCode.trim()) draft.adCode = r.adCode.trim();
    if (typeof r.reason === 'string' && r.reason.trim()) draft.reason = r.reason.trim();
    if (typeof r.reviewedAt === 'string' && r.reviewedAt) draft.reviewedAt = r.reviewedAt;
    if (typeof r.reviewedBy === 'string' && r.reviewedBy.trim()) draft.reviewedBy = r.reviewedBy.trim();
    out.push(draft);
  }
  // Numbers are POSITIONAL — D1 is the first draft, whatever was stored —
  // so a removed draft can never leave a gap or a duplicate number.
  return out.map((d, i) => ({ ...d, n: i + 1 }));
}

/** The draft the slot is currently on (the newest), or null. */
export function latestDraft(drafts: VideoDraft[]): VideoDraft | null {
  return drafts.length ? drafts[drafts.length - 1] : null;
}

/** May a new draft be added to this slot? Not while one is waiting for a
 *  decision, not once one is approved, and not once the video is posted. */
export function canAddDraft(drafts: VideoDraft[], postedUrl: string | null | undefined): boolean {
  if (String(postedUrl ?? '').trim()) return false;
  const last = latestDraft(drafts);
  return !last || last.status === 'rejected';
}

/** What the slot is waiting on, for the row's chip. Null = nothing to say. */
export function slotDraftState(row: { video?: string; drafts?: unknown }): DraftStatus | null {
  if (String(row?.video ?? '').trim()) return null;   // posted: the draft story is over
  const last = latestDraft(normalizeDrafts(row?.drafts));
  return last ? last.status : null;
}

/** Deal rows with a draft waiting for the handler's decision. */
export function pendingDraftCount(codes: unknown): number {
  if (!Array.isArray(codes)) return 0;
  return codes.filter((r: any) => r && !r.extra && slotDraftState(r) === 'review').length;
}

/** Every draft ever submitted on the deal rows — the twin of SQL
 *  handler_collab_draft_count(), which drives the follow-up timer. */
export function draftCount(codes: unknown): number {
  if (!Array.isArray(codes)) return 0;
  return codes.reduce((n: number, r: any) => n + (r && !r.extra ? normalizeDrafts(r.drafts).length : 0), 0);
}

/** "8.1 · D2" — the slot number and the draft number together. */
export function draftLabel(slotNo: string, n: number): string {
  return `${slotNo} · D${n}`;
}

/** The DM to send the creator when a draft is rejected. Creators have no
 *  login here, so the handler copies this and sends it themselves. */
export function draftRejectMessage(creatorName: string | null | undefined, slotNo: string, draftN: number, reason: string): string {
  const first = String(creatorName ?? '').trim().split(/\s+/)[0] || 'there';
  return `Hi ${first}! Thanks for the draft of video ${slotNo} (draft ${draftN}). `
    + `Before it goes live, could you please make these changes:\n\n${String(reason || '').trim()}\n\n`
    + `Send over the new draft when it's ready. Thank you!`;
}

/** The DM to send when a draft is approved. */
export function draftApproveMessage(creatorName: string | null | undefined, slotNo: string): string {
  const first = String(creatorName ?? '').trim().split(/\s+/)[0] || 'there';
  return `Hi ${first}! Your draft of video ${slotNo} is approved, you're good to post it. `
    + `Please send over the live TikTok link and the ad code once it's up. Thank you!`;
}
