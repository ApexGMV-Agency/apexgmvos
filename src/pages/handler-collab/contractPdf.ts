// Content Creation Agreement PDF — the standard Afflix creator contract,
// generated per deal from the handler workspace ("Contract" column).
// Layout mirrors the reference agreement (title, sections 1–8, brand +
// creator signature blocks); only the deal facts change: brand name,
// creator username, videos count, deal amount, payment method, dates and
// the featured product line.
// jspdf is imported lazily so it stays out of the main bundle.
import { currencySymbol } from '../../lib/currency';

export type ContractInput = {
  brandName: string;
  creatorName?: string;
  username: string;          // TikTok username, no leading @
  amount: number;            // deal amount (in `currency`)
  currency?: string | null;  // brand region currency (USD/GBP/EUR); default USD
  videosCount: number;       // 0 = unknown → neutral wording
  deliverableDays?: number | null; // §2 completion window; null/0 = automatic (10 for <6 videos, else 14)
  paymentMethod?: string;    // unused — contract always states "PayPal/Zelle"
  effectiveDate?: string | null; // ISO YYYY-MM-DD (onboarding date); null = today
  productNames?: string[];   // featured product(s); [] = "<brand> products"
  productLinks?: { name?: string; url: string }[]; // featured-product page links (clickable); omitted when none set
  contentGuideUrl?: string | null; // brand content-guide link (clickable); omitted when not set
  // Commission the creator earns on sales, quoted in §3 and promised in §5.
  // NULL/undefined = not stated, and the agreement then says nothing about
  // commission at all — deliberately, so a contract written before these
  // existed reads byte-for-byte as it did. 0 IS a statement ("no commission")
  // and is printed; that is why these are nullable rather than defaulted.
  standardCommission?: number | null;   // %
  shopAdsCommission?: number | null;    // %
  // Word joining the last two featured product names in §1 — "A, B and C" vs
  // "A, B or C". Unset reads "and" (older snapshots, signed that way); every
  // new snapshot is stamped "or" by contractPayloadFor.
  productJoin?: 'and' | 'or';
  // The handler PICKED these in the contract modal rather than inheriting them
  // from the deal. Purely a marker for the modal: it tells the snapshot rebuild
  // (which re-reads the deal on every open) to keep the hand-picked values
  // instead of overwriting them. The renderers ignore both flags.
  productsPinned?: boolean;
  guidePinned?: boolean;
  commissionPinned?: boolean;
  // Handler's contract-template settings (signature block only):
  repName?: string;              // Brand Representative name
  signatureDataUrl?: string | null; // PNG data URL, drawn/embedded on the Signature line
  // Creator's e-signature (public /sign/:token page). Only set once the creator
  // has signed — an unsigned copy keeps the blank Signature / Date lines.
  creatorSignatureDataUrl?: string | null;
  creatorSignedName?: string | null; // typed full name, printed on the Name line
  creatorSignedAt?: string | null;   // ISO timestamp of the signature
  // Per-section customizations the handler layers on top of the standard
  // template in the Contract signing-link modal. `sectionEdits` overrides a
  // built-in section's heading/body by its id; `extraSections` are custom
  // sections appended after §8. Both flow through the model into the PDF AND
  // the preview, so a signed copy reflects exactly what the handler edited.
  sectionEdits?: Record<string, { heading?: string; body?: string }>;
  extraSections?: { id: string; heading: string; body: string }[];
  // §2's extra clauses, versioned (see buildContractModel): true = v1, 2 = v2.
  // Set on every snapshot built since they were added; absent on contracts
  // signed before, which therefore keep the wording the creator signed.
  contentRules?: boolean | 2;
};

// One run of contract text — bold and/or a clickable link. `url` makes the
// words render blue (PDF) / as an <a> (HTML preview).
export type CSeg = { t: string; b?: boolean; url?: string };
type Seg = CSeg; // internal alias so the existing PDF code reads unchanged

// A paragraph/bullet in the agreement body. `bullet` + `indent` drive the
// marker (filled dot at 22pt, stroked circle at 44pt). Shared by the PDF
// renderer and the HTML preview so their wording can never drift.
export type CBlock = { segs: CSeg[]; size?: number; indent?: number; bullet?: 'dot' | 'circle'; after?: number };
// `id` is stable per built-in section (or a generated `x_…` for custom ones);
// `edited`/`custom` are FE-only hints so the editable preview can badge them.
export type CSection = { id: string; heading: string; blocks: CBlock[]; edited?: boolean; custom?: boolean };

// Every value substituted into the agreement, resolved once from the deal.
export interface ContractFacts {
  brand: string;
  username: string;
  creatorName: string;
  amountTxt: string;   // "USD $1,234"
  method: string;      // always "PayPal / Zelle"
  dateTxt: string;     // effective / brand-signature date
  count: number;       // videos count (0 = unknown)
  nWords: string;      // "six (6)" / "the agreed number of"
  nShort: string;      // "six" / "the agreed"
  deadlineDays: number | null; // §2 completion window; null = don't state it
  featuringSegs: CSeg[];       // §1 "featuring A, B and C" (names clickable)
  prodLinks: { name: string; url: string }[]; // §1 reference product links
  guideUrl?: string;           // §1 reference content-guide link
  stdCommTxt?: string;         // "20%" — absent when the rate is not stated
  adsCommTxt?: string;         // "12.5%" — absent when the rate is not stated
  repName?: string;
  signatureDataUrl?: string | null;      // brand rep signature image
  creatorSignatureDataUrl?: string | null; // creator e-signature image
  creatorSignedName?: string;
  creatorSignedAt?: string | null;
}

// The whole agreement as data: title, party preamble, numbered sections 1–8
// and the resolved facts (which also drive the signature blocks + §1's
// reference links). The PDF and the HTML preview both render from this.
export interface ContractModel {
  title: string;
  parties: CBlock[];
  sections: CSection[];
  facts: ContractFacts;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 100) return String(n);
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
}

/* {token} substitution for hand-edited contract wording. */
export const CONTRACT_TOKENS: { token: string; desc: string }[] = [
  { token: 'brand', desc: 'Brand name' },
  { token: 'creator', desc: 'Creator TikTok username' },
  { token: 'creator_name', desc: 'Creator full name' },
  { token: 'products', desc: 'Featured product names' },
  { token: 'videos', desc: 'Video count in words, e.g. "six (6)"' },
  { token: 'videos_short', desc: 'Video count, e.g. "six"' },
  { token: 'amount', desc: 'Payment amount, e.g. "USD $500"' },
  { token: 'method', desc: 'Payment method' },
  { token: 'date', desc: 'Effective date' },
  { token: 'days', desc: 'Delivery window, e.g. "ten (10)"' },
  { token: 'standard_commission', desc: 'Standard commission %' },
  { token: 'shop_ads_commission', desc: 'Shop ads commission %' },
];
export function fillContractTokens(text: string, values: Record<string, string | undefined>): string {
  return String(text || '').replace(/\{([a-z_]+)\}/g, (m, k) => (values[k] ? values[k] as string : m));
}

export function fmtContractDate(iso?: string | null): string {
  const d = iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso) : new Date();
  if (isNaN(d.getTime())) return iso || '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)} / ${p(d.getDate())} / ${d.getFullYear()}`;
}

// Resolve the deal into the structured agreement (facts + parties + sections).
// This is the SINGLE SOURCE OF TRUTH for the contract's wording — both the PDF
// (`buildCreatorContract`) and the HTML preview (`ContractDoc`) render from it,
// so the two can never say different things. §1's reference links and the
// signature blocks are rendered by each surface from `facts`.
export function buildContractModel(input: ContractInput): ContractModel {
  const brand = (input.brandName || 'Brand').trim();
  const username = (input.username || '').trim();
  const count = Math.max(0, Math.round(input.videosCount || 0));
  // Deal amount in the brand's region currency, e.g. "USD $1,234" / "GBP £1,234".
  const cur = (input.currency || 'USD').toUpperCase();
  const amountTxt = `${cur} ${currencySymbol(cur)}${Math.round(input.amount || 0).toLocaleString()}`;
  const method = 'PayPal / Zelle'; // always both, regardless of the deal's saved payout details
  const dateTxt = fmtContractDate(input.effectiveDate);
  const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
  const prodLinksIn = (input.productLinks || []).filter(p => isHttp(p.url));
  const linkByName = new Map(prodLinksIn.filter(p => p.name).map(p => [String(p.name).trim().toLowerCase(), p.url]));
  const guideUrl = isHttp(input.contentGuideUrl) ? (input.contentGuideUrl as string) : undefined;
  const featNames = (input.productNames || []).filter(Boolean);
  const urlFor = (n: string) => linkByName.get(n.trim().toLowerCase())
    ?? (featNames.length === 1 && prodLinksIn.length === 1 ? prodLinksIn[0].url : undefined);
  // "A, B and C" as segments — each name clickable when it has a link. The
  // handler picks the conjunction in the contract modal: "and" (all of them)
  // or "or" (any of them).
  const joinWord = input.productJoin === 'or' ? 'or' : 'and';
  const featuringSegs: CSeg[] = featNames.length
    ? featNames.flatMap((n, i) => {
        const segs: CSeg[] = [{ t: i < featNames.length - 2 ? `${n},` : n, url: urlFor(n) }];
        if (i === featNames.length - 2) segs.push({ t: joinWord });
        return segs;
      })
    : [{ t: `${brand} products` }];
  // "six (6)" when the deal size is known, neutral wording when it isn't
  const nWords = count > 0 ? `${numWords(count)} (${count})` : 'the agreed number of';
  const nShort = count > 0 ? `${numWords(count)}` : 'the agreed';
  // Completion deadline: the handler's per-deal override when set, else it
  // scales with deal size (<6 videos → 10 days, 6+ → 14). Only stated when the
  // video count is known or an explicit override exists.
  const override = Math.round(Number(input.deliverableDays) || 0);
  const deadlineDays = (count > 0 || override > 0) ? (override > 0 ? override : (count < 6 ? 10 : 14)) : null;
  const prodLinks = prodLinksIn.map((p, i) => ({ name: p.name || `Product ${i + 1}`, url: p.url }));

  /* A rate is stated only when it is a real number in 0–100. undefined/null is
     "not stated" and prints nothing anywhere in the agreement; 0 prints as
     "0%", because agreeing to no commission is a term, not a missing one. */
  const pctTxt = (v: number | null | undefined): string | undefined => {
    if (v === null || v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
    return `${Number(n.toFixed(2))}%`;
  };
  const stdCommTxt = pctTxt(input.standardCommission);
  const adsCommTxt = pctTxt(input.shopAdsCommission);

  const facts: ContractFacts = {
    brand, username, creatorName: input.creatorName || '',
    amountTxt, method, dateTxt, count, nWords, nShort, deadlineDays,
    featuringSegs, prodLinks, guideUrl, stdCommTxt, adsCommTxt,
    repName: input.repName,
    signatureDataUrl: input.signatureDataUrl,
    creatorSignatureDataUrl: input.creatorSignatureDataUrl,
    creatorSignedName: input.creatorSignedName || '',
    creatorSignedAt: input.creatorSignedAt || null,
  };

  const parties: CBlock[] = [
    { segs: [{ t: 'This Content Creation Agreement ("Agreement") is entered into between:' }], after: 12 },
    { segs: [{ t: 'Brand:', b: true }, { t: brand }], after: 2 },
    { segs: [{ t: 'Creator:', b: true }, { t: username || input.creatorName || '—' }], after: 2 },
    { segs: [{ t: 'Effective Date:', b: true }, { t: dateTxt }], after: 4 },
  ];

  /* §3 states the commission the creator earns on top of the flat fee, and §5
     is the Brand's undertaking to keep those rates in place. Both are built
     from ONE resolution above, so the two sections can never quote different
     numbers. With neither rate stated both arrays are empty and the agreement
     is byte-for-byte the one it has always been. */
  const commLines: CBlock[] = [
    ...(stdCommTxt ? [{ segs: [{ t: 'Standard commission:', b: true }, { t: stdCommTxt, b: true }, { t: 'of the sale price on qualifying orders attributed to the Creator.' }], indent: 22, bullet: 'dot' as const, after: 2 }] : []),
    ...(adsCommTxt ? [{ segs: [{ t: 'Shop ads commission:', b: true }, { t: adsCommTxt, b: true }, { t: "of the sale price on orders attributed to Shop Ads running the Creator's content." }], indent: 22, bullet: 'dot' as const, after: 2 }] : []),
  ];
  const commissionBlocks: CBlock[] = commLines.length ? [
    { segs: [{ t: 'In addition to the payment above, the Creator earns commission on sales generated through the content covered by this Agreement:' }], after: 4 },
    ...commLines,
    { segs: [{ t: "Commission is calculated and paid out through TikTok Shop's own affiliate reporting and payout schedule, separately from the payment above." }], after: 8 },
  ] : [];
  const brandCommBlock: CBlock[] = commLines.length ? [
    { segs: [
        { t: 'Keep the agreed commission' },
        ...(stdCommTxt && adsCommTxt
          ? [{ t: 'rates' }, { t: `— ${stdCommTxt} standard and ${adsCommTxt} shop ads —`, b: true }]
          : [{ t: 'rate of' }, { t: (stdCommTxt || adsCommTxt) as string, b: true }]),
        { t: 'active on the featured products for the term of this Agreement.' },
      ], indent: 22, bullet: 'dot', after: 2 },
  ] : [];

  const deadlineBlock: CBlock[] = deadlineDays != null
    ? [{ segs: [{ t: 'Complete the deliverables within' }, { t: `${numWords(deadlineDays)} (${deadlineDays}) days`, b: true }, { t: 'after the sample has been delivered.' }], indent: 22, bullet: 'dot', after: 2 }]
    : [];

  /* The §2 clause set, VERSIONED by the snapshot's `contentRules`:
       absent  -> none (contracts made before the clauses existed);
       true    -> v1, 2026-10-02: Originality + a Posting Schedule naming the
                  video count ("The ten (10) videos");
       2       -> v2, 2026-10-05: Content Pre-Approval first, then Originality,
                  and a Posting Schedule that says just "The videos".
     A signed contract's payload is frozen, so it keeps the version it was
     signed under; an unsigned one is re-snapshotted (to the newest) whenever
     its Contract popup is opened. Never edit an old version's wording in
     place — add a new number. */
  const rulesVersion = input.contentRules === 2 ? 2 : input.contentRules ? 1 : 0;
  const videosLead = rulesVersion === 1 && count > 0 ? `The ${numWords(count)} (${count}) videos` : 'The videos';
  const preApprovalBlocks: CBlock[] = rulesVersion >= 2 ? [
    { segs: [{ t: 'Content Pre-Approval', b: true }], indent: 22, bullet: 'dot', after: 2 },
    { segs: [{ t: "Before publishing any video, the Creator must submit the completed video draft to the Brand through the designated Google Drive folder for review and approval. The Creator may publish the video on TikTok only after receiving explicit approval from the Brand. If a submitted video does not meet the Brand's requirements, the Creator must revise or remake the video as requested and resubmit it for review. Once the video is approved, the Creator may publish it on TikTok and proceed with the collaboration." }], indent: 22, after: 6 },
  ] : [];
  const contentRulesBlocks: CBlock[] = rulesVersion >= 1 ? [
    ...preApprovalBlocks,
    { segs: [{ t: 'Content Originality and Variation', b: true }], indent: 22, bullet: 'dot', after: 2 },
    { segs: [{ t: 'Each video must contain substantially original and varied content. Repetitive content is not permitted, including substantially similar visuals, hooks, content angles, scripts, formats, or concepts, or multiple videos that are substantially similar and were filmed or produced together for repeated posting. The Creator shall make reasonable efforts to develop and use new content ideas for each video. The "Content Angles," "Hooks," and "Reference Videos" provided in the applicable' }, { t: 'content brief', url: guideUrl }, { t: 'should be used as guidance when developing the videos.' }], indent: 22, after: 6 },
    { segs: [{ t: 'Posting Schedule', b: true }], indent: 22, bullet: 'dot', after: 2 },
    { segs: [{ t: `${videosLead} must be published individually with a minimum interval of` }, { t: 'eight (8) hours', b: true }, { t: 'between each upload. Videos must not be published simultaneously or in batches without maintaining the required eight-hour interval.' }], indent: 22 },
  ] : [];

  const baseSections: Omit<CSection, 'id'>[] = [
    { heading: '1. Purpose', blocks: [
      { segs: [{ t: 'The Creator agrees to create and publish' }, { t: `${nWords} original TikTok videos`, b: true }, { t: 'featuring' }, ...featuringSegs, { t: "on the Creator's official TikTok account." }] },
    ] },
    { heading: '2. Deliverables', blocks: [
      { segs: [{ t: 'The Creator agrees to:' }], after: 4 },
      { segs: [{ t: 'Create and publish a total of' }, { t: `${nWords} TikTok videos`, b: true }, { t: `featuring ${brand}.` }], indent: 22, bullet: 'dot', after: 2 },
      { segs: [{ t: 'Creator is required to follow the' }, { t: 'content brief (guide).', url: guideUrl }], indent: 22, bullet: 'dot', after: 2 },
      { segs: [{ t: "Keep the videos publicly available on the Creator's TikTok account." }], indent: 22, bullet: 'dot', after: 2 },
      ...deadlineBlock,
      { segs: [{ t: 'After all' }, { t: `${nShort} videos`, b: true }, { t: 'have been posted, provide the Brand with:' }], indent: 22, bullet: 'dot', after: 2 },
      { segs: [{ t: 'The links to all' }, { t: `${nShort} published TikTok videos.`, b: true }], indent: 44, bullet: 'circle', after: 2 },
      { segs: [{ t: 'The TikTok Spark Ad Codes (Ad Authorization Codes) for each video for 365 days.' }], indent: 44, bullet: 'circle', after: contentRulesBlocks.length ? 8 : undefined },
      ...contentRulesBlocks,
    ] },
    { heading: '3. Compensation', blocks: [
      { segs: [{ t: 'Upon successful completion of all deliverables outlined in this Agreement, the Brand agrees to pay the Creator:' }], after: 4 },
      { segs: [{ t: 'Payment Amount:', b: true }, { t: amountTxt, b: true }], after: 2 },
      { segs: [{ t: 'Payment Method:', b: true }, { t: method, b: true }], after: 8 },
      ...commissionBlocks,
      { segs: [{ t: 'Payment will be sent after the Brand has received and verified:' }], after: 4 },
      { segs: [{ t: 'All' }, { t: `${nWords} published TikTok video links;`, b: true }, { t: 'and' }], indent: 22, bullet: 'dot', after: 2 },
      { segs: [{ t: 'The corresponding TikTok Spark Ad Codes.' }], indent: 22, bullet: 'dot' },
    ] },
    { heading: '4. Creator Responsibilities', blocks: [
      { segs: [{ t: 'The Creator confirms that:' }], after: 4 },
      { segs: [{ t: 'All content created will be original.' }], indent: 22, bullet: 'dot', after: 2 },
      { segs: [{ t: "The videos will be published on the Creator's TikTok account." }], indent: 22, bullet: 'dot', after: 2 },
      { segs: [{ t: 'The provided video links and Spark Ad Codes will be valid and functional.' }], indent: 22, bullet: 'dot' },
    ] },
    { heading: '5. Brand Responsibilities', blocks: [
      { segs: [{ t: 'The Brand agrees to:' }], after: 4 },
      { segs: [{ t: 'Review the submitted deliverables in a timely manner.' }], indent: 22, bullet: 'dot', after: 2 },
      { segs: [{ t: 'Send the full payment of' }, { t: amountTxt, b: true }, { t: 'via' }, { t: method, b: true }, { t: 'after all agreed deliverables have been completed and received.' }], indent: 22, bullet: 'dot', after: commLines.length ? 2 : 0 },
      ...brandCommBlock,
    ] },
    { heading: '6. Ownership', blocks: [
      { segs: [{ t: 'The Creator retains ownership of the original content. Any additional content usage rights beyond the delivery of Spark Ad Codes must be agreed upon separately in writing.' }] },
    ] },
    { heading: '7. Termination', blocks: [
      { segs: [{ t: 'Either party may terminate this Agreement only through written mutual consent. If the Creator fails to complete the agreed deliverables, the Brand shall have no obligation to issue payment.' }] },
    ] },
    { heading: '8. Entire Agreement', blocks: [
      { segs: [{ t: 'This document represents the complete agreement between both parties and supersedes all prior discussions or communications relating to this collaboration.' }], after: 16 },
    ] },
  ];

  // Stamp stable ids, then layer the handler's per-section edits + custom
  // sections on top. Editing a built-in section freezes its wording (the
  // template variables no longer re-substitute into it) — expected behaviour.
  const SECTION_IDS = ['purpose', 'deliverables', 'compensation', 'creator_resp', 'brand_resp', 'ownership', 'termination', 'entire'];
  const edits = input.sectionEdits || {};
  /* Hand-edited wording may carry {placeholders} — that is what lets a user's
     DEFAULT template (handler_contract_settings.template) be reused on every
     deal instead of freezing one deal's numbers into it. Unknown or unfillable
     tokens stay visible as {token}. */
  const tokenValues: Record<string, string | undefined> = {
    brand,
    creator: username || input.creatorName || undefined,
    creator_name: input.creatorName || username || undefined,
    products: featNames.length ? featNames.join(', ') : `${brand} products`,
    videos: nWords,
    videos_short: nShort,
    amount: amountTxt,
    method,
    date: dateTxt,
    days: deadlineDays != null ? `${numWords(deadlineDays)} (${deadlineDays})` : undefined,
    standard_commission: stdCommTxt,
    shop_ads_commission: adsCommTxt,
  };
  const fill = (t: string) => fillContractTokens(t, tokenValues);
  const sections: CSection[] = baseSections.map((s, i) => {
    const id = SECTION_IDS[i] || `s${i}`;
    const e = edits[id];
    if (!e) return { ...s, id };
    return {
      ...s,
      id,
      heading: (e.heading != null && e.heading.trim() !== '') ? fill(e.heading) : s.heading,
      blocks: e.body != null ? textToBlocks(fill(e.body)) : s.blocks,
      edited: true,
    };
  });
  for (const ex of (input.extraSections || [])) {
    if (!ex || !ex.id) continue;
    sections.push({ id: ex.id, heading: fill(ex.heading || 'Untitled section'), blocks: textToBlocks(fill(ex.body || '')), custom: true });
  }

  return { title: 'CONTENT CREATION AGREEMENT', parties, sections, facts };
}

/* ── inline markup for hand-edited sections ──
   A section body is edited as PLAIN TEXT, but the template it replaces is a
   list of runs that can be bold and/or clickable. Flattening those away would
   mean that changing one word of §1 — say "and" to "or" between two products —
   silently cost the product links and every bit of emphasis. So the two
   conversions below carry them through a Markdown-flavoured notation the
   handler can also type by hand:

     **bold**                 -> { b: true }
     [label](https://…)       -> { url }
     [**label**](https://…)   -> both

   Bodies saved before this notation existed contain neither form, so they
   round-trip byte-for-byte. `textToSegs` is the ONLY place the notation is
   read and `segsToText` the only place it is written — keep them inverse. */
const INLINE_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*/g;

export function textToSegs(line: string): CSeg[] {
  const segs: CSeg[] = [];
  const push = (t: string, b?: boolean, url?: string) => {
    const v = String(t).replace(/\s+/g, ' ').trim();
    if (!v) return;
    const seg: CSeg = { t: v };
    if (b) seg.b = true;
    if (url) seg.url = url;
    segs.push(seg);
  };
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(line))) {
    push(line.slice(last, m.index));
    if (m[1] != null) {
      // A link label that is entirely bold keeps both marks on one run.
      const bold = m[1].match(/^\*\*([\s\S]+)\*\*$/);
      push(bold ? bold[1] : m[1], !!bold, m[2]);
    } else {
      push(m[3], true);
    }
    last = m.index + m[0].length;
  }
  push(line.slice(last));
  return segs.length ? segs : [{ t: line.replace(/\s+/g, ' ').trim() }];
}

function segsToText(segs: CSeg[]): string {
  return segs.map(sg => {
    let t = String(sg.t).replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (sg.b) t = `**${t}**`;
    if (sg.url) t = `[${t}](${sg.url})`;
    return t;
  }).filter(Boolean).join(' ').trim();
}

// Plain text → contract blocks. One line per block; a line starting with
// "- " / "* " / "• " becomes a bullet (indent it two spaces for a sub-bullet).
// Inline **bold** and [links](https://…) are honoured. Used for handler-edited
// section bodies and custom sections.
export function textToBlocks(body: string): CBlock[] {
  const lines = String(body || '').replace(/\r/g, '').split('\n');
  const blocks: CBlock[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^[-*•]\s+(.*)$/);
    if (m) {
      const sub = /^(?:\s{2,}|\t)/.test(raw); // indented bullet → sub-bullet
      blocks.push({ segs: textToSegs(m[1]), indent: sub ? 44 : 22, bullet: sub ? 'circle' : 'dot', after: 2 });
    } else {
      blocks.push({ segs: textToSegs(line) });
    }
  }
  return blocks.length ? blocks : [{ segs: [{ t: ' ' }] }];
}

// Contract blocks → editable text (inverse of textToBlocks). Pre-fills the
// section editor when a handler edits a standard section for the first time,
// so the template arrives WITH its emphasis and its links intact.
export function blocksToText(blocks: CBlock[]): string {
  return blocks.map(b => {
    const text = segsToText(b.segs);
    if (b.bullet) return ((b.indent || 0) >= 44 ? '  - ' : '- ') + text;
    return text;
  }).join('\n');
}

// Build the agreement PDF in memory. `downloadCreatorContract` saves it.
// The public signing page READS the agreement as HTML (ContractDoc) and
// downloads this PDF afterwards — both render from `buildContractModel`, so a
// creator always downloads exactly what they read and signed.
export async function buildCreatorContract(input: ContractInput): Promise<{ doc: any; filename: string }> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 72; // 1" margins, like the reference doc
  let y = M + 14;

  // All wording + substituted values come from the shared model, so the PDF
  // and the on-screen preview stay identical.
  const model = buildContractModel(input);
  const f = model.facts;
  const { brand, username, dateTxt, prodLinks, guideUrl } = f;

  const ensure = (need: number) => {
    if (y + need > H - M) { doc.addPage(); y = M + 6; }
  };

  // Mixed bold/normal paragraph with word wrap, optional bullet (filled dot
  // for top-level, stroked circle for sub-items — cp1252 has no ○ glyph).
  function para(segs: Seg[], opts: { size?: number; indent?: number; bullet?: 'dot' | 'circle'; after?: number } = {}) {
    const size = opts.size ?? 11;
    const indent = opts.indent ?? 0;
    const maxW = W - M * 2 - indent;
    const words: { w: string; b: boolean; url?: string }[] = [];
    segs.forEach(s => String(s.t).split(/\s+/).forEach(w => { if (w) words.push({ w, b: !!s.b, url: s.url }); }));
    doc.setFontSize(size);
    doc.setFont('helvetica', 'normal');
    const spaceW = doc.getTextWidth(' ');
    const wWidth = (word: { w: string; b: boolean }) => {
      doc.setFont('helvetica', word.b ? 'bold' : 'normal');
      return doc.getTextWidth(word.w);
    };
    const lines: { w: string; b: boolean; url?: string }[][] = [];
    let line: { w: string; b: boolean; url?: string }[] = [], lw = 0;
    for (const word of words) {
      const ww = wWidth(word);
      if (line.length && lw + spaceW + ww > maxW) { lines.push(line); line = [word]; lw = ww; }
      else { lw += (line.length ? spaceW : 0) + ww; line.push(word); }
    }
    if (line.length) lines.push(line);
    const lineH = size * 1.5;
    lines.forEach((ln, i) => {
      ensure(lineH);
      if (i === 0 && opts.bullet) {
        doc.setDrawColor(40, 40, 40); doc.setFillColor(40, 40, 40); doc.setLineWidth(1);
        doc.circle(M + indent - 13, y - size * 0.32, 2, opts.bullet === 'dot' ? 'F' : 'S');
      }
      let x = M + indent;
      for (const word of ln) {
        doc.setFont('helvetica', word.b ? 'bold' : 'normal');
        doc.setFontSize(size);
        if (word.url) {
          doc.setTextColor(17, 85, 204);
          doc.textWithLink(word.w, x, y, { url: word.url });
        } else {
          doc.setTextColor(35, 35, 35);
          doc.text(word.w, x, y);
        }
        x += doc.getTextWidth(word.w) + spaceW;
      }
      y += lineH;
    });
    y += opts.after ?? 6;
  }

  function heading(t: string) {
    y += 10;
    ensure(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(0, 0, 0);
    doc.text(t, M, y);
    y += 21;
  }

  function rule() {
    ensure(30);
    doc.setDrawColor(185, 185, 185); doc.setLineWidth(0.8);
    doc.line(M, y, W - M, y);
    y += 28;
  }

  /* ── title ── */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(21);
  doc.setTextColor(0, 0, 0);
  doc.text(model.title, W / 2, y, { align: 'center' });
  y += 42;

  /* ── party header ── */
  model.parties.forEach(b => para(b.segs, b));

  /* ── sections 1–8 (§1 gains the reference links after its Purpose para) ── */
  model.sections.forEach((s, si) => {
    heading(s.heading);
    s.blocks.forEach(b => para(b.segs, b));
    if (si === 0) referenceLinks();
  });

  // Reference links (only when set): featured-product pages + the brand's
  // content guide, rendered as clickable blue URLs (kept as raw URLs so a
  // printed copy stays usable).
  function linkLines(url: string, indent: number, after = 4) {
    const size = 10.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    const lines: string[] = doc.splitTextToSize(url, W - M * 2 - indent);
    const lineH = size * 1.45;
    for (const ln of lines) {
      ensure(lineH);
      doc.setTextColor(17, 85, 204);
      doc.textWithLink(ln, M + indent, y, { url });
      y += lineH;
    }
    y += after;
  }
  // §1's featured-product + content-guide reference links, drawn from facts
  // right after the Purpose paragraph.
  function referenceLinks() {
    if (prodLinks.length) {
      para([{ t: `Featured product link${prodLinks.length > 1 ? 's' : ''}:`, b: true }], { after: 2 });
      prodLinks.forEach((p) => {
        para([{ t: p.name, url: p.url }], { indent: 22, bullet: 'dot', after: 0 });
        linkLines(p.url, 22, 3);
      });
      y += 2;
    }
    if (guideUrl) {
      para([{ t: 'Brand content guide:', b: true }], { after: 2 });
      linkLines(guideUrl, 22);
    }
  }

  // "Signature:" line with the handler's saved signature image drawn over the
  // blank line (reference doc has a handwritten scrawl there). Falls back to
  // the plain underscore line when no image is available/parsable.
  function signatureLine(img?: string | null) {
    if (!img) { para([{ t: 'Signature:', b: true }, { t: '____________________' }], { after: 6 }); return; }
    let w = 120, h = 32;
    try {
      const props = doc.getImageProperties(img);
      if (props?.width && props?.height) w = Math.min(160, (props.width / props.height) * h);
    } catch { signatureLine(null); return; }
    y += 12; // headroom so the image doesn't overlap the line above
    ensure(h + 18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(35, 35, 35);
    doc.text('Signature:', M, y);
    const lx = M + doc.getTextWidth('Signature:') + 10;
    try { doc.addImage(img, 'PNG', lx, y - h + 8, w, h); } catch {}
    doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.7);
    doc.line(lx, y + 3, lx + Math.max(120, w + 20), y + 3);
    y += 11 * 1.5 + 6;
  }

  /* ── signatures ── */
  ensure(170);
  rule();
  para([{ t: 'Brand Representative', b: true }], { size: 12, after: 8 });
  para([{ t: 'Brand:', b: true }, { t: brand }], { after: 6 });
  if (f.repName) para([{ t: 'Representative:', b: true }, { t: f.repName }], { after: 6 });
  signatureLine(f.signatureDataUrl);
  para([{ t: 'Date:', b: true }, { t: dateTxt }], { after: 14 });

  ensure(170);
  rule();
  const signedName = (f.creatorSignedName || '').trim();
  para([{ t: 'Creator', b: true }], { size: 12, after: 8 });
  para([{ t: 'Username:', b: true }, { t: username || '____________________' }], { after: 6 });
  para([{ t: 'Name:', b: true }, { t: signedName || f.creatorName || '______________________' }], { after: 6 });
  if (f.creatorSignatureDataUrl) {
    signatureLine(f.creatorSignatureDataUrl);
    para([{ t: 'Date:', b: true }, { t: fmtContractDate(f.creatorSignedAt ? String(f.creatorSignedAt).slice(0, 10) : null) }], { after: 4 });
    para([{ t: 'Signed electronically via the ApexGMV contract link.', }], { size: 9 });
  } else {
    para([{ t: 'Signature:', b: true }, { t: '____________________' }], { after: 6 });
    para([{ t: 'Date:', b: true }, { t: '______________________' }]);
  }

  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const who = signedName || f.creatorName || username || 'Creator';
  const suffix = f.creatorSignatureDataUrl ? 'Signed Contract' : 'Contract';
  return { doc, filename: `${safe(who)} x ${safe(brand)} - ${suffix}.pdf` };
}

export async function downloadCreatorContract(input: ContractInput) {
  const { doc, filename } = await buildCreatorContract(input);
  doc.save(filename);
}
