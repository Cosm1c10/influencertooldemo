// ================================================================
// KREO HUB — Instagram Reel Metrics via Apify
// GET /api/instagram-sync?product=ProductName&limit=3&month=Month
// ================================================================

import crypto from 'crypto';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ID    = 'apify~instagram-reel-scraper';

const SPREADSHEET_ID   = '11m1M_Y0SCmX5Lpp7wlVpgjIbDV8tiPdTweGZdiV_a-U';
const DELIVERABLES_TAB = 'Overall tracking sheet';
const SA_EMAIL = 'influenza@influenza-492010.iam.gserviceaccount.com';
const SA_KEY   = process.env.SA_PRIVATE_KEY;

let _tokenCache = { token: null, exp: 0 };

async function getAccessToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.exp) return _tokenCache.token;
  const now     = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss:   SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })).toString('base64url');
  const unsigned  = `${header}.${payload}`;
  const sign      = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(SA_KEY, 'base64url');
  const jwt       = `${unsigned}.${signature}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const { access_token, expires_in, error } = await res.json();
  if (error) throw new Error('Token error: ' + error);
  _tokenCache = { token: access_token, exp: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

async function fetchDeliverables() {
  const token = await getAccessToken();
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(DELIVERABLES_TAB)}`;
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json  = await res.json();
  if (json.error) throw new Error(json.error.message);
  return (json.values || []).slice(1).filter(r => r[1]).map((r, i) => ({
    _row:           i + 2,
    influencer:     r[1]  || '',
    status:         r[7]  || '',
    product:        r[8]  || '',
    scheduledMonth: r[15] || '',
    dateOfPosting:  r[16] || '',
    monthOfPosting: r[17] || '',
    igLink:         r[22] || '',
  }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');

  const { product, limit = '3', month } = req.query;
  if (!product) return res.status(400).json({ error: 'product param required' });

  try {
    const deliverables = await fetchDeliverables();

    const candidates = deliverables
      .filter(d =>
        d.product === product &&
        d.status  === 'Posted' &&
        d.igLink  && d.igLink.includes('/reel/') &&
        (!month || d.scheduledMonth === month || d.monthOfPosting === month)
      )
      .sort((a, b) => new Date(b.dateOfPosting || 0) - new Date(a.dateOfPosting || 0))
      .slice(0, parseInt(limit));

    if (!candidates.length) {
      return res.json({ results: [], message: 'No Instagram reels found for this product' });
    }

    const reelUrls = [...new Set(candidates.map(d => d.igLink))];
    console.log(`Scraping ${reelUrls.length} reels for "${product}":`, reelUrls);

    const apifyRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120&memory=256`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: reelUrls, resultsLimit: parseInt(limit) }),
      }
    );

    const results = await apifyRes.json();
    if (!Array.isArray(results)) throw new Error(results.error?.message || 'Unexpected Apify response');

    return res.json({ results });

  } catch (err) {
    console.error('IG sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
