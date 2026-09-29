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
export function installAccountHint(storageKey) {
  const root = document.documentElement;
  let account = null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const stored = raw ? JSON.parse(raw) : null;
    // The same test the SDK applies before it will use a stored session.
    if (stored && typeof stored.access_token === 'string' && typeof stored.refresh_token === 'string') {
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

/** The inline script for a given Supabase URL; empty when there is none. */
export function accountHintScript(url) {
  const key = authStorageKey(url);
  return key ? `(${installAccountHint.toString()})(${JSON.stringify(key)});` : '';
}
