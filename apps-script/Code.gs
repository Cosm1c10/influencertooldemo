// ================================================================
// Kreo Influencer Hub — Google Apps Script Webhook
// Deploy as: Web App → Execute as: Me → Who has access: Anyone
// Access is protected by API_KEY — requests without it are rejected
// ================================================================

const SHEET_ID        = '11m1M_Y0SCmX5Lpp7wlVpgjIbDV8tiPdTweGZdiV_a-U';
const API_KEY         = 'kreo-2024-xK9mP3nQ'; // change this to any secret string
const INFLUENCERS_TAB = 'Mapping Sheet';
const DELIVERABLES_TAB= 'Overall tracking sheet';
const REQUESTS_TAB    = 'Requests';

// ----------------------------------------------------------------
// ROUTER
// ----------------------------------------------------------------
function doGet(e) {
  const params  = e.parameter;
  const cb      = params.callback;
  const action  = params.action;
  let result;

  if (params.key !== API_KEY) {
    result = { error: 'Unauthorized' };
    return ContentService
      .createTextOutput(cb + '(' + JSON.stringify(result) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  try {
    if      (action === 'getAll')         result = getAll();
    else if (action === 'getInfluencers') result = getInfluencers();
    else                                  result = { error: 'Unknown action: ' + action };
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(cb + '(' + JSON.stringify(result) + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function doPost(e) {
  let result;
  try {
    const body   = JSON.parse(e.postData.contents);
    if (body.key !== API_KEY) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const action = body.action;
    const data   = body.data;

    if      (action === 'addInfluencer')    result = addInfluencer(data);
    else if (action === 'updateInfluencer') result = updateInfluencer(data);
    else if (action === 'addDeliverable')   result = addDeliverable(data);
    else if (action === 'updateDeliverable')result = updateDeliverable(data);
    else if (action === 'addRequest')       result = addRequest(data);
    else                                    result = { error: 'Unknown action: ' + action };
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------------------------------------
// READ
// ----------------------------------------------------------------
function getAll() {
  return {
    influencers:  getInfluencers(),
    deliverables: getDeliverables(),
    requests:     getRequests()
  };
}

function getInfluencers() {
  const rows = getSheet(INFLUENCERS_TAB).getDataRange().getValues();
  const out  = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[1]) continue; // skip blank rows
    out.push({
      _row:        i + 1,
      name:        r[1]  || '',
      connectType: r[2]  || '',
      platform:    r[3]  || '',
      category:    r[4]  || '',
      link:        r[5]  || '',
      followers:   r[6]  || 0,
      state:       r[7]  || '',
      language:    r[8]  || '',
      email:       r[9]  || '',
      phone:       r[10] || '',
      affiliateId: r[11] || '',
      discountCode:r[12] || '',
      orderTotal:  r[13] || 0,
      orders:      r[14] || 0
    });
  }
  return out;
}

function getDeliverables() {
  const rows = getSheet(DELIVERABLES_TAB).getDataRange().getValues();
  const out  = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[1]) continue; // skip blank rows
    out.push({
      _row:            i + 1,
      slNo:            r[0]  || '',
      influencer:      r[1]  || '',
      accountLink:     r[2]  || '',
      followers:       r[3]  || 0,
      category:        r[4]  || '',
      language:        r[5]  || '',
      asset:           r[6]  || '',
      status:          r[7]  || '',
      product:         r[8]  || '',
      skuIds:          r[9]  || '',
      productSent:     r[10] || '',
      customOrderDate: fmtDate(r[11]),
      deliveryDate:    fmtDate(r[12]),
      tat:             r[13] || '',
      scheduledDate:   fmtDate(r[14]),
      scheduledMonth:  r[15] || '',
      dateOfPosting:   fmtDate(r[16]),
      monthOfPosting:  r[17] || '',
      manualViews:     r[18] || 0,
      ytLink:          r[19] || '', // col T  — Links (YouTube)
      colU:            r[20] || '', // col U  — TODO: confirm header
      colV:            r[21] || '', // col V  — TODO: confirm header
      igLink:          r[22] || '', // col W  — Insta Links
      igViews:         r[23] || 0,
      influencerCost:  r[24] || 0,
      cogs:            r[25] || 0,
      costToKreo:      r[26] || 0,
      affiliateLink:   r[27] || '',
      totalSale:       r[28] || 0,
      orders:          r[29] || 0,
      conversionRate:  r[30] || 0,
      oldVsRepeat:     r[31] || ''
    });
  }
  return out;
}

function getRequests() {
  const sheet = getSheet(REQUESTS_TAB);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const out  = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] && !r[1]) continue;
    // TODO: map to actual Requests tab column order once confirmed
    out.push({
      _row:              i + 1,
      date:              fmtDate(r[0]),
      requestedBy:       r[1]  || '',
      creatorName:       r[2]  || '',
      platform:          r[3]  || '',
      type:              r[4]  || '',
      product:           r[5]  || '',
      skuId:             r[6]  || '',
      profileLink:       r[7]  || '',
      estimatedFollowers:r[8]  || '',
      notes:             r[9]  || '',
      status:            r[10] || 'Pending'
    });
  }
  return out;
}

// ----------------------------------------------------------------
// WRITE — Influencers
// ----------------------------------------------------------------
function addInfluencer(d) {
  const sheet   = getSheet(INFLUENCERS_TAB);
  const nextNo  = sheet.getLastRow(); // row count = next S.No.
  sheet.appendRow([
    nextNo,
    d.name        || '',
    d.connectType || '',
    d.platform    || '',
    d.category    || '',
    d.link        || '',
    d.followers   || '',
    d.state       || '',
    d.language    || '',
    d.email       || '',
    d.phone       || '',
    d.affiliateId || '',
    d.discountCode|| '',
    '',  // Order Total (computed by sheet)
    ''   // Orders (computed by sheet)
  ]);
  return { success: true };
}

function updateInfluencer(d) {
  getSheet(INFLUENCERS_TAB).getRange(d._row, 2, 1, 14).setValues([[
    d.name        || '',
    d.connectType || '',
    d.platform    || '',
    d.category    || '',
    d.link        || '',
    d.followers   || '',
    d.state       || '',
    d.language    || '',
    d.email       || '',
    d.phone       || '',
    d.affiliateId || '',
    d.discountCode|| '',
    d.orderTotal  || '',
    d.orders      || ''
  ]]);
  return { success: true };
}

// ----------------------------------------------------------------
// WRITE — Deliverables
// ----------------------------------------------------------------
function addDeliverable(d) {
  const sheet  = getSheet(DELIVERABLES_TAB);
  const nextNo = sheet.getLastRow();
  sheet.appendRow([
    nextNo,
    d.influencer      || '',
    d.accountLink     || '',
    d.followers       || '',
    d.category        || '',
    d.language        || '',
    d.asset           || '',
    d.status          || '',
    d.product         || '',
    d.skuIds          || '',
    d.productSent     || '',
    d.customOrderDate || '',
    d.deliveryDate    || '',
    d.tat             || '',
    d.scheduledDate   || '',
    d.scheduledMonth  || '',
    d.dateOfPosting   || '',
    d.monthOfPosting  || '',
    d.manualViews     || '',
    d.ytLink          || '',
    '',                  // col U
    '',                  // col V
    d.igLink          || '',
    d.igViews         || '',
    d.influencerCost  || '',
    d.cogs            || '',
    d.costToKreo      || '',
    d.affiliateLink   || '',
    d.totalSale       || '',
    d.orders          || '',
    d.conversionRate  || '',
    d.oldVsRepeat     || ''
  ]);
  return { success: true };
}

function updateDeliverable(d) {
  getSheet(DELIVERABLES_TAB).getRange(d._row, 2, 1, 31).setValues([[
    d.influencer      || '',
    d.accountLink     || '',
    d.followers       || '',
    d.category        || '',
    d.language        || '',
    d.asset           || '',
    d.status          || '',
    d.product         || '',
    d.skuIds          || '',
    d.productSent     || '',
    d.customOrderDate || '',
    d.deliveryDate    || '',
    d.tat             || '',
    d.scheduledDate   || '',
    d.scheduledMonth  || '',
    d.dateOfPosting   || '',
    d.monthOfPosting  || '',
    d.manualViews     || '',
    d.ytLink          || '',
    '',                  // col U
    '',                  // col V
    d.igLink          || '',
    d.igViews         || '',
    d.influencerCost  || '',
    d.cogs            || '',
    d.costToKreo      || '',
    d.affiliateLink   || '',
    d.totalSale       || '',
    d.orders          || '',
    d.conversionRate  || '',
    d.oldVsRepeat     || ''
  ]]);
  return { success: true };
}

// ----------------------------------------------------------------
// WRITE — Requests
// ----------------------------------------------------------------
function addRequest(d) {
  const sheet = getSheet(REQUESTS_TAB);
  if (!sheet) return { error: 'Requests tab not found' };
  sheet.appendRow([
    new Date(),
    d.requestedBy        || '',
    d.creatorName        || '',
    d.platform           || '',
    d.type               || '',
    d.product            || '',
    d.skuId              || '',
    d.profileLink        || '',
    d.estimatedFollowers || '',
    d.notes              || '',
    d.status             || 'Pending'
  ]);
  return { success: true };
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------
function getSheet(name) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}

function fmtDate(val) {
  if (!val) return '';
  try { return new Date(val).toISOString().split('T')[0]; }
  catch(e) { return String(val); }
}
