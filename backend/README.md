# Brine & Shell — backend API

Node/Express API for the site's three real red flags from the audit:
contact form, newsletter signup, and Razorpay checkout with the order
amount computed and verified **server-side** instead of trusted from
the browser.

## What's here

```
backend/
  server.js            Express app, mounts the three route groups
  routes/
    contact.js          POST /api/contact
    newsletter.js        POST /api/newsletter
    checkout.js           POST /api/checkout/create-order
                          POST /api/checkout/verify
  lib/
    catalog.js           reads ../data/products.json — the ONE
                          place prices live, shared with the frontend
    razorpay.js           order creation + HMAC signature verification
    mailer.js              transactional email (SMTP)
    sheets.js               appends/updates rows in a Google Sheet
  .env.example           copy to .env and fill in (never commit .env)
```

`data/products.json` (one level up, at the site root) is the single
source of truth for product names/prices/descriptions. The frontend
(`js/products.js`) fetches it at runtime; the backend `require()`s it
directly. Change a price in exactly one place.

## 1. Set up the accounts you'll need

### Google Sheet (stores orders, contact messages, newsletter emails)

1. Create a new Google Sheet. Add seven tabs named exactly `Orders`,
   `Contact`, `Newsletter`, `Returns`, `Profiles`, `Addresses`, `Reviews`
   (case-sensitive). Give each this exact header row (order matters —
   the backend writes/reads by column position, not by header name):
   - `Orders`: `Order ID | Date | Payment Status | Name | Email | Phone | Items | Total | Fulfillment Status | Delivered At | Account Email | Address | Item IDs | Cancellation Reason`
   - `Contact`: `Submitted At | First Name | Last Name | Email | Phone | Subject | Message`
   - `Newsletter`: `Signed Up At | Email`
   - `Returns`: `Requested At | Order ID | Customer Email | Items | Reason | Status | Image URL | Return ID | Video URL | Verification Phrase`
   - `Profiles`: `Account Email | Name | Phone | Updated At`
   - `Addresses`: `Address ID | Account Email | Label | Recipient Name | Phone | Address | Status | Created At | Pincode | City | State`
   - `Reviews`: `Timestamp | Order ID | Product ID | Customer Email | Customer Name | Product Rating | Delivery Speed | Review Text | Status | Review ID`
2. Go to [console.cloud.google.com](https://console.cloud.google.com),
   create a project, enable the **Google Sheets API**.
3. Create a **Service Account** (IAM & Admin → Service Accounts →
   Create), then create a JSON key for it and download it.
4. Open the downloaded JSON: copy the `client_email` value into
   `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and the `private_key` value into
   `GOOGLE_PRIVATE_KEY` (keep the `\n` sequences as literal text,
   wrapped in quotes).
5. Open your Google Sheet, click **Share**, and share it with that
   `client_email` address as **Editor**.
6. Copy the Sheet ID from its URL (`.../d/`**`THIS_PART`**`/edit`) into
   `GOOGLE_SHEET_ID`.

### Email (Hostinger business mailbox, via SMTP)

No third-party provider or DNS verification needed -- this sends
straight through your Hostinger mailbox's own SMTP server, the same
one Webmail uses.

1. In hPanel, open **Emails** and create (or note) the mailbox you
   want to send from, e.g. `support@brineandshell.com`.
2. Put that address in `SMTP_USER` and its password in `SMTP_PASS`.
   `SMTP_HOST`/`SMTP_PORT` already default to Hostinger's standard
   (`smtp.hostinger.com` / `465`) -- only change them if hPanel's
   "Configure Email Client" page for that mailbox shows something
   different.
3. Set `MAIL_FROM` to the address you want recipients to see as the
   sender (usually the same as `SMTP_USER`), and `CONTACT_TO_EMAIL` to
   where you want contact-form messages, new-review notices, and
   return requests delivered (e.g. `support@brineandshell.com`).

### Razorpay

1. From [dashboard.razorpay.com](https://dashboard.razorpay.com) →
   Settings → API Keys, generate keys. Use the **test mode** keys
   (`rzp_test_...`) first.
2. Put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`.
3. **Set up the webhook (do this once you have a public URL — after
   deploying, or via a tunnel like ngrok for local testing):**
   go to Settings → Webhooks → Add New Webhook. Set the URL to
   `https://<yourdomain>/api/checkout/webhook`, tick the
   `payment.captured` event, and paste the secret Razorpay generates
   there into `RAZORPAY_WEBHOOK_SECRET` in `.env` — this is a
   different secret from your API key secret. This webhook is what
   marks an order paid even if the customer's browser closes right
   after paying, instead of relying only on it making it back to the
   site.
4. Switch to live keys only once you've tested a full order end to
   end and the legal pages (Privacy/Terms/Refund Policy) are live —
   Razorpay generally requires those before enabling live payments.

### Google Sign-In (Client ID for the "Continue with Google" button)

This is separate from the service account above — that one is a robot
account for Sheets access; this one lets real customers sign in.

1. In the same (or a new) project at
   [console.cloud.google.com](https://console.cloud.google.com), go to
   **APIs & Services → OAuth consent screen**. Choose **External**,
   fill in the app name ("Brine & Shell"), your support email, and
   save. You don't need Google's verification for this — a handful of
   scopes (name/email) don't require review.
2. Go to **APIs & Services → Credentials → Create Credentials → OAuth
   client ID**. Application type: **Web application**.
3. Under **Authorized JavaScript origins**, add every URL the site
   will actually be opened from, e.g.:
   - `https://www.brineandshell.com`
   - `https://brineandshell.com` (if you support the bare domain too)
   - `http://localhost:5500` or similar, only while testing locally
4. You do **not** need an Authorized redirect URI for this flow (the
   Google Identity Services button posts a token directly, no
   redirect).
5. Copy the generated **Client ID** (ends in
   `.apps.googleusercontent.com`):
   - Put it in `GOOGLE_CLIENT_ID` in `backend/.env`.
   - Also put it in `js/config.js` as `window.GOOGLE_CLIENT_ID` — this
     one is *meant* to be public, it's not a secret, just an
     identifier telling Google which app is asking.
6. Reload the site — the nav should now show a real "Sign in with
   Google" button instead of "Sign-in not configured yet".

### Update the Orders sheet's header row

Your `Orders` tab's header row (row 1) should read left to right:

```
Order ID | Date | Payment Status | Name | Email | Phone | Items | Total | Fulfillment Status | Delivered At | Account Email | Address | Item IDs | Cancellation Reason
```

`Account Email` and `Address` are the two newest columns — `Account Email`
is only ever the signed-in account's own email (used to match "My
Orders"); `Address` is the delivery address typed at checkout, shown
to you in `/admin.html` so you know where to ship each order. `Item IDs`
is a compact `cubes:2;dual:1` record of exactly which product ids (and
quantities) were in the order, written once at checkout. `Items` (the
older column) is a human-readable string built from product NAMES,
which is fine to look at but can't be reliably matched back to a real
product id -- `Item IDs` is what lets a customer "review this product"
on `/orders.html` (see Reviews below) without guessing from that
display text. Orders placed before this column existed simply won't
offer a review button -- same as they already can't offer a return,
for the same "nothing to check it against" reason.

`Cancellation Reason` is the newest column, written whenever a
customer cancels their own order from `/orders.html` (`POST
/api/orders/:orderId/cancel`) — the reason box there is mandatory, so
this is never blank for a customer-initiated cancellation. It's left
blank when an order is cancelled from the admin side instead
(`/admin.html`'s order status dropdown), since that flow has its own
optional `note` field that goes straight into the customer's email
rather than into this column. Self-cancellation is only allowed while
the order is still at "Order Placed" (nothing shipped yet) -- the
server re-checks this itself before writing anything, regardless of
what the button looked like in the browser.

**Checkout requires sign-in.** `POST /api/checkout/create-order` is
guarded by the same `requireAuth` middleware as `/api/orders/mine`,
`/api/addresses`, etc. — a request with no valid session cookie is
rejected with 401 before an order is ever created, so `Account Email`
can no longer be blank for a new order. (`shop.html` also hides the
checkout modal from signed-out visitors and shows a "Sign in to check
out" prompt instead, but that's just UX — the 401 on the server is the
actual boundary.) Any older rows with a blank `Account Email` are from
before this was enforced and are safe to ignore or clean up.

Also add a tab named **Returns** with header row:

```
Timestamp | Order ID | Customer Email | Items | Reason | Status | Image URL | Return ID | Video URL | Verification Phrase
```

`Image URL` and `Video URL` are paths like `/uploads/returns/172...-a1b2c3.jpg` -- append
them to your site's domain to view the photo/video the customer attached
(e.g. `https://brineandshell.com/uploads/returns/172...-a1b2c3.jpg`).
Uploaded files are saved to an `uploads/` folder next to the site's
HTML files, so make sure that folder persists across deploys (it's in
`.gitignore`, since it's user-uploaded content, not code). `Return ID`
is used by the admin approve/cancel flow. `Verification Phrase` is the
order id + date phrase the customer was shown on screen and asked to
say out loud while recording (see below) -- it's not checked
automatically, it's there so you have the exact expected phrase on
hand when reviewing the video yourself.

**Why the video is recorded live, not uploaded:** there's no reliable
way to prove a video file wasn't cut/edited, reused from an old order,
or generated by AI -- that's a real, unsolved problem (video tamper
detection), not something a small self-hosted store can bolt on. So
`orders.html` doesn't offer a file picker for the unboxing video at
all -- it opens the customer's camera and records right there in the
browser, and shows them a phrase (their order id + today's date) to
say out loud during the clip. None of this proves anything
automatically; it just raises the effort needed to fake a return far
enough that it's not worth it, and gives you (the human reviewing the
`Return Requests` table in `/admin.html`) something concrete to check
the footage against.

Add a tab named **Profiles** with header row:

```
Account Email | Name | Phone | Updated At
```

This is the account holder's own name/phone — who placed the order and
gets the confirmation email — written when they save the "Profile"
section on `/account.html`. One row per account, overwritten in place
each time they save (not appended).

Finally, add a tab named **Addresses** with header row:

```
Address ID | Account Email | Label | Recipient Name | Phone | Address | Status | Created At | Pincode | City | State
```

(If you already created this tab before, just add **City** as column J and
**State** as column K -- new columns at the end, nothing else moves. Note
"Address" itself is now just the short street line; City/State/Pincode are
their own columns.)

This is the account's saved address book — a customer can save
several (Home, Office, a gift recipient's place), each with its own
recipient name/phone since who *receives* an order can differ from
who placed it. Managed from the "Saved Addresses" section of
`/account.html`; the checkout page's "Deliver To" picker reads from
here too. `Status` is `Active` or `Deleted` — removing an address just
flips this rather than deleting the row.

Finally, add a tab named **Reviews** with header row:

```
Timestamp | Order ID | Product ID | Customer Email | Customer Name | Product Rating | Delivery Speed | Review Text | Status | Review ID
```

A signed-in customer can review a product from `/orders.html` once
their order for it shows **Delivered** -- rating the product itself
(1-5 stars) AND separately how the delivery went (**Fast** / **On
Time** / **Late**), plus an optional written review capped at 100
words. It's one review per order+product (checked server-side, same
as the one-return-per-order rule), and the product has to have
actually been in that order (checked against `Item IDs` on the
`Orders` tab above).

New reviews save with `Status` = `Pending` and email you at
`CONTACT_TO_EMAIL` -- **nothing shows up on the shop page until you
approve it** in the "Product Reviews" table on `/admin.html`, the same
moderation pattern as return requests. Approving or rejecting emails
the customer either way. Approved reviews power the star rating and
"Read Reviews" list under each product card on `/shop.html`, including
a delivery-speed breakdown (e.g. "80% said delivery was fast") pulled
from every approved review for that product, not just the ones with
written text.

### Admin password

Pick a strong, unique password and put it in `ADMIN_PASSWORD` in
`.env` — it's the only thing protecting `/admin.html`, where you
update order statuses. Don't reuse a password from anywhere else.

### Session secret

Generate one random value for `SESSION_SECRET` (used to sign both
customer and admin session cookies):

```
openssl rand -hex 32
```

## 2. Configure

```
cp .env.example .env
# then edit .env with the values from step 1
```

Set `ALLOWED_ORIGIN` to your real site URL, e.g.
`https://www.brineandshell.com`.

## 3. Deploy on Hostinger (Node.js App Manager)

Your plan runs Node through hPanel's Node.js App Manager (Passenger),
not a bare VPS — so there's no PM2 or Nginx config to write by hand:

1. Get the code onto the server: either connect the repo via
   hPanel's Git integration (hPanel → your website → Git), or upload
   the `backend/` folder with the File Manager / FTP.
2. In hPanel, go to your website → **Advanced → Node.js**.
3. Click **Create Application**:
   - **Node.js version:** 18 or newer.
   - **Application root:** the folder you uploaded `backend/` into.
   - **Application startup file:** `server.js`.
   - **Application URL:** decide whether the API lives at
     `www.brineandshell.com` (same domain, e.g. under `/api`) or a
     subdomain like `api.brineandshell.com`. Same domain is simplest
     — no CORS configuration needed. If you use a subdomain, set
     `js/config.js`'s `API_BASE` on the frontend to that subdomain's
     URL, and set `ALLOWED_ORIGIN` in `.env` to your main domain.
4. In the same Node.js app screen, add each variable from your `.env`
   file under **Environment variables** (hPanel stores these itself —
   you don't need to upload the `.env` file).
5. Click **Run NPM Install** in the panel (this reads `package.json`
   and installs everything — you don't need SSH for this).
6. Click **Restart** to start the app. hPanel assigns the port via
   `process.env.PORT` automatically — that's why `server.js` reads
   `process.env.PORT` instead of hardcoding one.
7. Test it: visit `https://www.brineandshell.com/api/health` (or your
   chosen URL) — you should see `{"ok":true,"time":"..."}`.

If your plan does give you SSH/terminal access in hPanel, the
equivalent manual steps are `npm install --production` then let
hPanel's Node.js manager start/restart `server.js` — you still don't
need PM2 since Passenger keeps the app alive and restarts it for you.

## 4. Test each endpoint once it's live

```bash
curl https://www.brineandshell.com/api/health

curl -X POST https://www.brineandshell.com/api/contact \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Test","lastName":"User","email":"you@example.com","subject":"Order Inquiry","message":"Testing the form"}'

curl -X POST https://www.brineandshell.com/api/checkout/create-order \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"id":"cubes","qty":1}],"customer":{"name":"Test","email":"you@example.com","phone":"9876543210"}}'
```

The contact/newsletter calls should land a row in your Google Sheet
and an email in your inbox within a few seconds. The checkout call
should return a real Razorpay `orderId` once test keys are in `.env`.

## 5. Try the new customer/admin features

- Visit `/admin.html` on your domain, sign in with `ADMIN_PASSWORD`,
  and you'll see every paid order with a status dropdown. Changing it
  emails the customer automatically.
- Visit any page — once `GOOGLE_CLIENT_ID` is set in both `.env` and
  `js/config.js`, the nav shows a real "Sign in with Google" button.
  After signing in, it shows the customer's name/email instead, with
  a dropdown for **My Orders** and **Sign Out**.
- The header menu's signed-in dropdown has two separate links:
  **My Profile** (`/account.html`) and **My Orders** (`/orders.html`).
  `/account.html` holds **Profile** (name + phone, saved against
  whichever Google account is signed in) and **Saved Addresses** (an
  address book — multiple named addresses, each with its own recipient
  name/phone, so a customer can ship to somewhere other than their own
  address, e.g. a gift). `/orders.html` lists the signed-in customer's
  paid orders (matched by their signed-in account email, kept in the
  separate Account Email column so it survives the contact email being
  edited). Clicking an order shows the exact phone/address that were
  typed at checkout for that order (so the customer can double-check
  where it's headed), the Order Placed → Shipped → Out for Delivery →
  Delivered stepper, and a **Request a Return** button. A return
  requires both a written reason and a photo of the issue, and logs to
  the `Returns` tab (with a link to the photo) and emails you.
- **Cancelling an order**: the admin dashboard's status dropdown also
  offers **Cancelled** — for when an order genuinely can't be
  fulfilled (delivery location too far out of range, etc), not just
  another step toward delivery. Picking it asks for confirmation (and
  an optional reason, included in the customer's email) before saving.
  A cancelled order shows a clear "This order was cancelled" notice on
  the customer's order detail page in place of the stepper, and the
  **Request a Return** button is hidden there since there's nothing
  left to return.
- **Return requests**: the admin dashboard has a second table listing
  every return request (reason, photo link, which order/customer) with
  a status dropdown of its own — **Requested** (the default),
  **Approved**, or **Cancelled** (for a request with bad or
  insufficient info, e.g. the wrong order or an unusable photo). The
  customer gets an email either way.
- **Product reviews**: once an order shows Delivered, `/orders.html`
  lets the customer rate each product in it separately -- a 1-5 star
  product rating plus a Fast/On Time/Late delivery rating, and an
  optional 100-word written review -- one per order+product. New
  reviews land as **Pending** and email you; approve or reject them
  from the "Product Reviews" table on `/admin.html`. Only **Approved**
  reviews are public, showing as a star rating + "Read Reviews" list
  under each product on `/shop.html`, including a delivery-speed
  breakdown across everyone who's reviewed that product.

## 6. Local development (optional)

```bash
cd backend
npm install
cp .env.example .env   # fill in test-mode values
npm run dev
```

The frontend pages call the API at whatever `js/config.js`'s
`API_BASE` says — leave it as `''` for same-origin, or point it at
`http://localhost:3000` while testing locally (and set `ALLOWED_ORIGIN`
in `.env` to match wherever you're opening the HTML from).
