// Unwrap the real error message from a failed supabase.functions.invoke().
//
// When an edge function replies with a non-2xx status, supabase-js returns a
// FunctionsHttpError whose .message is always the generic "Edge Function
// returned a non-2xx status code" — the function's actual JSON body (e.g.
// {"error":"A user with this email already exists."}) sits unread in
// error.context. This reads it so the UI can show the real reason.
//
// Usage:  if (error) throw await fnError(error);
export async function fnError(error: unknown): Promise<Error> {
  try {
    const body = await (error as any)?.context?.json?.();
    if (body?.error) return new Error(String(body.error));
  } catch {
    // body missing or not JSON — fall through to the original error
  }
  return error instanceof Error ? error : new Error(String(error));
}
