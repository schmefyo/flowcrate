/** The first authenticated destination until a dedicated Home dashboard exists. */
export const DEFAULT_AUTHENTICATED_DESTINATION = "/discover";

/**
 * Keeps an explicitly supplied internal destination intact; otherwise sends a
 * completed authentication flow to the app's default entry point.
 */
export function authenticatedDestination(destination?: string | null): string {
  if (destination?.startsWith("/") && !destination.startsWith("//")) return destination;
  return DEFAULT_AUTHENTICATED_DESTINATION;
}

/** Absolute callback URL required by Supabase email and OAuth flows. */
export function authCallbackUrl(origin: string, destination?: string | null): string {
  return new URL(authenticatedDestination(destination), origin).toString();
}
