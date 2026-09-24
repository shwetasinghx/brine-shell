/* =========================================
   Shared HTML shell for transactional emails.
   Every email this backend sends was, until now, a single bare <p>
   tag -- functional, but nothing a customer would mistake for a real
   brand. This gives every email the same look: the Brine & Shell
   wordmark, a colored status badge, a CTA back to the site, and a
   plain-text footer -- built the way transactional email actually
   has to be built (fully inline styles, table-based layout, no
   external assets/fonts/images) since most inboxes strip <style>
   blocks and never load remote fonts or a localhost-hosted logo.
   Currently used by the order-status-update email; written so any
   other email in this codebase can adopt the same shell later
   without duplicating this scaffolding.
   ========================================= */

const BRAND = {
  cream: '#FAF0E2',
  creamDk: '#F0DFC0',
  navy: '#1C1B3A',
  gold: '#C9A45A',
  white: '#FFFFFF',
  text: '#2a2a2a',
  muted: '#6b6b6b',
};

const SITE_URL = (process.env.ALLOWED_ORIGIN || 'http://localhost:3000').replace(/\/+$/, '');

// Same status-badge color language already established on the admin
// dashboard (see admin.html's select.status-* / tr.row-* rules) --
// green = done/good, amber = in progress, red = cancelled, navy =
// still early in the pipeline. Kept in sync intentionally: an admin
// glancing at both the dashboard and a forwarded customer email
// should see the same color mean the same thing in both places.
const STATUS_META = {
  'Order Placed': { color: BRAND.navy, bg: '#eceaf5', blurb: "We've got your order and we're getting it ready." },
  'Shipped': { color: BRAND.navy, bg: '#eceaf5', blurb: 'Your order has left our hands and is on its way to you.' },
  'Out for Delivery': { color: '#b35c00', bg: '#fdecd2', blurb: "It's out for delivery and should reach you today." },
  'Delivered': { color: '#1e7e34', bg: '#eaf6ec', blurb: 'Your order has arrived. We hope you love it!' },
  'Cancelled': { color: '#b3261e', bg: '#fdecea', blurb: 'This order has been cancelled.' },
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Renders the full order-status-update email. `note` is an optional
   admin-typed reason (only ever set for Cancelled today) shown as its
   own callout rather than folded into the main sentence. */
function renderOrderStatusEmail({ orderId, status, note }) {
  const meta = STATUS_META[status] || { color: BRAND.navy, bg: BRAND.creamDk, blurb: 'Your order status has been updated.' };
  const safeOrderId = escapeHtml(orderId);
  const safeStatus = escapeHtml(status);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order update</title></head>
<body style="margin:0;padding:0;background:${BRAND.cream};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${BRAND.white};border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(28,27,58,.10);">

          <!-- Header -->
          <tr>
            <td align="center" style="padding:32px 32px 24px;background:${BRAND.creamDk};">
              <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;color:${BRAND.navy};">
                Brine <span style="color:${BRAND.gold};">&amp;</span> Shell
              </span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 8px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 6px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};">Order ${safeOrderId}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
                <tr>
                  <td style="background:${meta.bg};color:${meta.color};font-weight:700;font-size:14px;padding:8px 16px;border-radius:50px;">
                    ${safeStatus}
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${BRAND.text};">${escapeHtml(meta.blurb)}</p>
              ${note ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background:${BRAND.cream};border-left:3px solid ${BRAND.gold};border-radius:6px;padding:14px 16px;font-size:14px;line-height:1.5;color:${BRAND.text};">
                    ${escapeHtml(note)}
                  </td>
                </tr>
              </table>` : ''}
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:0 32px 36px;">
              <a href="${SITE_URL}/orders.html" style="display:inline-block;background:${BRAND.navy};color:${BRAND.white};text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:14px;padding:13px 30px;border-radius:50px;">
                View your order
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid ${BRAND.creamDk};font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">
                Questions about this order? Just reply to this email, or write to
                <a href="mailto:${process.env.CONTACT_TO_EMAIL || 'support@brineandshell.com'}" style="color:${BRAND.muted};">${process.env.CONTACT_TO_EMAIL || 'support@brineandshell.com'}</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { renderOrderStatusEmail, BRAND, escapeHtml };
