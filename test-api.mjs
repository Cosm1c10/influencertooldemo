import crypto from 'crypto';

const SPREADSHEET_ID   = '11m1M_Y0SCmX5Lpp7wlVpgjIbDV8tiPdTweGZdiV_a-U';
const INFLUENCERS_TAB  = 'Mapping Sheet';
const DELIVERABLES_TAB = 'Overall tracking sheet';

const SA_EMAIL = 'influenza@influenza-492010.iam.gserviceaccount.com';
const SA_KEY   = process.env.SA_PRIVATE_KEY;

async function getAccessToken() {
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
  const jwt = `${unsigned}.${sign.sign(SA_KEY, 'base64url')}`;

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error('Token error: ' + json.error + ' — ' + json.error_description);
  console.log('✓ Access token obtained');
  return json.access_token;
}

async function sheetsGet(tab) {
  const token = await getAccessToken();
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(tab)}`;
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json  = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.values || [];
}

// --- Run tests ---
console.log('Testing Google Sheets connection...\n');

try {
  const infRows = await sheetsGet(INFLUENCERS_TAB);
  console.log(`✓ Mapping Sheet — ${infRows.length - 1} rows (excl. header)`);
  console.log('  Headers:', infRows[0]?.join(' | '));
  console.log('  First row:', infRows[1]?.slice(0, 5).join(' | '), '...\n');

  const delRows = await sheetsGet(DELIVERABLES_TAB);
  console.log(`✓ Overall tracking sheet — ${delRows.length - 1} rows (excl. header)`);
  console.log('  Headers:', delRows[0]?.slice(0, 8).join(' | '), '...\n');

  console.log('All tests passed.');
} catch (e) {
  console.error('✗ Error:', e.message);
}
