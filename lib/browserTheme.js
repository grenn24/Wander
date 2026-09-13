/** Runs before the first paint and stays active for this document's lifetime.
 * Keep this self-contained: the root layout serializes it into its boot script.
 */
export function installBrowserTheme() {
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem('tp.theme');
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  } catch (e) { /* Browser privacy settings can block storage. */ }

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const sync = () => {
    const preference = root.getAttribute('data-theme');
    const dark = preference === 'dark' || (preference !== 'light' && media.matches);
    const colour = dark ? '#201d18' : '#fbf8f1';
    // Both server-rendered media variants follow the app override. In System
    // mode the media listener restores the colour whenever the OS changes.
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute('content', colour);
    });
    document.querySelectorAll('meta[name="color-scheme"]').forEach((meta) => {
      meta.setAttribute('content', dark ? 'dark' : 'light');
    });
  };
  sync();
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  // Next can insert fresh metadata during hydration or route navigation.
  // Observe additions only, so updating content attributes cannot cause a loop.
  new MutationObserver(sync).observe(document.head, { childList: true });
  media.addEventListener('change', sync);
  window.addEventListener('pageshow', sync);
}

export const browserThemeScript = `(${installBrowserTheme.toString()})();`;
