// Parser for the "Top Videos" section of a weekly report.
//
// Users copy rows straight from the TikTok Shop "video performance" list and
// paste them here; we extract the fields the report needs and build the video
// URL from the creator handle + video id:
//   https://www.tiktok.com/@<creatorUsername>/video/<videoId>
//
// A pasted block looks like (one per video):
//   #ad @Richwife #truckerhat ...        <- caption
//   ID:
//   7646930048980700446                  <- VIDEO id (first "ID:")
//   06/02/2026 14:34                     <- date
//   shawna.likes2shop                    <- creator username (@handle)
//   Shawna.🖤                            <- creator display name
//   14.4K Followers
//   Stars and Stripes Club               <- product name
//   ID:
//   1731298002314563836                  <- PRODUCT id (second "ID:")
//   Womenswear & Underwear               <- category
//   $62.2                                <- creator video-attributed GMV
//   2                                    <- video-attributed items sold
//   $0.00  0  2  $31.1  $31.1            <- refunds / other columns (ignored)
//   video thumbnail                      <- separates rows

export interface ParsedTopVideo {
  video_link: string;
  product_promoted: string;
  gmv: number | null;
  items_sold: number | null;
}

const toNum = (s: string): number | null => {
  const n = Number(String(s).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const isMoney = (l: string) => /^\$\s?[\d,]+(\.\d+)?$/.test(l);
const isInt = (l: string) => /^\d+$/.test(l);

function parseBlock(block: string): ParsedTopVideo | null {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 3) return null;

  // IDs — "ID:" then digits (digits may be on the next line). \s spans the
  // newline. First match = video id, second = product id.
  const ids: string[] = [];
  const idRe = /ID:\s*(\d{6,25})/gi;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(block)) !== null) ids.push(m[1]);
  const videoId = ids[0] ?? '';

  // Creator username — first line after the date; else 2 lines above "Followers".
  const dateIdx = lines.findIndex(l => /^\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(l));
  let username = '';
  if (dateIdx >= 0 && dateIdx + 1 < lines.length) username = lines[dateIdx + 1];
  if (!username || /followers/i.test(username)) {
    const fi = lines.findIndex(l => /followers/i.test(l));
    if (fi >= 2) username = lines[fi - 2];
  }
  username = username.replace(/^@+/, '').replace(/\s+/g, '');

  // Product name — the line before the SECOND "ID:" line.
  const idLineIdxs = lines.map((l, i) => (/^ID:/i.test(l) ? i : -1)).filter(i => i >= 0);
  let product = '';
  if (idLineIdxs.length >= 2 && idLineIdxs[1] >= 1) product = lines[idLineIdxs[1] - 1];

  // GMV + items — after the product "ID:", the first "$" value is the creator
  // video-attributed GMV; the next standalone integer is the items sold.
  let gmv: number | null = null, items: number | null = null;
  const scanFrom = idLineIdxs.length >= 2 ? idLineIdxs[1] + 1 : 0;
  for (let i = scanFrom; i < lines.length; i++) {
    if (isMoney(lines[i])) {
      gmv = toNum(lines[i]);
      for (let j = i + 1; j < lines.length; j++) {
        if (isInt(lines[j])) { items = toNum(lines[j]); break; }
      }
      break;
    }
  }

  const video_link = (username && videoId) ? `https://www.tiktok.com/@${username}/video/${videoId}` : '';
  if (!video_link && !product && gmv == null) return null;
  return { video_link, product_promoted: product, gmv, items_sold: items };
}

/** Parse pasted TikTok-Shop video rows into Top-Videos table rows. */
export function parseTopVideos(raw: string): ParsedTopVideo[] {
  const text = String(raw || '').replace(/\r/g, '');
  if (!text.trim()) return [];
  const lines = text.split('\n');

  // Segment into per-video blocks by pairing "ID:" lines (video id + product id
  // per block). Each block starts a couple lines above its video-id "ID:" so the
  // caption/creator lines are included. This survives whether or not the copy
  // includes the "video thumbnail" separators.
  const idLineIdxs: number[] = [];
  for (let i = 0; i < lines.length; i++) if (/^\s*ID:/i.test(lines[i])) idLineIdxs.push(i);

  let blocks: string[];
  if (idLineIdxs.length >= 2) {
    const starts: number[] = [];
    for (let k = 0; k < idLineIdxs.length; k += 2) starts.push(Math.max(0, idLineIdxs[k] - 2));
    blocks = starts.map((s, k) => lines.slice(s, k + 1 < starts.length ? starts[k + 1] : lines.length).join('\n'));
  } else {
    blocks = text.split(/video thumbnail/i);
    if (blocks.length <= 1) blocks = [text];
  }

  const out: ParsedTopVideo[] = [];
  for (const b of blocks) {
    const v = parseBlock(b);
    if (v) out.push(v);
  }
  return out;
}
