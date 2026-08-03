# ApexGMVOS

Internal platform for ApexGMV — brand management, reporting, and more.

## Stack
- **React 18 + TypeScript + Vite**
- **react-bootstrap** + Bootstrap 5
- **Supabase** (Auth + Postgres + RLS)

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create the database schema
Open Supabase Dashboard → **SQL Editor** → paste the contents of [`supabase/schema.sql`](supabase/schema.sql) → Run.

This creates:
- `profiles` table (mirrors `auth.users` with a `role` column)
- `brands` table (name, client, last_month_gmv, tier)
- A trigger that auto-creates a profile row on sign-up
- Row Level Security policies (only Bob can write brands)

### 3. Environment variables
`.env.local` is already populated with the project URL and anon key.

### 4. Run dev server
```bash
npm run dev
```
Visit http://localhost:5173

### 5. Create Bob's account
1. Go to `/signup`, sign up with `Bob@apexgmvos.com`
2. In Supabase SQL Editor:
   ```sql
   update public.profiles set role = 'bob' where email = 'Bob@apexgmvos.com';
   ```
3. Sign out and back in — the **Brands** menu item will appear.

## Structure
```
src/
  auth/            AuthContext + ProtectedRoute
  layout/          Sidebar, Topbar, Layout
  lib/             Supabase client
  pages/           Login, SignUp, Dashboard, Brands, Reporting
supabase/
  schema.sql       DB schema + RLS
```
