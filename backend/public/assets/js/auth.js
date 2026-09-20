/* =========================================
   Customer sign-in (Google) + header profile display.
   Shared by every page: renders a Google Sign-In button in the nav
   when logged out, or a name/email profile chip with a My
   Orders/Sign Out menu when logged in. Talks to the backend's
   /api/auth/* and /api/me endpoints (backend/routes/auth.js).
   ========================================= */

window.CURRENT_USER = null;

function whenGoogleReady(cb, attemptsLeft = 50) {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    cb();
  } else if (attemptsLeft > 0) {
    setTimeout(() => whenGoogleReady(cb, attemptsLeft - 1), 100);
  } else {
    console.error('Google Identity Services script did not load.');
  }
}

function initials(user) {
  const source = user.name || user.email || '?';
  return source.trim().charAt(0).toUpperCase();
}

function renderAuthUI(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (window.CURRENT_USER) {
    const user = window.CURRENT_USER;
    el.innerHTML = `
      <div class="auth-chip" tabindex="0">
        ${user.picture
          ? `<img src="${user.picture}" alt="" class="auth-avatar" referrerpolicy="no-referrer" />`
          : `<span class="auth-avatar auth-avatar-fallback">${initials(user)}</span>`}
        <span class="auth-name">${user.name}</span>
        <div class="auth-menu">
          <div class="auth-menu-email">${user.email}</div>
          <a href="account.html">My Profile</a>
          <a href="orders.html">My Orders</a>
          <button type="button" onclick="signOut()">Sign Out</button>
        </div>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="auth-chip signin-trigger" tabindex="0"
           onclick="toggleSigninMenu(event)"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleSigninMenu(event);}">
        Sign in
        <div class="auth-menu signin-menu">
          <div class="signin-menu-hint">Sign in to view your orders</div>
          <div id="${containerId}-gbtn" class="gsi-btn-wrap"></div>
        </div>
      </div>`;
    whenGoogleReady(() => renderGoogleButton(`${containerId}-gbtn`));
  }
}

function toggleSigninMenu(e) {
  e.stopPropagation();
  const chip = e.currentTarget;
  const wasOpen = chip.classList.contains('menu-open');
  document.querySelectorAll('.signin-trigger.menu-open').forEach(c => c.classList.remove('menu-open'));
  if (!wasOpen) chip.classList.add('menu-open');
}

document.addEventListener('click', () => {
  document.querySelectorAll('.signin-trigger.menu-open').forEach(c => c.classList.remove('menu-open'));
});

function renderAllAuthUI() {
  renderAuthUI('navAuth');
  renderAuthUI('mobileAuth');
}

function renderGoogleButton(elId) {
  const el = document.getElementById(elId);
  if (!el || !window.GOOGLE_CLIENT_ID || window.GOOGLE_CLIENT_ID.startsWith('YOUR_')) {
    if (el) el.innerHTML = '<span class="gsi-not-configured">Sign-in not configured yet</span>';
    return;
  }
  google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'medium', text: 'continue_with', shape: 'pill', width: 230 });
}

async function handleGoogleCredential(response) {
  try {
    const res = await fetch(`${API_BASE}/api/auth/google`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Sign-in failed.');
    window.CURRENT_USER = data.user;
    renderAllAuthUI();
    document.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: window.CURRENT_USER } }));
  } catch (err) {
    console.error('Google sign-in failed:', err.message);
  }
}

async function signOut() {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch (err) {
    console.error('Sign-out request failed:', err.message);
  }
  window.CURRENT_USER = null;
  renderAllAuthUI();
  document.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: null } }));
}

async function checkSession() {
  try {
    const res = await fetch(`${API_BASE}/api/me`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      window.CURRENT_USER = data.user;
    } else {
      window.CURRENT_USER = null;
    }
  } catch (err) {
    window.CURRENT_USER = null;
  }
  renderAllAuthUI();
  document.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: window.CURRENT_USER } }));
}

// Registered now (script execution happens before DOMContentLoaded),
// so it doesn't matter whether this file loads before or after
// js/partials.js — this listener is ready either way.
document.addEventListener('partials:ready', () => {
  whenGoogleReady(() => {
    google.accounts.id.initialize({
      client_id: window.GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
    });
    checkSession();
  });
});
