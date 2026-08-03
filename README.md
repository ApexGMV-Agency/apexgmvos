# ApexGMVOS

Internal web platform for **ApexGMV** — TikTok Shop brand management and client reporting.
Single-page React app backed by Supabase (Auth + Postgres + RLS + Edge Functions), deployed
on Vercel.

## Stack
- **React 18 + TypeScript + Vite 5**, React Router v6
- **react-bootstrap** + Bootstrap 5 + bootstrap-icons, custom CSS in `src/styles.css`
- **Supabase** (Auth + Postgres + RLS + Edge Functions)
- `@dnd-kit` (reporting canvas), `react-quill-new` + `dompurify` (rich text),
  `recharts` (charts), `jspdf` / `html2canvas` / `pdfjs-dist` (export)

`tsc -b` (via `npm run build`) is the only automated check — there is no test framework or
linter configured.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create the database schema
Open Supabase Dashboard → **SQL Editor** → paste the contents of
[`supabase/schema_baseline.sql`](supabase/schema_baseline.sql) → Run.

That single file is the whole schema (tables, RLS policies, functions, triggers, storage
buckets) and is idempotent, so it can be re-run safely. It creates, among other things:
- `profiles` (mirrors `auth.users`, carries `role` and permission flags) plus a trigger that
  auto-creates a row on sign-up with `role = 'pending'`
- `brands`, `clients` and the assignment tables (`apc_brands`, `team_lead_brands`,
  `ads_manager_brands`)
- Weekly/monthly reporting, GMV Max, samples, products, billing and budget tables
- Row Level Security on every table, driven mostly by the `public.is_bob()` helper

`supabase/legacy/` (untracked, local only) holds the pre-consolidation schema files and
migrations for reference — **never run them**.

### 3. Environment variables
Create `.env.local` (gitignored) in the repo root:
```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_VAPID_PUBLIC_KEY=<optional — enables web push>
```

### 4. Deploy the edge functions
The 18 functions in `supabase/functions/` handle service-role work the anon client can't do
(user provisioning, the public `/share/:token` endpoints, web push):
```bash
supabase functions deploy <name>
```
Set the service-role secret and, for `send-push`, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
`VAPID_SUBJECT`.

### 5. Run the dev server
```bash
npm run dev
```
Visit http://localhost:5173

### 6. Create the first owner account
1. Go to `/signup` and sign up — the row lands as `role = 'pending'`.
2. In the Supabase SQL Editor:
   ```sql
   update public.profiles
   set role = 'bob', is_superbob = true
   where lower(email) = '<your email>';
   ```
3. Sign out and back in — full navigation appears.

## Roles
| Role | Access |
| --- | --- |
| `bob` | Owner/admin — everything. The `is_superbob` flag additionally unlocks `/bobs` (managing other Bob accounts); it is displayed as **Super Boss**. |
| `team_lead` | Middle manager between Bob and APC. Manages their own APCs and the brands Bob assigns them — everything except billing. |
| `apc` | Apex Partner / account manager. Scoped to their assigned brands. |
| `ads_manager` | View-only APC whose one edit surface is GMV Max. |
| `pending` | No access — the default on sign-up. |

## Structure
```
src/
  auth/            AuthContext + ProtectedRoute
  layout/          Layout, Sidebar (role-based nav), Topbar
  theme/           ThemeContext (light/dark)
  lib/             Supabase client, report schemas, reporting canvas, helpers
  notifications/   Realtime notifications context + service-worker setup
  pages/           Routes; pages/brand/ (Brand Detail tabs), pages/templates/
  components/      canvas/, report/, resources/, share/ + shared inputs
supabase/
  schema_baseline.sql   Full DB schema + RLS
  functions/            18 Deno edge functions
public/
  sw.js                 Service worker (web push + PWA shell)
```

## Build
```bash
npm run build     # tsc -b && vite build
npm run preview   # serve the production build locally
```
