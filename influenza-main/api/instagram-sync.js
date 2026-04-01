// ================================================================
// KREO HUB — Instagram Reel Metrics via Apify
// GET /api/instagram-sync?product=ProductName&limit=3
// ================================================================

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ID    = 'apify~instagram-reel-scraper';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');

  const { product, limit = '3', month } = req.query;
  if (!product) return res.status(400).json({ error: 'product param required' });

  // Import data handler to reuse sheet fetching
  // We inline the sheet fetch here to keep it self-contained
  try {
    // Fetch deliverables from sheet to find candidates
    const { default: dataHandler } = await import('./data.js');
    // We'll call the sheet directly — reuse the token/sheet logic
    // For simplicity, the frontend passes the igLinks directly if needed,
    // but here we fetch from sheet to find matching reels
    const sheetRes = await fetch(
      `${req.headers['x-forwarded-proto']}://${req.headers['host']}/api/data?action=getAll`
    );
    const { deliverables } = await sheetRes.json();

    const candidates = (deliverables || [])
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

    const reelUrls = candidates.map(d => d.igLink);

    const apifyRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120&memory=256`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ directUrls: reelUrls, resultsLimit: parseInt(limit) }),
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
