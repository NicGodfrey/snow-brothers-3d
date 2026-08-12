export const SESSION_COOKIE = "portal_session";

export interface CookieOptions {
  readonly maxAgeSeconds?: number;
  readonly secure?: boolean;
  readonly path?: string;
}

/** Session cookie: HttpOnly + SameSite=Lax so form posts still carry it. */
export function sessionCookie(token: string, options: CookieOptions = {}): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    `Path=${options.path ?? "/"}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const [scheme, value] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
}
