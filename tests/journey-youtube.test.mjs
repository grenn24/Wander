import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, chooseVideo, videoQueryFor, videoQueries, videoWords } from '../scripts/journeys/youtube.mjs';

test('a video must name the journey’s places, not just its country', () => {
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
const video = (id, { title = 'Escalante road trip', seconds = 900, views = 50000, published = '2025-05-01T00:00:00Z', embeddable = true, privacy = 'public' } = {}) => ({
  id,
  snippet: { title, description: '', publishedAt: published, channelTitle: 'Desert Channel', channelId: 'UC123' },
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

test('a journey without a video query still has something to search for', () => {
  assert.equal(videoQueryFor({ place: 'Kyoto & Nara' }), 'Kyoto & Nara travel');
  assert.equal(videoQueryFor({ place: 'X', videoQuery: 'Otaru winter walk' }), 'Otaru winter walk');
});

test('a long place line is searched again by its first name', () => {
  const place = 'Escalante, Cedar Mesa & Utah’s quiet canyon country';
  assert.deepEqual(videoQueries({ place, videoQuery: `${place} travel` }), [`${place} travel`, 'Escalante travel']);
  assert.deepEqual(videoQueries({ place: 'Kyoto', videoQuery: 'Kyoto travel' }), ['Kyoto travel']);
});
