/*
 * Whether this browser is already signed in, known before the page paints.
 *
 * The landing page is the one page that has to look right for someone who is
 * signed in and for someone who is not, and it is served as plain HTML: the
 * server has no session to look at, because Supabase keeps it in this browser's
 * localStorage. Waiting for the SDK to load, start and answer meant the account
 * control arrived after everything around it, and — worse — that a token which
 * could not be refreshed (a flaky connection, an auth server that was slow to
 * answer) was reported as "no session" some seconds later, swapping a signed-in
 * visitor's controls for "Open Wander".
 *
 * So the stored session is read directly, in a script that runs while the page
 * is still being parsed. It does not verify anything; it only says what this
 * browser is holding. Verifying is the SDK's job, and it is done after the page
 * is up (components/LandingAccount.jsx), where a session the server has
 * rejected disappears from storage and this hint follows it.
 */

/**
 * The key supabase-js keeps its session under: the first label of the API
 * hostname, so 127.0.0.1 and localhost differ from a hosted project's id.
 * lib/supabase.js passes it to the client explicitly, so the two cannot drift.
 */
export function authStorageKey(url) {
  try { return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`; }
  catch { return ''; }
}

/**
 * Sets what the landing page's CSS reads: `data-account="in"` on <html> when
 * a session is stored, and the initials for the avatar as a custom property.
 * Self-contained on purpose — the root of the page serialises this function
 * into an inline script, so it cannot reach for anything outside itself.
 * Returns the account it found, or null.
 */
export function installAccountHint(storageKey, leaving) {
  const root = document.documentElement;
  let account = null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const stored = raw ? JSON.parse(raw) : null;
    // The same test the SDK applies before it will use a stored session — and
    // not a session that is being signed out, whose refresh token is `leaving`.
    if (stored && typeof stored.access_token === 'string' && typeof stored.refresh_token === 'string'
      && stored.refresh_token !== leaving) {
      const user = stored.user || {};
      const meta = user.user_metadata || {};
      const name = String(meta.display_name || meta.full_name || meta.name
        || String(user.email || '').split('@')[0] || 'Traveller').trim().slice(0, 40) || 'Traveller';
      // Code points, not code units: a name that opens with an emoji should
      // not be cut in half.
      const words = name.split(/[\s._-]+/).filter(Boolean).map((word) => Array.from(word));
      const letters = words.length >= 2 ? [words[0][0], words[1][0]] : Array.from(name).slice(0, 2);
      account = { name, initials: letters.join('').toUpperCase() };
    }
  } catch (e) { /* Storage blocked or unreadable: the same as signed out. */ }

  if (account) {
    root.setAttribute('data-account', 'in');
    // A CSS string, so the avatar can print it without any script of its own.
    root.style.setProperty('--account-initials', `"${account.initials.replace(/[\\"]/g, '\\$&')}"`);
  } else {
    root.removeAttribute('data-account');
    root.style.removeProperty('--account-initials');
  }
  return account;
}

/*
 * Signing out is the one time storage is behind.
 *
 * AppProvider leaves for the landing page first and drops the session while it
 * arrives, so that signing out reads as leaving rather than as being bounced to
 * a sign-in form. But the session stays in storage until the server has
 * answered the logout request, and for that long the landing page believed what
 * it read and showed a signed-in visitor's controls to someone who had just
 * asked to sign out.
 *
 * So the session being signed out is remembered, by its refresh token, and
 * treated as gone. It is that session and not "signed out" in general, so the
 * next sign-in — a different token — is not affected and nothing has to reset
 * this. It lives only in this page's memory, on purpose: a reload goes back to
 * believing storage.
 */
let signingOut = null;

/**
 * As someone asks to sign out, before the page changes. Never throws.
 * Nothing needs to undo it if the request fails: the SDK drops the local
 * session whether or not the server could be reached.
 */
export function markSigningOut(url = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(authStorageKey(url || '')));
    if (stored && typeof stored.refresh_token === 'string') signingOut = stored.refresh_token;
  } catch (e) { /* Nothing stored, or unreadable: nothing to mark. */ }
}

/** The refresh token of a session on its way out, or null. */
export function signingOutToken() {
  return signingOut;
}

/** The inline script for a given Supabase URL; empty when there is none. */
export function accountHintScript(url) {
  const key = authStorageKey(url);
  return key ? `(${installAccountHint.toString()})(${JSON.stringify(key)});` : '';
}
