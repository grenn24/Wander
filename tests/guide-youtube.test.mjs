import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, chooseVideo, videoQueryFor, videoQueries, videoWords, SECTION_VIEWS, videoIdOf, pruneLeads } from '../scripts/guides/youtube.mjs';
import { rested } from '../scripts/guides/photos.mjs';

test('a video must name the guide’s places, not just its country', () => {
  const words = videoWords({
    country: 'Japan',
    videoQuery: 'Kyoto Japan travel',
    places: [{ name: 'Fushimi Inari Taisha' }, { name: 'Nara Park' }],
  });
  assert.ok(words.includes('kyoto'));
  assert.ok(words.includes('fushimi'));
  assert.ok(!words.includes('japan'));
});

test('YouTube durations read as seconds', () => {
  assert.equal(parseDuration('PT12M3S'), 723);
  assert.equal(parseDuration('PT1H2M'), 3720);
  assert.equal(parseDuration('P0D'), 0);
  assert.equal(parseDuration(''), 0);
});

const NOW = Date.parse('2026-09-14T00:00:00Z');
const video = (id, { title = 'Escalante road trip', seconds = 900, views = 50000, published = '2025-05-01T00:00:00Z', embeddable = true, privacy = 'public', lang } = {}) => ({
  id,
  snippet: { title, description: '', publishedAt: published, channelTitle: 'Desert Channel', channelId: 'UC123', ...(lang ? { defaultAudioLanguage: lang } : {}) },
  contentDetails: { duration: `PT${Math.floor(seconds / 60)}M${seconds % 60}S` },
  statistics: { viewCount: String(views) },
  status: { embeddable, privacyStatus: privacy },
});

test('only a real, recent, watchable video about the place is chosen', () => {
  const words = ['escalante'];
  const items = [
    video('aaaaaaaaaaa', { seconds: 50, title: 'Escalante #shorts' }),
    video('bbbbbbbbbbb', { published: '2017-01-01T00:00:00Z', views: 2000000 }),
    video('ccccccccccc', { title: 'Zion in a day', views: 900000 }),
    video('ddddddddddd', { embeddable: false }),
    video('eeeeeeeeeee', { views: 3000 }),
    video('fffffffffff', { views: 40000 }),
    video('ggggggggggg', { views: 400000, published: '2024-06-01T00:00:00Z' }),
  ];
  const pick = chooseVideo(items, { words, now: NOW });
  assert.equal(pick.id, 'ggggggggggg');
  assert.equal(pick.channel, 'Desert Channel');
  assert.equal(pick.seconds, 900);
  assert.equal(chooseVideo(items, { words, now: NOW, avoid: new Set(['ggggggggggg']) }).id, 'fffffffffff');
  assert.equal(chooseVideo([items[2]], { words, now: NOW }), null);
});

test('a guide without a video query still has something to search for', () => {
  assert.equal(videoQueryFor({ place: 'Kyoto & Nara' }), 'Kyoto & Nara travel');
  assert.equal(videoQueryFor({ place: 'X', videoQuery: 'Otaru winter walk' }), 'Otaru winter walk');
});

test('a long place line is searched again by its first name', () => {
  const place = 'Escalante, Cedar Mesa & Utah’s quiet canyon country';
  assert.deepEqual(videoQueries({ place, videoQuery: `${place} travel` }), [`${place} travel`, 'Escalante travel']);
  assert.deepEqual(videoQueries({ place: 'Kyoto', videoQuery: 'Kyoto travel' }), ['Kyoto travel']);
});

test('a single stop needs fewer views than a whole destination, and English or unstated audio', () => {
  const words = ['luna'];
  const guide = video('hhhhhhhhhhh', { title: 'Valle de la Luna travel guide', views: 3132 });
  assert.equal(chooseVideo([guide], { words, now: NOW }), null);
  assert.equal(chooseVideo([guide], { words, now: NOW, minViews: SECTION_VIEWS }).id, 'hhhhhhhhhhh');
  const portuguese = video('iiiiiiiiiii', { title: 'Valle de la Luna', views: 90000, lang: 'pt-BR' });
  const british = video('jjjjjjjjjjj', { title: 'Valle de la Luna', views: 20000, lang: 'en-GB' });
  assert.equal(chooseVideo([portuguese], { words, now: NOW }), null);
  assert.equal(chooseVideo([portuguese, british], { words, now: NOW }).id, 'jjjjjjjjjjj');
});

test('a video search that found nothing rests for a week', () => {
  const misses = { 'Dove Lake Circuit walk': '2026-09-16' };
  assert.equal(rested(misses, 'Dove Lake Circuit walk', '2026-09-17'), true);
  assert.equal(rested(misses, 'Dove Lake Circuit walk', '2026-09-23'), false);
  assert.equal(rested(misses, 'Cradle Mountain Dove Lake', '2026-09-17'), false);
  assert.equal(rested(undefined, 'anything', '2026-09-17'), false);
});

test('a video found by web search is known by its ID, whatever link it came as', () => {
  assert.equal(videoIdOf('https://www.youtube.com/watch?v=sVYmfQRID4Q'), 'sVYmfQRID4Q');
  assert.equal(videoIdOf('https://www.youtube.com/watch?list=PL1&v=657W6Kg5Hks&t=30'), '657W6Kg5Hks');
  assert.equal(videoIdOf('https://youtu.be/8J0hEgI8q-8?si=abc'), '8J0hEgI8q-8');
  assert.equal(videoIdOf('https://www.youtube.com/shorts/pv3RFpx_QJk'), 'pv3RFpx_QJk');
  assert.equal(videoIdOf('sVYmfQRID4Q'), 'sVYmfQRID4Q');
  assert.equal(videoIdOf('https://www.youtube.com/@somechannel'), null);
  assert.equal(videoIdOf(''), null);
});

test('leads are dropped once the spot they were for has its video', () => {
  const doc = {
    place: 'Atacama', videoQuery: 'Atacama desert travel', video: { id: 'aaaaaaaaaaa' },
    blocks: [
      { type: 'video', query: 'Valle de la Luna Atacama', video: { id: 'bbbbbbbbbbb' } },
      { type: 'video', query: 'Geysers del Tatio drive' },
    ],
    videoLeads: { 'Valle de la Luna Atacama': ['x'], 'Geysers del Tatio drive': ['y'], 'Atacama desert travel': ['z'] },
  };
  pruneLeads(doc);
  assert.deepEqual(doc.videoLeads, { 'Geysers del Tatio drive': ['y'] });
  doc.blocks[1].video = { id: 'ccccccccccc' };
  pruneLeads(doc);
  assert.equal('videoLeads' in doc, false);
});
