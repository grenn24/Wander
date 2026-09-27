import test from 'node:test';
import assert from 'node:assert/strict';
import { freeToUse, usable, fits, shape, describe as describeFile, placeFor } from '../scripts/guides/commons.mjs';
import { commonsWidth, imageURL, srcSet, sourceOf } from '../lib/guideFormat.js';

const file = (over = {}) => ({
  pageid: 7,
  title: 'File:Svinøya Rorbuer, Svolvær, Lofoten, Norway.jpg',
  imageinfo: [{
    thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Sv.jpg/1920px-Sv.jpg?utm_source=commons',
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Sv.jpg?utm_source=commons',
    width: 6938, height: 3903, mime: 'image/jpeg',
    extmetadata: {
      Artist: { value: '<a href="/wiki/User:Someone">Someone</a>' },
      License: { value: 'cc-by-sa-2.0' },
      LicenseShortName: { value: 'CC BY-SA 2.0' },
    },
    ...(over.imageinfo || {}),
  }],
  ...over,
});

test('only licences that allow any use are taken', () => {
  ['cc0', 'cc-by-4.0', 'cc-by-sa-3.0', 'pd', 'public domain'].forEach((l) => assert.equal(freeToUse(l), true, l));
  ['cc-by-nc-4.0', 'cc-by-nd-4.0', 'cc-by-nc-sa-2.0', 'fairuse', '', null].forEach((l) => assert.equal(freeToUse(l), false, String(l)));
});

test('a Commons file becomes a photograph with its credit attached', () => {
  const m = shape(file());
  assert.equal(m.provider, 'commons');
  assert.equal(m.author, 'Someone');
  assert.equal(m.licence, 'CC BY-SA 2.0');
  // Wikimedia's own tracking is dropped, so the same picture is one cached link.
  assert.equal(m.raw, 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Sv.jpg/1920px-Sv.jpg');
  assert.equal(m.pageUrl, 'https://commons.wikimedia.org/wiki/File:Sv.jpg');
  assert.equal(m.alt, 'Svinøya Rorbuer, Svolvær, Lofoten, Norway');
});

test('a filename is read as a description, without its cataloguing', () => {
  assert.equal(describeFile('File:059 Split Gateway to Tirta Gangga, Bali, photograph by A Bhikkhu.jpg'),
    'Split Gateway to Tirta Gangga, Bali');
  assert.equal(describeFile('File:Dihua_Street_Taipei.jpg'), 'Dihua Street Taipei');
});

test('maps, badges and pictures too small or too thin are left alone', () => {
  assert.equal(usable(shape(file())), true);
  const nc = file({ imageinfo: { extmetadata: { License: { value: 'cc-by-nc-2.0' } } } });
  assert.equal(usable(shape(nc)), false);
  const small = file({ imageinfo: { width: 900, height: 600, extmetadata: { License: { value: 'cc0' } } } });
  assert.equal(usable(shape(small)), false);
  const map = file({ title: 'File:Map of Lofoten.jpg', imageinfo: { extmetadata: { License: { value: 'cc0' } } } });
  assert.equal(usable(shape(map)), false);
  const banner = file({ imageinfo: { width: 4000, height: 500, extmetadata: { License: { value: 'cc0' } } } });
  assert.equal(usable(shape(banner)), false);
});

test('a tall frame takes a wide photograph it can crop, a wide frame never takes a tall one', () => {
  const wide = { width: 6938, height: 3903 };
  const squarish = { width: 4608, height: 3456 };
  const tall = { width: 2736, height: 3648 };
  assert.equal(fits(wide, 'landscape'), 2);
  assert.equal(fits(tall, 'landscape'), 0);
  assert.equal(fits(tall, 'portrait'), 2);
  // Four by three survives the crop to four by five; two by one does not.
  assert.equal(fits(squarish, 'portrait'), 1);
  assert.equal(fits(wide, 'portrait'), 0);
});

test('a photo search finds the place it is about, for searching by coordinates', () => {
  const doc = { places: [{ name: 'Pisac', lat: -13.4, lng: -71.8 }, { name: 'Plaza de Armas del Cusco', lat: -13.5, lng: -71.9 }] };
  assert.equal(placeFor(doc, 'Pisac upper terraces Peru').name, 'Pisac');
  assert.equal(placeFor(doc, 'Ollantaytambo terraces'), null);
  assert.equal(placeFor({ places: [] }, 'anywhere'), null);
  // The same island under the name its lodge uses.
  const fiji = { places: [{ name: 'Waya Lailai Eco Haven', lat: -17.35, lng: 177.14 }] };
  assert.equal(placeFor(fiji, 'Wayasewa Island Yasawa Fiji').name, 'Waya Lailai Eco Haven');
  assert.equal(placeFor(fiji, 'Sawa-i-Lau Caves'), null);
});

test('Commons is only asked for widths it will render', () => {
  assert.equal(commonsWidth(100), 500);
  assert.equal(commonsWidth(1000), 1280);
  assert.equal(commonsWidth(1920), 1920);
  assert.equal(commonsWidth(3000), 1920);
  // Wikimedia will not enlarge a picture, so a small original stops sooner.
  assert.equal(commonsWidth(1920, 1700), 1280);
  const m = shape(file());
  assert.equal(imageURL(m, 640), 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Sv.jpg/960px-Sv.jpg');
  // A long list of widths collapses to the few sizes actually served.
  assert.equal(srcSet(m, [640, 960, 1400, 2000, 2800]).split(',').length, 2);
  assert.equal(sourceOf(m).name, 'Wikimedia Commons');
  assert.equal(sourceOf({ provider: 'unsplash' }).name, 'Unsplash');
});
