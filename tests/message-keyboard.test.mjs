import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isMobileComposer, handleMessageEnter } from '../lib/messageKeyboard.js';

const desktop = { navigator: { userAgent: 'Windows', maxTouchPoints: 0 }, matchMedia: () => ({ matches: false }) };
const android = { ...desktop, navigator: { userAgent: 'Mozilla Android Mobile' } };
const iphone = { ...desktop, navigator: { userAgent: 'iPhone' } };
function press(patch = {}, browser = desktop, hasSubmit = true) {
  let sent = 0;
  const event = { key: 'Enter', preventDefault() { this.defaultPrevented = true; }, ...patch };
  handleMessageEnter(event, hasSubmit ? () => { sent += 1; } : null, browser);
  return { sent, prevented: !!event.defaultPrevented };
}

test('desktop Enter sends; Shift+Enter leaves native paragraph insertion intact', () => {
  assert.deepEqual(press(), { sent: 1, prevented: true });
  assert.deepEqual(press({ shiftKey: true }), { sent: 0, prevented: false });
  assert.deepEqual(press({ ctrlKey: true }), { sent: 1, prevented: true });
  assert.deepEqual(press({ metaKey: true, shiftKey: true }), { sent: 0, prevented: false });
});

test('Android and iPhone Enter create paragraphs, even with an attached mouse or keyboard', () => {
  for (const browser of [android, iphone]) {
    assert.equal(isMobileComposer(browser), true);
    assert.deepEqual(press({}, browser), { sent: 0, prevented: false });
    assert.deepEqual(press({ ctrlKey: true }, browser), { sent: 0, prevented: false });
  }
});

test('tablets and touch-only devices use paragraphs; touch laptops and narrow desktops still send', () => {
  assert.equal(isMobileComposer({ ...desktop, navigator: { platform: 'MacIntel', maxTouchPoints: 5 } }), true);
  assert.equal(isMobileComposer({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(isMobileComposer({ ...desktop, innerWidth: 400 }), false);
  assert.equal(isMobileComposer({ ...desktop, navigator: { userAgent: 'Windows', maxTouchPoints: 10 } }), false);
  assert.equal(isMobileComposer({ ...desktop, navigator: { userAgentData: { mobile: true } } }), true);
});

test('IME confirmation never sends, including the Safari keyCode 229 fallback', () => {
  for (const patch of [{ isComposing: true }, { nativeEvent: { isComposing: true } },
    { keyCode: 229 }, { nativeEvent: { keyCode: 229 } }]) {
    assert.deepEqual(press(patch), { sent: 0, prevented: false });
  }
});

test('repeat Enter cannot duplicate submissions; other keys and ordinary textareas are unchanged', () => {
  assert.deepEqual(press({ repeat: true }), { sent: 0, prevented: true });
  assert.deepEqual(press({ key: 'a' }), { sent: 0, prevented: false });
  assert.deepEqual(press({ altKey: true }), { sent: 0, prevented: false });
  assert.deepEqual(press({}, desktop, false), { sent: 0, prevented: false });
  assert.deepEqual(press({ defaultPrevented: true }), { sent: 0, prevented: true });
});

test('both composers and planner follow-up answers use the shared keyboard policy', () => {
  for (const path of ['components/GrowArea.jsx', 'components/PlanPrompt.jsx', 'app/plan/page.js']) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(source, /handleMessageEnter\(e,/);
    assert.match(source, /enterKeyHint="enter"/);
  }
  const command = readFileSync(new URL('../components/Command.jsx', import.meta.url), 'utf8');
  assert.equal((command.match(/<GrowArea/g) || []).length, 2);
  assert.doesNotMatch(command, /Ask Wander  Ctrl\+Enter/);
});
