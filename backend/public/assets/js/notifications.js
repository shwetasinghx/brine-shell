/* =========================================
   BRINE & SHELL — Notification History
   Persistent, readable history of the background/system
   notices that used to be shown only as a 4.5s toast (e.g.
   "an item in your cart is no longer available"). Anyone who
   missed the toast can now open the bell in the header and
   read it later. Mirrors the storage pattern in cart.js
   (localStorage, wrapped in try/catch) and the header
   dropdown pattern in auth.js (click-toggle .menu-open,
   closed by a document-level click listener), so this stays
   consistent with the rest of the site rather than being a
   one-off bespoke widget.
   ========================================= */
const NOTIF_STORAGE_KEY = 'bs_notifications';
const NOTIF_MAX_STORED = 30;

function getNotifications() {
  try {
    const raw = localStorage.getItem(NOTIF_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveNotifications(list) {
  try {
    localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.error('Could not save notifications:', err.message);
  }
  document.dispatchEvent(new CustomEvent('notifications:changed', { detail: { list } }));
}

/* Adds a new entry to the top of the history and trims it to
   NOTIF_MAX_STORED so localStorage doesn't grow unbounded.
   `tone` mirrors showToast's tone ('info' for system notices,
   'success' for user-initiated confirmations) so the panel can
   use the same visual language as the toast that triggered it. */
function addNotification(message, { tone = 'info' } = {}) {
  const list = getNotifications();
  list.unshift({
    id: `n${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
    message,
    tone,
    time: Date.now(),
    read: false,
  });
  saveNotifications(list.slice(0, NOTIF_MAX_STORED));
}

function getUnreadCount() {
  return getNotifications().filter(n => !n.read).length;
}

function markAllNotificationsRead() {
  const list = getNotifications();
  if (!list.some(n => !n.read)) return;
  list.forEach(n => { n.read = true; });
  saveNotifications(list);
}

function clearNotifications() {
  saveNotifications([]);
}

/* Short relative-time label ("Just now", "5m ago", "3h ago",
   "2d ago") -- avoids pulling in a date library for a header
   dropdown that only ever needs coarse recency. */
function relativeTime(ts) {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function notifListMarkup(list) {
  if (!list.length) {
    return `<div class="notif-empty">No notifications yet.</div>`;
  }
  return list.map(n => `
    <div class="notif-item${n.read ? '' : ' notif-unread'} notif-${n.tone}">
      <span class="notif-dot" aria-hidden="true"></span>
      <div class="notif-item-body">
        <p>${escapeHtml(n.message)}</p>
        <span class="notif-time">${relativeTime(n.time)}</span>
      </div>
    </div>`).join('');
}

/* Renders the bell trigger + dropdown panel into containerId
   (navNotif for desktop, mobileNotif for the mobile menu),
   matching renderAuthUI's per-container render approach so the
   two header copies can both stay in sync independently. */
function renderNotifBell(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const list = getNotifications();
  const unread = list.filter(n => !n.read).length;
  el.innerHTML = `
    <div class="notif-chip" tabindex="0"
         onclick="toggleNotifPanel(event)"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleNotifPanel(event);}"
         aria-label="Notifications">
      <span class="notif-bell-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
      <span class="notif-count${unread ? '' : ' notif-count-hidden'}">${unread}</span>
      <div class="notif-panel">
        <div class="notif-panel-head">
          <span>Notifications</span>
          <button type="button" class="notif-clear-btn" onclick="event.stopPropagation();clearNotifications();">Clear all</button>
        </div>
        <div class="notif-list">${notifListMarkup(list)}</div>
      </div>
    </div>`;
}

function renderAllNotifBells() {
  renderNotifBell('navNotif');
  renderNotifBell('mobileNotif');
}

/* Click-toggle open/close, mirroring auth.js's toggleSigninMenu
   exactly (stopPropagation + a shared document click listener
   that closes any other open chip) -- chosen there over hover
   because it holds an interactive button (Clear all); same
   reasoning applies here. Opening the panel marks everything
   read, same moment a person would consider them "seen". */
function toggleNotifPanel(e) {
  e.stopPropagation();
  const chip = e.currentTarget;
  const containerId = chip.parentElement.id;
  const wasOpen = chip.classList.contains('menu-open');
  document.querySelectorAll('.notif-chip.menu-open').forEach(c => c.classList.remove('menu-open'));
  if (wasOpen) return;
  markAllNotificationsRead();
  renderAllNotifBells();
  // markAllNotificationsRead -> saveNotifications dispatches
  // 'notifications:changed', which also calls renderAllNotifBells
  // and rebuilds this chip's DOM -- so re-select it by the
  // container's id rather than reusing the (now detached) `chip`
  // reference from before the rebuild.
  const freshChip = document.querySelector(`#${containerId} .notif-chip`);
  if (freshChip) freshChip.classList.add('menu-open');
}

document.addEventListener('click', () => {
  document.querySelectorAll('.notif-chip.menu-open').forEach(c => c.classList.remove('menu-open'));
});

document.addEventListener('notifications:changed', renderAllNotifBells);
document.addEventListener('partials:ready', renderAllNotifBells);
