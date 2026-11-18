// DOMAIN-nojoplus 1단계: 짧은 공유 주소는 화면이 열린 주소(bokdoong.com 또는 nojoplus.com)를 따르고, 그 밖은 bokdoong.com.
import assert from 'node:assert/strict';
import test from 'node:test';
import { SHORT_BASE, shortBase, shortUrl } from '../../app/share-html-model.mjs';

test('short share links follow the Web2 address they were made on', () => {
  assert.equal(SHORT_BASE, 'https://bokdoong.com/s/');
  assert.equal(shortBase('https://nojoplus.com'), 'https://nojoplus.com/s/');
  assert.equal(shortBase('https://bokdoong.com'), 'https://bokdoong.com/s/');
  assert.equal(shortUrl('meeting-notes', 'abcdefgh', 'https://nojoplus.com'), 'https://nojoplus.com/s/meeting-notes-abcdefgh');
  assert.equal(shortUrl('meeting-notes', 'abcdefgh', 'https://bokdoong.com'), 'https://bokdoong.com/s/meeting-notes-abcdefgh');
});

test('any other or missing origin keeps bokdoong.com (old hosts, github.io, lookalikes)', () => {
  for (const origin of [undefined, 'null', 'https://desk.bokdoong.com', 'https://mj880616.github.io', 'https://www.nojoplus.com',
    'http://nojoplus.com', 'https://nojoplus.com.evil.example', 'https://nojoplus.com:8443']) {
    assert.equal(shortBase(origin), SHORT_BASE, String(origin));
  }
  assert.equal(shortUrl('meeting-notes', 'abcdefgh'), 'https://bokdoong.com/s/meeting-notes-abcdefgh');
});
