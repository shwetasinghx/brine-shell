/* =========================================
   Google Sheets storage.
   Appends rows to named tabs in one spreadsheet so orders, contact
   messages, and newsletter signups are all visible/exportable without
   a database. Each function lazily builds its own client so the
   server can still boot (e.g. for /api/health) even if Sheets
   credentials aren't configured yet.
   ========================================= */
const { google } = require('googleapis');

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('Google Sheets is not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY missing in .env)');
  }
  return new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
}

async function appendRow(tabName, row) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    throw new Error('GOOGLE_SHEET_ID is not set in .env');
  }
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tabName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

/* Finds the first row in a tab whose column A matches `key` and
   overwrites the given columns (used to flip an order from
   "pending" to "paid" after Razorpay verification). */
async function updateRowByKey(tabName, key, updates) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!A:A`,
  });
  const rows = data.values || [];
  const rowIndex = rows.findIndex(r => r[0] === key);
  if (rowIndex === -1) return false;

  const requests = Object.entries(updates).map(([col, value]) => ({
    range: `${tabName}!${col}${rowIndex + 1}`,
    values: [[value]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data: requests },
  });
  return true;
}


/* Returns every row in a tab as an array of arrays (row 1 = header).
   Used to filter Orders by the logged-in user's email, or to find a
   single order by id, without needing a real database. */
async function getRows(tabName) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!A:Z`,
  });
  return data.values || [];
}

/* Finds the row whose column A matches `key` and overwrites it
   entirely with `row`; appends `row` as a new row if no match exists.
   Used for the Profiles tab, where each account has at most one row
   and saving should replace it rather than pile up duplicates. */
async function upsertRow(tabName, key, row) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!A:A`,
  });
  const rows = data.values || [];
  const rowIndex = rows.findIndex(r => r[0] === key);

  if (rowIndex === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${tabName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
  } else {
    const endCol = String.fromCharCode(64 + row.length); // row.length=5 -> 'E'
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!A${rowIndex + 1}:${endCol}${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  }
}

/* Like updateRowByKey, but matches on an arbitrary column instead of
   always column A -- used for Returns, where the natural key (a
   per-request id) was added as a new column at the END of an existing
   sheet rather than the front, specifically so it never shifts/breaks
   the position of any column a real spreadsheet the user already
   filled in. `columnIndex` is 0-based (0 = A, 1 = B, ...). */
async function updateRowByColumn(tabName, columnIndex, key, updates) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const colLetter = String.fromCharCode(65 + columnIndex);

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!${colLetter}:${colLetter}`,
  });
  const rows = data.values || [];
  const rowIndex = rows.findIndex(r => r[0] === key);
  if (rowIndex === -1) return false;

  const requests = Object.entries(updates).map(([col, value]) => ({
    range: `${tabName}!${col}${rowIndex + 1}`,
    values: [[value]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data: requests },
  });
  return true;
}

module.exports = { appendRow, updateRowByKey, updateRowByColumn, getRows, upsertRow };
