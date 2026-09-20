/* =========================================
   Runtime config. If the API ends up on a different
   host (e.g. api.brineandshell.com instead of the same
   domain), change API_BASE here — every fetch() call in
   the site reads from this one place.
   ========================================= */
window.API_BASE = '';

/* From Google Cloud Console once you create the "Sign in with
   Google" OAuth Client ID (steps in backend/README.md). Must match
   GOOGLE_CLIENT_ID in the backend's .env exactly. */
window.GOOGLE_CLIENT_ID = '736298233785-aaqdb3dn8kq4cj8uedkc9edoggcb80od.apps.googleusercontent.com';
