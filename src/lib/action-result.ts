/**
 * The value a form action resolves to when it could not do what was asked.
 *
 * In production, Next.js replaces the message of any error *thrown* by a server action
 * with a generic one before it reaches the browser, so every validation and ownership
 * message the actions produce used to render as "Something went wrong". Actions therefore
 * return this shape instead of throwing (see `formAction` in the actions helpers), and
 * clients check for it. Client-safe: no server-only imports.
 */
export type ActionFailure = { ok: false; error: string };

export function isActionFailure(value: unknown): value is ActionFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { error?: unknown }).error === "string"
  );
}
