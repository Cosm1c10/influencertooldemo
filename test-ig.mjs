// Quick test: fetch Swarm X IG reels from sheet → call Apify → print results
import crypto from 'crypto';
import { readFileSync } from 'fs';

// Load .env
const env = readFileSync('.env', 'utf8');
env.split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && !k.startsWith('#')) process.env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n');
});

const SPREADSHEET_ID   = '11m1M_Y0SCmX5Lpp7wlVpgjIbDV8tiPdTweGZdiV_a-U';
const DELIVERABLES_TAB = 'Overall tracking sheet';
const SA_EMAIL = 'influenza@influenza-492010.iam.gserviceaccount.com';
const SA_KEY   = process.env.SA_PRIVATE_KEY;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const PRODUCT = 'Swarm X';

function extractIGUsername(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    // Profile URLs: instagram.com/username or instagram.com/username/
    if (parts.length >= 1 && parts[0] !== 'reel' && parts[0] !== 'p') return parts[0];
  } catch {}
  return null;
}

async function getAccessToken() {
  const now     = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: SA_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })).toString('base64url');
  const unsigned  = `${header}.${payload}`;
  const sign      = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const jwt = `${unsigned}.${sign.sign(SA_KEY, 'base64url')}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const { access_token, error } = await res.json();
  if (error) throw new Error('Token error: ' + error);
  return access_token;
}

const token = await getAccessToken();
console.log('✓ Got access token\n');

const sheetRes = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(DELIVERABLES_TAB)}`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const { values, error } = await sheetRes.json();
if (error) throw new Error(error.message);

const rows = (values || []).slice(1).filter(r => r[1]);
const candidates = rows
  .map(r => ({
    influencer:  r[1]  || '',
    accountLink: r[2]  || '',
    status:      r[7]  || '',
    product:     r[8]  || '',
    dateOfPosting: r[16] || '',
    monthOfPosting: r[17] || '',
    igLink:      r[22] || '',
  }))
  .filter(d => d.product === PRODUCT && d.status === 'Posted' && d.igLink && d.igLink.includes('/reel/'));

// Deduplicate by reel URL
const seen = new Set();
const unique = candidates.filter(d => {
  if (seen.has(d.igLink)) return false;
  seen.add(d.igLink);
  return true;
});

console.log(`Found ${unique.length} unique Posted reel(s) for "${PRODUCT}":`);
unique.forEach(d => {
  const username = extractIGUsername(d.accountLink);
  console.log(`  • ${d.influencer} (${username || 'no username'}) — ${d.igLink}`);
});

if (!unique.length) {
  console.log('\n⚠ No reels found. Check product name or status in sheet.');
  process.exit(0);
}

const top3 = unique.slice(0, 3);
const reelUrls = top3.map(d => d.igLink);

console.log(`\nSending ${reelUrls.length} URL(s) to Apify (apify~instagram-reel-scraper)…\n`);

// Try passing reel URLs directly as username (some actors accept post URLs here)
const body = { username: reelUrls, resultsLimit: 3 };
console.log('Request body:', JSON.stringify(body, null, 2));

const apifyRes = await fetch(
  `https://api.apify.com/v2/acts/apify~instagram-reel-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120&memory=256`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
);

const results = await apifyRes.json();
console.log('\n── Apify raw response ──────────────────────');
console.log(JSON.stringify(results, null, 2));

if (Array.isArray(results) && results.length) {
  console.log('\n── Parsed metrics ──────────────────────────');
  results.forEach(r => {
    console.log(`  URL:      ${r.url || r.inputUrl}`);
    console.log(`  Views:    ${r.videoPlayCount ?? r.videoViewCount ?? 'n/a'}`);
    console.log(`  Likes:    ${r.likesCount ?? 'n/a'}`);
    console.log(`  Comments: ${r.commentsCount ?? 'n/a'}`);
    console.log('');
  });
}
