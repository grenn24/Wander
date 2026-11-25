import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardInset, takesTyping } from '../lib/keyboardInset.js';

test('a keyboard over the bottom of the window is measured from the visible region', () => {
  assert.equal(keyboardInset({ innerHeight: 800, height: 460, offsetTop: 0, editing: true }), 340);
  // Safari scrolls the visual viewport down a little as it opens; what is still covered is less.
  assert.equal(keyboardInset({ innerHeight: 800, height: 460, offsetTop: 40.4, editing: true }), 300);
});

test('no keyboard without a field, a browser toolbar is not one, and zoom is not one', () => {
  assert.equal(keyboardInset({ innerHeight: 800, height: 460, editing: false }), 0);
  assert.equal(keyboardInset({ innerHeight: 800, height: 720, editing: true }), 0);
  assert.equal(keyboardInset({ innerHeight: 800, height: 400, scale: 2, editing: true }), 0);
  // A browser that resizes the page for the keyboard leaves nothing to make up.
  assert.equal(keyboardInset({ innerHeight: 460, height: 460, editing: true }), 0);
  assert.equal(keyboardInset({ innerHeight: 0, height: 0, editing: true }), 0);
});

test('only fields that are typed into count as bringing up a keyboard', () => {
  assert.equal(takesTyping({ tagName: 'TEXTAREA' }), true);
  assert.equal(takesTyping({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(takesTyping({ tagName: 'INPUT', type: 'search' }), true);
  assert.equal(takesTyping({ tagName: 'INPUT' }), true);
  assert.equal(takesTyping({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(takesTyping({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(takesTyping({ tagName: 'INPUT', type: 'file' }), false);
  assert.equal(takesTyping({ tagName: 'TEXTAREA', readOnly: true }), false);
  assert.equal(takesTyping({ tagName: 'BUTTON' }), false);
  assert.equal(takesTyping(null), false);
});
