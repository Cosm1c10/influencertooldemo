// ================================================================
// KREO HUB — Auth Middleware (Vercel Edge)
// ================================================================
// Add your team's Google emails to this list.
// This is the only place you need to update to add/remove access.
// ================================================================

const ALLOWED_EMAILS = [
  'ishan@kreo-tech.com',
  'raj@kreo-tech.com',
  'saloni@kreo-tech.com',
];

export default function middleware(request) {
  const { pathname } = new URL(request.url);

  // Always allow: login page and auth API routes
  if (
    pathname === '/login.html' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/logout') ||
    pathname.startsWith('/_vercel') ||
    pathname.startsWith('/_next')
  ) {
    return;
  }

  // Parse the session cookie
  const cookie = request.headers.get('cookie') || '';
  const sessionCookie = cookie
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('kreo_session='));

  if (sessionCookie) {
    try {
      const raw = sessionCookie.split('=').slice(1).join('=');
      const session = JSON.parse(atob(raw));

      // Check expiry and email whitelist
      if (
        session.exp > Date.now() &&
        ALLOWED_EMAILS.includes(session.email.toLowerCase())
      ) {
        return; // Valid session — let through
      }
    } catch (e) {
      // Malformed cookie — fall through to redirect
    }
  }

  // No valid session — redirect to login
  const loginUrl = new URL('/login.html', request.url);
  loginUrl.searchParams.set('next', pathname);
  return Response.redirect(loginUrl, 302);
}

export const config = {
  matcher: ['/((?!_vercel|favicon\\.ico).*)'],
};
