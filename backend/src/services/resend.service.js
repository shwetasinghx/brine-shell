/* =========================================
   Transactional email via Resend.
   ========================================= */
const { Resend } = require('resend');

function getClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set in .env');
  return new Resend(key);
}

async function sendEmail({ to, subject, html, replyTo }) {
  const resend = getClient();
  const from = process.env.CONTACT_FROM_EMAIL || 'orders@brineandshell.com';
  const { data, error } = await resend.emails.send({
    from: `Brine & Shell <${from}>`,
    to,
    subject,
    html,
    ...(replyTo ? { reply_to: replyTo } : {}),
  });
  if (error) throw new Error('Resend error: ' + JSON.stringify(error));
  return data;
}

module.exports = { sendEmail };
