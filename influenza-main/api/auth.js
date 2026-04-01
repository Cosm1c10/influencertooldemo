// ================================================================
// KREO HUB — Google OAuth Token Verification
// ================================================================
// Replace GOOGLE_CLIENT_ID with your actual OAuth Client ID.
// It's safe to commit — it's a public identifier by design.
// ================================================================

const GOOGLE_CLIENT_ID = '872643242209-a2caps3picuauarkj13iig7c84f7706r.apps.googleusercontent.com';

const ALLOWED_EMAILS = [
  'ishan@kreo-tech.com',
  'raj@kreo-tech.com',
  'saloni@kreo-tech.com',
];

// Session length: 30 days
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { idToken } = body || {};

    if (!idToken) {
      return res.status(400).json({ error: 'Missing idToken' });
    }

    // Verify the Google ID token using Google's tokeninfo endpoint.
    // This is the simple, no-library approach — Google does the heavy lifting.
    const googleRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );

    if (!googleRes.ok) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    const tokenData = await googleRes.json();

    // Verify the token was issued for our app (prevents token reuse from other apps)
    if (tokenData.aud !== GOOGLE_CLIENT_ID) {
      return res.status(401).json({ error: 'Token audience mismatch' });
    }

    const email = (tokenData.email || '').toLowerCase();

    // Check against email whitelist
    if (!ALLOWED_EMAILS.includes(email)) {
      return res.status(403).json({
        error: 'Access denied',
        message: `${email} is not on the access list. Ask a team admin to add you.`
      });
    }

    // Build session payload — base64 encoded JSON (not secret, but HttpOnly so JS can't touch it)
    const session = btoa(JSON.stringify({
      email,
      name: tokenData.name || '',
      exp: Date.now() + SESSION_MS
    }));

    // Set 30-day HttpOnly session cookie
    res.setHeader('Set-Cookie',
      `kreo_session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`
    );

    return res.status(200).json({ ok: true, email });

  } catch (e) {
    console.error('Auth error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
