import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/server-config";

export function proxy(request: NextRequest) {
  const settings = getServerConfig();
  if (request.nextUrl.pathname === "/api" || request.nextUrl.pathname.startsWith("/api/")) {
    const target = new URL(request.nextUrl.pathname + request.nextUrl.search, settings.backendUrl);
    // Keep the framework's streaming proxy, including request bodies, cookies,
    // Authorization and the browser Origin used by Google sign-in.
    return NextResponse.rewrite(target);
  }
  const response = NextResponse.next();
  if (settings.environment === "test") response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|art/|icon.svg).*)"] };
