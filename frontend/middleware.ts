import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE = "surebet_session";

const publicPaths = new Set(["/login"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(AUTH_COOKIE)?.value);

  if (pathname === "/") {
    const destination = hasSession ? "/dashboard" : "/login";
    return NextResponse.redirect(buildPublicURL(request, destination));
  }

  if (publicPaths.has(pathname) && hasSession) {
    return NextResponse.redirect(buildPublicURL(request, "/dashboard"));
  }

  if (!publicPaths.has(pathname) && !hasSession) {
    return NextResponse.redirect(buildPublicURL(request, "/login"));
  }

  return NextResponse.next();
}

function buildPublicURL(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  const host =
    firstHeaderValue(request.headers.get("x-forwarded-host")) ||
    firstHeaderValue(request.headers.get("host"));
  const protocol = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const port = firstHeaderValue(request.headers.get("x-forwarded-port"));

  url.pathname = pathname;
  url.search = "";

  if (host) {
    url.host = host;
  }

  if (protocol) {
    url.protocol = `${protocol}:`;
  }

  if (port && host && !host.includes(":")) {
    url.port = port;
  }

  return url;
}

function firstHeaderValue(value: string | null) {
  if (!value) {
    return "";
  }

  const [first] = value.split(",", 1);
  return first.trim();
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/dashboard/:path*",
    "/matches/:path*",
    "/opportunities/:path*",
    "/admin/:path*",
    "/collector-config/:path*"
  ]
};
