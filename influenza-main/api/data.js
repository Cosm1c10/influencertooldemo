// ================================================================
// KREO HUB — Google Sheets Data API
// Calls Google Sheets API directly using a service account JWT.
// All reads/writes go through here — no Apps Script needed.
// ================================================================

import crypto from 'crypto';

// ── YouTube API ───────────────────────────────────────────────────
const YT_API_KEY = process.env.YT_API_KEY;
const YT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let ytCache = { ts: 0, metrics: {} };

function extractYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (!u.hostname.includes('youtu')) return null; // reject non-YT URLs (e.g. instagram links in YT column)
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
    const url  = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${batch.join(',')}&key=${YT_API_KEY}`;
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
  const posted = deliverables.filter(d => d.status === 'Posted' && d.ytLink);
  const ids = [...new Set(posted.map(d => extractYouTubeId(d.ytLink)).filter(Boolean))];
  if (!ids.length) return deliverables;

  const now = Date.now();
  if (now - ytCache.ts >= YT_CACHE_TTL) {
    const metrics = await fetchYouTubeMetrics(ids);
    ytCache = { ts: now, metrics };
  }

  // Enrich rows and flag duplicate video IDs so totals aren't double-counted
  const seenIds = new Set();
  return deliverables.map(d => {
    const id = extractYouTubeId(d.ytLink);
    if (!id || !ytCache.metrics[id]) return d;
    const enriched = { ...d, ...ytCache.metrics[id] };
    if (seenIds.has(id)) enriched.ytDupe = true;
    else seenIds.add(id);
    return enriched;
  });
}

const SPREADSHEET_ID   = '11m1M_Y0SCmX5Lpp7wlVpgjIbDV8tiPdTweGZdiV_a-U';
const INFLUENCERS_TAB  = 'Mapping Sheet';
const DELIVERABLES_TAB = 'Overall tracking sheet';
const REQUESTS_TAB     = 'Requests';

const SA_EMAIL = 'influenza@influenza-492010.iam.gserviceaccount.com';
const SA_KEY   = process.env.SA_PRIVATE_KEY;

// ----------------------------------------------------------------
// Google OAuth — service account JWT flow
// ----------------------------------------------------------------
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

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });
  const { access_token, expires_in, error } = await res.json();
  if (error) throw new Error('Token error: ' + error);

  _tokenCache = { token: access_token, exp: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

// ----------------------------------------------------------------
// Sheets helpers
// ----------------------------------------------------------------
async function sheetsGet(range) {
  const token = await getAccessToken();
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json  = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.values || [];
}

async function sheetsAppend(tab, values) {
  const token = await getAccessToken();
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(tab + '!A:A')}:append?valueInputOption=USER_ENTERED`;
  const res   = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ values: [values] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

async function sheetsUpdate(tab, row, values) {
  const token = await getAccessToken();
  const range = `${tab}!B${row}`;
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res   = await fetch(url, {
    method:  'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ values: [values] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

// ----------------------------------------------------------------
// Parsers — sheet rows → JS objects
// ----------------------------------------------------------------
function parseInfluencers(rows) {
  return rows.slice(1).filter(r => r[1]).map((r, i) => ({
    _row:         i + 2,
    name:         r[1]  || '',
    connectType:  r[2]  || '',
    platform:     r[3]  || '',
    category:     r[4]  || '',
    link:         r[5]  || '',
    followers:    parseFloat(r[6])  || 0,
    state:        r[7]  || '',
    language:     r[8]  || '',
    email:        r[9]  || '',
    phone:        r[10] || '',
    affiliateId:  r[11] || '',
    discountCode: r[12] || '',
    orderTotal:   parseFloat(r[13]) || 0,
    orders:       parseFloat(r[14]) || 0,
  }));
}

function parseDeliverables(rows) {
  return rows.slice(1).filter(r => r[1]).map((r, i) => ({
    _row:            i + 2,
    slNo:            r[0]  || '',
    influencer:      r[1]  || '',
    accountLink:     r[2]  || '',
    followers:       parseFloat(r[3])  || 0,
    category:        r[4]  || '',
    language:        r[5]  || '',
    asset:           r[6]  || '',
    status:          r[7]  || '',
    product:         r[8]  || '',
    skuIds:          r[9]  || '',
    productSent:     r[10] || '',
    customOrderDate: r[11] || '',
    deliveryDate:    r[12] || '',
    tat:             r[13] || '',
    scheduledDate:   r[14] || '',
    scheduledMonth:  r[15] || '',
    dateOfPosting:   r[16] || '',
    monthOfPosting:  r[17] || '',
    manualViews:     parseFloat(r[18]) || 0,
    ytLink:          r[19] || '',
    colU:            r[20] || '',
    colV:            r[21] || '',
    igLink:          r[22] || '',
    igViews:         parseFloat(r[23]) || 0,
    influencerCost:  parseFloat(r[24]) || 0,
    cogs:            parseFloat(r[25]) || 0,
    costToKreo:      parseFloat(r[26]) || 0,
    affiliateLink:   r[27] || '',
    totalSale:       parseFloat(r[28]) || 0,
    orders:          parseFloat(r[29]) || 0,
    conversionRate:  parseFloat(r[30]) || 0,
    oldVsRepeat:     r[31] || '',
  }));
}

function parseRequests(rows) {
  return rows.slice(1).filter(r => r[0] || r[1]).map((r, i) => ({
    _row:               i + 2,
    date:               r[0]  || '',
    requestedBy:        r[1]  || '',
    creatorName:        r[2]  || '',
    platform:           r[3]  || '',
    type:               r[4]  || '',
    product:            r[5]  || '',
    skuId:              r[6]  || '',
    profileLink:        r[7]  || '',
    estimatedFollowers: r[8]  || '',
    notes:              r[9]  || '',
    status:             r[10] || 'Pending',
  }));
}

// ----------------------------------------------------------------
// Write helpers — JS objects → sheet row arrays
// ----------------------------------------------------------------
function influencerRow(d) {
  return [
    d.name || '', d.connectType || '', d.platform || '', d.category || '',
    d.link || '', d.followers || '', d.state || '', d.language || '',
    d.email || '', d.phone || '', d.affiliateId || '', d.discountCode || '',
    d.orderTotal || '', d.orders || '',
  ];
}

function deliverableRow(d) {
  return [
    d.influencer || '', d.accountLink || '', d.followers || '', d.category || '',
    d.language || '', d.asset || '', d.status || '', d.product || '',
    d.skuIds || '', d.productSent || '', d.customOrderDate || '', d.deliveryDate || '',
    d.tat || '', d.scheduledDate || '', d.scheduledMonth || '', d.dateOfPosting || '',
    d.monthOfPosting || '', d.manualViews || '', d.ytLink || '',
    d.colU || '', d.colV || '',
    d.igLink || '', d.igViews || '', d.influencerCost || '', d.cogs || '',
    d.costToKreo || '', d.affiliateLink || '', d.totalSale || '',
    d.orders || '', d.conversionRate || '', d.oldVsRepeat || '',
  ];
}

// ----------------------------------------------------------------
// Handler
// ----------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  try {
    // GET — read data
    if (req.method === 'GET') {
      const { action } = req.query;

      if (action === 'getAll') {
        const [infRows, delRows, reqRows] = await Promise.all([
          sheetsGet(INFLUENCERS_TAB),
          sheetsGet(DELIVERABLES_TAB),
          sheetsGet(REQUESTS_TAB),
        ]);
        const deliverablesParsed = await enrichWithYouTube(parseDeliverables(delRows));
        return res.json({
          influencers:  parseInfluencers(infRows),
          deliverables: deliverablesParsed,
          requests:     parseRequests(reqRows),
        });
      }

      if (action === 'getInfluencers') {
        const rows = await sheetsGet(INFLUENCERS_TAB);
        return res.json(parseInfluencers(rows));
      }

      return res.status(400).json({ error: 'Unknown action: ' + action });
    }

    // POST — write data
    if (req.method === 'POST') {
      const body   = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { action, data } = body || {};

      if (action === 'addInfluencer') {
        const lastRow = (await sheetsGet(INFLUENCERS_TAB)).length;
        await sheetsAppend(INFLUENCERS_TAB, [lastRow, ...influencerRow(data)]);
        return res.json({ success: true });
      }

      if (action === 'updateInfluencer') {
        await sheetsUpdate(INFLUENCERS_TAB, data._row, influencerRow(data));
        return res.json({ success: true });
      }

      if (action === 'addDeliverable') {
        const lastRow = (await sheetsGet(DELIVERABLES_TAB)).length;
        await sheetsAppend(DELIVERABLES_TAB, [lastRow, ...deliverableRow(data)]);
        return res.json({ success: true });
      }

      if (action === 'updateDeliverable') {
        await sheetsUpdate(DELIVERABLES_TAB, data._row, deliverableRow(data));
        return res.json({ success: true });
      }

      if (action === 'addRequest') {
        await sheetsAppend(REQUESTS_TAB, [
          new Date().toISOString(), data.requestedBy || '', data.creatorName || '',
          data.platform || '', data.type || '', data.product || '',
          data.skuId || '', data.profileLink || '', data.estimatedFollowers || '',
          data.notes || '', data.status || 'Pending',
        ]);
        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action: ' + action });
    }

    return res.status(405).end('Method Not Allowed');

  } catch (err) {
    console.error('Data API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
