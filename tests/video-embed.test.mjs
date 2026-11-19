// NOTE-유튜브보기: 유튜브 링크에서 영상 ID·시작 초만 꺼내고, 재생·그림 주소는 그 값으로 새로 만드는지(video-embed.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {youtubeVideo, embedUrl, thumbUrl, startSeconds} from '../app/video-embed.mjs';

const ID = 'dQw4w9WgXcQ';

test('the usual YouTube addresses give the 11-letter id and the start time', () => {
  assert.deepEqual(youtubeVideo(`https://www.youtube.com/watch?v=${ID}`), {id: ID, start: 0});
  assert.deepEqual(youtubeVideo(`https://youtube.com/watch?v=${ID}&t=90`), {id: ID, start: 90});
  assert.deepEqual(youtubeVideo(`https://m.youtube.com/watch?feature=share&v=${ID}&t=1m30s`), {id: ID, start: 90});
  assert.deepEqual(youtubeVideo(`https://youtu.be/${ID}?t=42s`), {id: ID, start: 42});
  assert.deepEqual(youtubeVideo(`https://youtu.be/${ID}?si=abc`), {id: ID, start: 0});
  assert.deepEqual(youtubeVideo(`https://www.youtube.com/shorts/${ID}`), {id: ID, start: 0});
  assert.deepEqual(youtubeVideo(`http://www.youtube.com/embed/${ID}?start=5`), {id: ID, start: 5});
  assert.deepEqual(youtubeVideo(`https://www.youtube.com/live/${ID}`), {id: ID, start: 0});
});

test('anything else gives nothing (other sites, schemes, odd ids, look-alike hosts, ports, logins)', () => {
  for (const bad of [
    `javascript:alert(1)//youtu.be/${ID}`, `data:text/html,youtu.be/${ID}`, `ftp://youtu.be/${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`, `https://evil.example/watch?v=${ID}`, `https://evil.example/youtu.be/${ID}`,
    `https://notyoutube.com/watch?v=${ID}`, `https://www.youtube-nocookie.com/embed/${ID}`, `https://music.youtube.com/watch?v=${ID}`,
    `https://user@youtu.be/${ID}`, `https://youtu.be:8443/${ID}`,
    'https://www.youtube.com/watch?v=short', `https://www.youtube.com/watch?v=${ID}x`, 'https://www.youtube.com/watch?v=abc"def<g>h',
    `https://www.youtube.com/watch?v=${ID.slice(0, 10)}%22`, `https://youtu.be/${ID}/extra`, 'https://www.youtube.com/', 'https://www.youtube.com/channel/UC123',
    '', null, undefined, 42,
  ]) assert.equal(youtubeVideo(bad), null, String(bad));
});

test('the player and picture addresses are built from the id only', () => {
  assert.equal(embedUrl({id: ID, start: 0}), `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&playsinline=1&rel=0`);
  assert.equal(embedUrl({id: ID, start: 75}), `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&playsinline=1&rel=0&start=75`);
  assert.equal(thumbUrl({id: ID}), `https://i.ytimg.com/vi/${ID}/mqdefault.jpg`);
  assert.equal(embedUrl({id: 'x"><script>'}), '');
  assert.equal(thumbUrl({id: '../../a'}), '');
  assert.equal(embedUrl(null), '');
});

test('start times: seconds, 1h2m3s forms, nonsense → 0', () => {
  assert.equal(startSeconds('90'), 90);
  assert.equal(startSeconds('1h2m3s'), 3723);
  assert.equal(startSeconds('2m'), 120);
  assert.equal(startSeconds(''), 0);
  assert.equal(startSeconds('abc'), 0);
  assert.equal(startSeconds('-5'), 0);
  assert.equal(startSeconds('999999999'), 0);
});

test('the reader file keeps to syntax older Samsung Internet parses (the Web1 reader imports it through ed-render.mjs)', async () => {
  const {readFile} = await import('node:fs/promises');
  const src = await readFile(new URL('../app/video-embed.mjs', import.meta.url), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  for (const bad of ['?.', '??', 'replaceChildren', 'structuredClone', '.at(']) assert.equal(code.includes(bad), false, bad);
});
