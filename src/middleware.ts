import { NextRequest, NextResponse } from "next/server";

// Guard /dashboard/* — redirect to /login when no session cookie. (Full verify happens server-side
// in the route; this is the cheap edge gate.) Also sets baseline security headers.
export function middleware(req: NextRequest) {
  const isDash = req.nextUrl.pathname.startsWith("/dashboard");
  const hasCookie = req.cookies.has("dw_session");
  if (isDash && !hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export const config = { matcher: ["/dashboard/:path*"] };
