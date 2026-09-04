// Do not use viewport width: a narrow desktop window is still a desktop, and
// a phone with a connected mouse should still keep Enter for paragraphs.
export function isMobileComposer(browser = globalThis) {
  const nav = browser.navigator;
  if (nav?.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(nav?.userAgent || '')) return true;
  if (nav?.platform === 'MacIntel' && nav.maxTouchPoints > 1) return true;
  return !!browser.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
}

export function handleMessageEnter(event, submit, browser = globalThis) {
  if (!submit || event.defaultPrevented || event.key !== 'Enter' || event.shiftKey || event.altKey
    || event.isComposing || event.nativeEvent?.isComposing
    || event.keyCode === 229 || event.nativeEvent?.keyCode === 229
    || isMobileComposer(browser)) return false;
  event.preventDefault();
  // Holding Enter must not send several copies while React updates the UI.
  if (!event.repeat && !event.nativeEvent?.repeat) submit();
  return true;
}
