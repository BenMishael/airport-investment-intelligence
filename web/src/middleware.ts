import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") || "";
  if (host === "127.0.0.1:3000") {
    const path = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    return new NextResponse(null, {
      status: 308,
      headers: { Location: `http://localhost:3000${path}` },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|assets/).*)"],
};
