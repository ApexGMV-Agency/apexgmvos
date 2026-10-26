// Turn raw Postgres / PostgREST errors into something a person can act on.
//
// The common case is a feature whose migration hasn't been run on this
// Supabase project yet: Postgres answers "column … does not exist" (42703) or
// "relation … does not exist" (42P01), and PostgREST answers PGRST202 / PGRST205
// ("could not find the function / table in the schema cache"). Those all mean
// the same thing to the user — the database needs updating — so say that.

export interface DbErrorLike { message?: string; code?: string; details?: string | null; hint?: string | null; }

const MISSING_SCHEMA = new Set(['42703', '42P01', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);

export function isMissingSchema(e: DbErrorLike | null | undefined): boolean {
  if (!e) return false;
  if (e.code && MISSING_SCHEMA.has(e.code)) return true;
  return /does not exist|schema cache/i.test(e.message ?? '');
}

/** A readable message. `setup` names the migration that creates the missing pieces. */
export function friendlyDbError(e: DbErrorLike | null | undefined, setup?: string): string {
  if (!e) return '';
  if (isMissingSchema(e)) {
    return setup
      ? `The database isn't set up for this yet. Run ${setup} in the Supabase SQL editor, then refresh.`
      : 'The database isn\'t set up for this yet — a migration still needs to be run. Refresh after it has been applied.';
  }
  if (e.code === '42501' || /row-level security|permission denied/i.test(e.message ?? '')) {
    return 'You don\'t have permission to do that.';
  }
  return e.message ?? 'Something went wrong.';
}

export const PAID_COLLAB_MIGRATION = 'supabase/migrations/20261026000000_paid_collab_workspace.sql';
