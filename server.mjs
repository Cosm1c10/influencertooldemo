import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// Load .env
try {
  const env = fs.readFileSync(new URL('.env', import.meta.url), 'utf8');
  env.split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && !k.startsWith('#')) process.env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n');
  });
} catch {}


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, 'influenza-main');
const PORT = 5050;

// ── YouTube API ───────────────────────────────────────────────────
const YT_API_KEY = process.env.YT_API_KEY;
const YT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let ytCache = { ts: 0, metrics: {} };

function extractYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (!u.hostname.includes('youtu')) return null;
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/shorts/')[1].split('?')[0];
    if (u.pathname.startsWith('/embed/')) return u.pathname.split('/embed/')[1].split('?')[0];
    return u.searchParams.get('v') || null;
  } catch { return null; }
}

async function fetchYouTubeMetrics(videoIds) {
  const metrics = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${batch.join(',')}&key=${YT_API_KEY}`;
    const res  = await fetch(url);
    const json = await res.json();
    if (json.error) { console.error('YT API error:', json.error.message); break; }
    (json.items || []).forEach(item => {
      metrics[item.id] = {
        ytViews:    parseInt(item.statistics.viewCount    || 0),
        ytLikes:    parseInt(item.statistics.likeCount    || 0),
        ytComments: parseInt(item.statistics.commentCount || 0),
      };
    });
  }
  return metrics;
}

async function enrichWithYouTube(deliverables) {
  // Only fetch metrics for posted deliverables that have a YT link
  const posted = deliverables.filter(d => d.status === 'Posted' && d.ytLink);
  const ids = [...new Set(posted.map(d => extractYouTubeId(d.ytLink)).filter(Boolean))];
  if (!ids.length) return deliverables;

  // Return cached metrics if still fresh
  const now = Date.now();
  if (now - ytCache.ts < YT_CACHE_TTL) {
    console.log(`YT metrics: serving ${Object.keys(ytCache.metrics).length} from cache`);
    const metrics = ytCache.metrics;
    const seenIds = new Set();
    return deliverables.map(d => {
      const id = extractYouTubeId(d.ytLink);
      if (!id || !metrics[id]) return d;
      const enriched = { ...d, ...metrics[id] };
      if (seenIds.has(id)) enriched.ytDupe = true;
      else seenIds.add(id);
      return enriched;
    });
  }

  console.log(`Fetching YouTube metrics for ${ids.length} posted videos...`);
  const metrics = await fetchYouTubeMetrics(ids);
  ytCache = { ts: now, metrics };
  const seenIds = new Set();
  return deliverables.map(d => {
    const id = extractYouTubeId(d.ytLink);
    if (!id || !metrics[id]) return d;
    const enriched = { ...d, ...metrics[id] };
    if (seenIds.has(id)) enriched.ytDupe = true;
    else seenIds.add(id);
    return enriched;
  });
}

// ── Google Sheets API ─────────────────────────────────────────────
const SPREADSHEET_ID   = '11m1M_Y0SCmX5Lpp7wlVpgjIbDV8tiPdTweGZdiV_a-U';
const INFLUENCERS_TAB  = 'Mapping Sheet';
const DELIVERABLES_TAB = 'Overall tracking sheet';
const REQUESTS_TAB     = 'Requests';

const SA_EMAIL = 'influenza@influenza-492010.iam.gserviceaccount.com';
const SA_KEY   = process.env.SA_PRIVATE_KEY;

let _tokenCache = { token: null, exp: 0 };
async function getAccessToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.exp) return _tokenCache.token;
  const now     = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: SA_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const jwt = `${unsigned}.${sign.sign(SA_KEY, 'base64url')}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const { access_token, expires_in, error } = await r.json();
  if (error) throw new Error('Token error: ' + error);
  _tokenCache = { token: access_token, exp: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

async function sheetsGet(tab) {
  const token = await getAccessToken();
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(tab)}`;
  const r     = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json  = await r.json();
  if (json.error) throw new Error(json.error.message);
  return json.values || [];
}

async function sheetsAppend(tab, values) {
  const token = await getAccessToken();
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(tab + '!A:A')}:append?valueInputOption=USER_ENTERED`;
  const r     = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [values] }) });
  const json  = await r.json();
  if (json.error) throw new Error(json.error.message);
}

async function sheetsUpdate(tab, row, values) {
  const token = await getAccessToken();
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(tab + '!B' + row)}?valueInputOption=USER_ENTERED`;
  const r     = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [values] }) });
  const json  = await r.json();
  if (json.error) throw new Error(json.error.message);
}

// ── Parsers ───────────────────────────────────────────────────────
function parseInfluencers(rows) {
  return rows.slice(1).filter(r => r[1]).map((r, i) => ({
    _row: i + 2, name: r[1]||'', connectType: r[2]||'', platform: r[3]||'',
    category: r[4]||'', link: r[5]||'', followers: r[6]||0, state: r[7]||'',
    language: r[8]||'', email: r[9]||'', phone: r[10]||'',
    affiliateId: r[11]||'', discountCode: r[12]||'', orderTotal: r[13]||0, orders: r[14]||0,
  }));
}
function parseDeliverables(rows) {
  return rows.slice(1).filter(r => r[1]).map((r, i) => ({
    _row: i+2, slNo: r[0]||'', influencer: r[1]||'', accountLink: r[2]||'',
    followers: r[3]||0, category: r[4]||'', language: r[5]||'', asset: r[6]||'',
    status: r[7]||'', product: r[8]||'', skuIds: r[9]||'', productSent: r[10]||'',
    customOrderDate: r[11]||'', deliveryDate: r[12]||'', tat: r[13]||'',
    scheduledDate: r[14]||'', scheduledMonth: r[15]||'', dateOfPosting: r[16]||'',
    monthOfPosting: r[17]||'', manualViews: r[18]||0, ytLink: r[19]||'',
    colU: r[20]||'', colV: r[21]||'', igLink: r[22]||'', igViews: r[23]||0,
    influencerCost: r[24]||0, cogs: r[25]||0, costToKreo: r[26]||0,
    affiliateLink: r[27]||'', totalSale: r[28]||0, orders: r[29]||0,
    conversionRate: r[30]||0, oldVsRepeat: r[31]||'',
  }));
}
function parseRequests(rows) {
  return rows.slice(1).filter(r => r[0]||r[1]).map((r, i) => ({
    _row: i+2, date: r[0]||'', requestedBy: r[1]||'', creatorName: r[2]||'',
    platform: r[3]||'', type: r[4]||'', product: r[5]||'', skuId: r[6]||'',
    profileLink: r[7]||'', estimatedFollowers: r[8]||'', notes: r[9]||'', status: r[10]||'Pending',
  }));
}

// ── MIME types ────────────────────────────────────────────────────
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.json':'application/json', '.png':'image/png', '.ico':'image/x-icon' };

// ── Request body parser ───────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ── Server ────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  console.log(`${req.method} ${pathname}`);

  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── /api/data ─────────────────────────────────────────────────
  if (pathname === '/api/data') {
    res.setHeader('Content-Type', 'application/json');
    try {
      if (req.method === 'GET') {
        const action = url.searchParams.get('action');
        if (action === 'getAll') {
          const [infRows, delRows, reqRows] = await Promise.all([
            sheetsGet(INFLUENCERS_TAB), sheetsGet(DELIVERABLES_TAB), sheetsGet(REQUESTS_TAB),
          ]);
          const deliverablesParsed = await enrichWithYouTube(parseDeliverables(delRows));
          return res.end(JSON.stringify({ influencers: parseInfluencers(infRows), deliverables: deliverablesParsed, requests: parseRequests(reqRows) }));
        }
        if (action === 'getInfluencers') {
          const rows = await sheetsGet(INFLUENCERS_TAB);
          return res.end(JSON.stringify(parseInfluencers(rows)));
        }
        return res.writeHead(400).end(JSON.stringify({ error: 'Unknown action' }));
      }

      if (req.method === 'POST') {
        const { action, data } = await readBody(req);
        if (action === 'addInfluencer') {
          const rows = await sheetsGet(INFLUENCERS_TAB);
          await sheetsAppend(INFLUENCERS_TAB, [rows.length, data.name||'', data.connectType||'', data.platform||'', data.category||'', data.link||'', data.followers||'', data.state||'', data.language||'', data.email||'', data.phone||'', data.affiliateId||'', data.discountCode||'', '', '']);
          return res.end(JSON.stringify({ success: true }));
        }
        if (action === 'updateInfluencer') {
          await sheetsUpdate(INFLUENCERS_TAB, data._row, [data.name||'', data.connectType||'', data.platform||'', data.category||'', data.link||'', data.followers||'', data.state||'', data.language||'', data.email||'', data.phone||'', data.affiliateId||'', data.discountCode||'', data.orderTotal||'', data.orders||'']);
          return res.end(JSON.stringify({ success: true }));
        }
        if (action === 'addDeliverable') {
          const rows = await sheetsGet(DELIVERABLES_TAB);
          await sheetsAppend(DELIVERABLES_TAB, [rows.length, data.influencer||'', data.accountLink||'', data.followers||'', data.category||'', data.language||'', data.asset||'', data.status||'', data.product||'', data.skuIds||'', data.productSent||'', data.customOrderDate||'', data.deliveryDate||'', data.tat||'', data.scheduledDate||'', data.scheduledMonth||'', data.dateOfPosting||'', data.monthOfPosting||'', data.manualViews||'', data.ytLink||'', '', '', data.igLink||'', data.igViews||'', data.influencerCost||'', data.cogs||'', data.costToKreo||'', data.affiliateLink||'', data.totalSale||'', data.orders||'', data.conversionRate||'', data.oldVsRepeat||'']);
          return res.end(JSON.stringify({ success: true }));
        }
        if (action === 'updateDeliverable') {
          await sheetsUpdate(DELIVERABLES_TAB, data._row, [data.influencer||'', data.accountLink||'', data.followers||'', data.category||'', data.language||'', data.asset||'', data.status||'', data.product||'', data.skuIds||'', data.productSent||'', data.customOrderDate||'', data.deliveryDate||'', data.tat||'', data.scheduledDate||'', data.scheduledMonth||'', data.dateOfPosting||'', data.monthOfPosting||'', data.manualViews||'', data.ytLink||'', '', '', data.igLink||'', data.igViews||'', data.influencerCost||'', data.cogs||'', data.costToKreo||'', data.affiliateLink||'', data.totalSale||'', data.orders||'', data.conversionRate||'', data.oldVsRepeat||'']);
          return res.end(JSON.stringify({ success: true }));
        }
        if (action === 'addRequest') {
          await sheetsAppend(REQUESTS_TAB, [new Date().toISOString(), data.requestedBy||'', data.creatorName||'', data.platform||'', data.type||'', data.product||'', data.skuId||'', data.profileLink||'', data.estimatedFollowers||'', data.notes||'', data.status||'Pending']);
          return res.end(JSON.stringify({ success: true }));
        }
        return res.writeHead(400).end(JSON.stringify({ error: 'Unknown action' }));
      }
    } catch (err) {
      console.error('API error:', err.message);
      res.writeHead(500);
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // ── /api/instagram-sync ───────────────────────────────────────
  if (pathname === '/api/instagram-sync' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    try {
      const product = url.searchParams.get('product');
      const limit   = parseInt(url.searchParams.get('limit') || '3');
      const month   = url.searchParams.get('month') || '';
      if (!product) return res.end(JSON.stringify({ error: 'product param required' }));

      // Fetch deliverables from sheet
      const delRows = await sheetsGet(DELIVERABLES_TAB);
      const deliverables = parseDeliverables(delRows);

      // Find recent posted reels for this product (optionally scoped by month)
      const candidates = deliverables
        .filter(d =>
          d.product === product &&
          d.igLink  &&
          (!month || d.scheduledMonth === month || d.monthOfPosting === month)
        )
        .sort((a, b) => new Date(b.dateOfPosting || 0) - new Date(a.dateOfPosting || 0))
        .slice(0, limit);

      if (!candidates.length) {
        return res.end(JSON.stringify({ results: [], message: 'No Instagram reels found for this product' }));
      }

      const reelUrls = [...new Set(candidates.map(d => d.igLink))];
      console.log(`Scraping ${reelUrls.length} reels for "${product}":`, reelUrls);

      // Call Apify instagram-reel-scraper
      const apifyRes = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-reel-scraper/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=120&memory=256`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ username: reelUrls, resultsLimit: limit }),
        }
      );
      const results = await apifyRes.json();
      if (!Array.isArray(results)) throw new Error(results.error?.message || 'Apify returned unexpected response');

      console.log(`Apify returned ${results.length} results`);
      return res.end(JSON.stringify({ results }));

    } catch (err) {
      console.error('IG sync error:', err.message);
      return res.writeHead(500).end(JSON.stringify({ error: err.message }));
    }
  }

  // ── Static files ──────────────────────────────────────────────
  let filePath = path.join(STATIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath)) filePath = path.join(STATIC_DIR, 'index.html'); // SPA fallback

  const ext = path.extname(filePath);
  res.setHeader('Content-Type', MIME[ext] || 'text/plain');
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  Kreo Hub running at http://localhost:${PORT}\n`);
});
