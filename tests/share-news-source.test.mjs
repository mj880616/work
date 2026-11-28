// S62-22 APP-공유로뉴스보관: 공유 'News 보관' 화면 길의 소스 경계.
// - 서버로 보내는 것은 news-feed ?action=save_url의 주소 하나 + 공유 창 제목 한 줄(S67-10)뿐(작업공간·출처·다른 칸 없음). 다른 서버 주소·기기 저장·밖으로 보내는 길 없음.
// - 주소 없는 글은 누를 때만 정리함 길(put). 알림 글자는 요청 원문 그대로.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NEWS_NOTE, saveFailNote} from '../app/share-news-words.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('share-news: only the save_url address goes to the server, no device storage, no outward path', () => {
  const src = read('../app/share-news.js');
  assert.deepEqual([...src.matchAll(/\/functions\/v1\/[a-z-]+\?action=[a-z_]+/g)].map(m => m[0]), ['/functions/v1/news-feed?action=save_url']);
  assert.match(src, /body: title \? \{url, title\} : \{url\}/);
  assert.doesNotMatch(src, /\/rest\/v1\/|navigator\.share|share:send|workspace_id|origin:/);
  for (const word of ['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'cach' + 'es.']) assert.equal(src.includes(word), false, word);
  const basket = read('../app/basket-share.js');
  // S63-03 NEWS-운영자만: 'outside' 키가 있거나 답을 모를 때만 News 보관, 키가 없으면 정리함 길(target basket).
  assert.match(basket, /if \(list\.target === 'news'\) \{[\s\S]*?myFeaturesOrNull[\s\S]*?if \(!Array\.isArray\(features\) \|\| features\.includes\('outside'\)\) \{ await openNews\(list, picked\); return; \}\s*list = \{\.\.\.list, target:'basket'\};/);
  assert.match(basket, /import\('\.\/share-news\.js'\)/);
  assert.match(basket, /label:NEWS_NOTE\.toNote, run:\(\{close\}\) => \{ close\(\); if \(share === one\) void put\(\); \}/);
});

test('share-news words follow the request text; refusals have no retry', () => {
  assert.equal(NEWS_NOTE.done, '저장한 글에 넣었어요');
  assert.equal(NEWS_NOTE.busy, '저장한 글에 넣는 중…');
  assert.equal(NEWS_NOTE.fail, '저장한 글에 넣지 못했어요');
  assert.equal(NEWS_NOTE.open, '열기');
  assert.equal(NEWS_NOTE.noBody, '본문을 못 가져왔어요(원문 링크로 보기)');
  assert.equal(NEWS_NOTE.noUrl, '기사 주소가 없어요');
  assert.equal(NEWS_NOTE.toNote, '노트로 넣기'); // SHARE-노트로
  assert.equal(saveFailNote(400), NEWS_NOTE.refused);
  assert.equal(saveFailNote(429), NEWS_NOTE.limit);
  assert.equal(saveFailNote(409), NEWS_NOTE.unavailable);
  assert.equal(saveFailNote(503), '');
  assert.equal(saveFailNote(0), '');
});

test('phone app: fourth share entry is an activity-alias with the same receive path and no new permission', () => {
  const xml = read('../android-app/app/src/main/AndroidManifest.xml');
  const alias = xml.match(/<activity-alias\s+android:name="\.ShareToNews"[\s\S]*?<\/activity-alias>/)?.[0] || '';
  assert.match(alias, /android:targetActivity="\.MainActivity"/);
  assert.match(alias, /android:label="WORK ON\+ 저장"/);
  assert.match(alias, /android\.intent\.action\.SEND"/);
  assert.doesNotMatch(alias, /android:permission=|uses-permission/);
  const rules = read('../android-app/app/src/main/java/kr/or/kptu/work/ShellRules.kt');
  assert.match(rules, /SHARE_TO_NEWS -> "news"/);
  assert.match(rules, /setOf\("basket", "note", "task", "news", "reading"\)/);
});
