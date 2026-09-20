require('dotenv').config();
const { google } = require('googleapis');

async function main() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const sheetId = process.env.GOOGLE_SHEET_ID;
  console.log('email:', email);
  console.log('sheetId:', sheetId);
  console.log('key starts with BEGIN:', key.startsWith('-----BEGIN PRIVATE KEY-----'));
  console.log('key ends with END:', key.trim().endsWith('-----END PRIVATE KEY-----'));

  const auth = new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
  const sheets = google.sheets({ version: 'v4', auth });

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    console.log('SUCCESS. Sheet title:', meta.data.properties.title);
    console.log('Tabs found:', meta.data.sheets.map(s => s.properties.title));
  } catch (err) {
    console.error('FAILED:', err.message);
    if (err.response && err.response.data) {
      console.error('Details:', JSON.stringify(err.response.data, null, 2));
    }
  }
}
main();
