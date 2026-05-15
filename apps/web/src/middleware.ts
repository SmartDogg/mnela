import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/setup',
  '/_api',
  '/_next',
  '/favicon.ico',
  '/icon',
  '/icon.svg',
  '/logo.svg',
  '/robots.txt',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // The session cookie is signed and HttpOnly; presence is the gate.
  // Authoritative validation happens in /auth/me on each protected page.
  const session = req.cookies.get('mnela_session');
  if (!session?.value) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    if (pathname !== '/') {
      url.searchParams.set('next', `${pathname}${search}`);
    }
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
