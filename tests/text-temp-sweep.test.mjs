// S69-40: 글자 읽기 임시 사본이 도중에 끊겨 남으면 다음 글자 읽기 때 15분 지난 표식 사본만 휴지통으로(영구 삭제 아님). 값은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepQuery, sweepTextTemps, TEXT_TEMP_KEY } from '../supabase/functions/_shared/text-temp-sweep.mjs';

test('질의: 이 앱 표식 + 휴지통 아님 + 15분 전에 만든 것만', () => {
  const q = sweepQuery(Date.parse('2026-11-24T05:00:00Z'));
  assert.equal(q, "appProperties has { key='web2_text_tmp' and value='1' } and trashed = false and createdTime < '2026-11-24T04:45:00Z'");
});

test('표식 사본만 휴지통(PATCH trashed), DELETE 없음, 실패해도 throw 없음', async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url), m = init.method || 'GET';
    calls.push([m, u.pathname, init.body || '']);
    if (m === 'GET') return Response.json({ files: [{ id: 'tempCopy0000001', appProperties: { [TEXT_TEMP_KEY]: '1' } }, { id: 'userFile0000001', appProperties: {} }, { id: 'bad id' }] });
    return Response.json({ id: 'x' });
  };
  assert.equal(await sweepTextTemps({ fetch, token: 't', now: () => 0 }), 1);
  assert.deepEqual(calls.slice(1), [['PATCH', '/drive/v3/files/tempCopy0000001', JSON.stringify({ trashed: true })]]);
  assert.ok(!calls.some(c => c[0] === 'DELETE'));
  assert.equal(await sweepTextTemps({ fetch: async () => { throw new Error('down'); }, token: 't' }), 0);
  assert.equal(await sweepTextTemps({ fetch, token: '' }), 0);
});
