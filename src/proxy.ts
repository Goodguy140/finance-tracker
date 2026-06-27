import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"];

function getNextAuthSecret() {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("Missing required env var NEXTAUTH_SECRET in production.");
  }
  return secret;
}

/** Public site host/proto from NEXTAUTH_URL (non-loopback only). */
function parsedNextAuthPublicOrigin(): { host: string; proto: "http" | "https" } | null {
  const raw = process.env.NEXTAUTH_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return null;
    const proto: "http" | "https" = u.protocol === "http:" ? "http" : "https";
    return { host: u.host, proto };
  } catch {
    return null;
  }
}

function isLoopbackHost(host: string): boolean {
  const first = host.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!first) return false;
  if (first === "localhost" || first.startsWith("localhost:")) return true;
  if (first.startsWith("127.0.0.1")) return true;
  if (first.startsWith("[::1]")) return true;
  return false;
}

/**
 * Tunnels / reverse proxies often hit Next with Host: localhost while the browser
 * uses a public HTTPS URL. NextAuth (with AUTH_TRUST_HOST) then builds OAuth
 * redirect_uri for https://localhost — which breaks Google. When NEXTAUTH_URL
 * is a real public host, inject forwarded headers so Route Handlers see the
 * same host the user does.
 */
function authTrustHostEnabled(): boolean {
  const v = process.env.AUTH_TRUST_HOST?.trim().toLowerCase();
  return v === "true" || v === "1";
}

function syntheticForwardedHeaders(headers: Headers): Headers | null {
  if (!authTrustHostEnabled()) return null;
  const pub = parsedNextAuthPublicOrigin();
  if (!pub) return null;

  const host = headers.get("host") ?? "";
  const xfHostRaw = headers.get("x-forwarded-host");
  const effective = (xfHostRaw?.split(",")[0]?.trim() || host).toLowerCase();
  if (effective === pub.host.toLowerCase()) return null;
  if (!isLoopbackHost(effective)) return null;

  const h = new Headers(headers);
  h.set("x-forwarded-host", pub.host);
  h.set("x-forwarded-proto", pub.proto);
  return h;
}

/** NextAuth reads x-forwarded-proto when AUTH_TRUST_HOST is set; dev servers often omit it. */
function withDevForwardedProto(req: NextRequest, headers: Headers): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  if (headers.get("x-forwarded-proto")) return false;
  headers.set("x-forwarded-proto", req.nextUrl.protocol === "https:" ? "https" : "http");
  return true;
}

/**
 * Do not rewrite forwarded headers for read-only auth JSON endpoints.
 * Rewriting Host/proto for `/api/auth/csrf` while the TCP `Host` is still
 * `localhost` has been observed to break the client `fetch("/api/auth/csrf")`
 * flow behind NPM (button stuck on "Preparing…"); OAuth POST/callback still
 * need the synthetic headers when the upstream sees loopback.
 */
function skipSyntheticForwardedForPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/auth/session") || pathname === "/api/auth/providers"
  );
}

export const __authProxyInternals = {
  skipSyntheticForwardedForPath,
  isLoopbackHost,
  parsedNextAuthPublicOrigin,
};

export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const baseHeaders = new Headers(req.headers);
  const addedDevProto = withDevForwardedProto(req, baseHeaders);
  let forwardHeaders: Headers | null = null;
  if (!skipSyntheticForwardedForPath(pathname)) {
    forwardHeaders = syntheticForwardedHeaders(baseHeaders) ?? (addedDevProto ? baseHeaders : null);
  } else if (addedDevProto) {
    forwardHeaders = baseHeaders;
  }
  const nextInit = forwardHeaders ? { request: { headers: forwardHeaders } } : {};

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next(nextInit);
  }

  const token = await getToken({ req, secret: getNextAuthSecret() });
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!token && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (token && isPublic) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next(nextInit);
}

export const config = {
  // `api/v1/*` is token-authenticated (Authorization: Bearer), not cookie-based,
  // so it must bypass the session gate that redirects everything else to /login.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/v1).*)"],
};
