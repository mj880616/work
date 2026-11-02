import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// S48-18 저녁 '새 성명 n건' 알림 줄(app/notice-outside-model.mjs·notice-outside.js).
const m=await import('../app/notice-outside-model.mjs');

test('evening window: Seoul 18:10 until midnight',()=>{
  assert.equal(m.eveningOpen(Date.parse('2026-10-06T09:09:59Z')),false,'18:09 서울');
  assert.equal(m.eveningOpen(Date.parse('2026-10-06T09:10:00Z')),true,'18:10 서울');
  assert.equal(m.eveningOpen(Date.parse('2026-10-06T14:59:00Z')),true,'23:59 서울');
  assert.equal(m.eveningOpen(Date.parse('2026-10-06T15:00:00Z')),false,'00:00 서울');
});

test('text: count, capped at 99+, nothing for zero',()=>{
  assert.equal(m.outsideNoticeText(3),'새 성명 3건');
  assert.equal(m.outsideNoticeText(100),'새 성명 99건+');
  assert.equal(m.outsideNoticeText(0),'');
  assert.equal(m.outsideNoticeText('x'),'');
});

test('notice line: owner RLS reads only, no Edge call, started from the loader without waiting',()=>{
  const src=readFileSync(new URL('../app/notice-outside.js',import.meta.url),'utf8');
  assert.match(src,/app_outside_seen\?workspace_id=eq\./);assert.match(src,/app_outside_posts\?workspace_id=eq\./);
  assert.doesNotMatch(src,/functions\/v1\//,'no Edge call (phone-push is a later step)');
  const loader=readFileSync(new URL('../app/loader-v2.js',import.meta.url),'utf8');
  assert.match(loader,/import\('\.\/notice-outside\.js'\)\.then\(m=>m\.startOutsideNotice\(\)\)/);
});
