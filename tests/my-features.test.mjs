import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectsFeeds} from '../app/my-features.js';
// MULTI-처음쓰는사람 ⑤: '수집·사용량' 칸·수집 알림 칩은 서버 운영자 기능 답에 calls·telegram이 있을 때만(답을 못 받으면 지금처럼 그린다).
test('수집 계정: calls·telegram 중 하나라도 있거나 답이 없으면 그렇다', () => {
  assert.equal(collectsFeeds(null), true);
  assert.equal(collectsFeeds(undefined), true);
  assert.equal(collectsFeeds(['calls']), true);
  assert.equal(collectsFeeds(['telegram', 'files']), true);
  assert.equal(collectsFeeds([]), false);
  assert.equal(collectsFeeds(['files', 'gdrive_photos', 'arsenal', 'outside']), false);
});
