-- =========================================================
-- Content Briefs — renameable versions.
--
-- content_brief_versions.note doubles as the version's NAME (Claude's save
-- note is the default). Editors (Bob + the brand's Team Lead) may now rename a
-- version, and ONLY that: the table-level UPDATE grant is replaced with a
-- column grant on `note`, so the HTML of a saved version stays immutable.
--
-- Idempotent — also folded into supabase/schema_baseline.sql (§11d; the column
-- grant is repeated after §12's blanket grants).
-- =========================================================

drop policy if exists "brief versions update" on public.content_brief_versions;
create policy "brief versions update" on public.content_brief_versions
  for update using (exists (
    select 1 from public.content_briefs b
     where b.id = brief_id and public.sop_editor(b.brand_id)))
  with check (exists (
    select 1 from public.content_briefs b
     where b.id = brief_id and public.sop_editor(b.brand_id)));

revoke update on public.content_brief_versions from authenticated, anon;
grant  update (note) on public.content_brief_versions to authenticated;
