// news-feed 예약 호출 스크립트(scripts/ops/news-feed.mjs): 전체 실행과 매시 '채우기만' 실행의 단계. 가짜 fetch만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runNewsFeed } from '../scripts/ops/news-feed.mjs';

function fake() {
  const steps = [];
  const fetcher = async (url, init) => {
    const action = new URL(url).searchParams.get('action');
    const body = JSON.parse(init.body);
    if (action === 'run_plan') return new Response(JSON.stringify({ ok: true, media: ['news-fake-a'] }), { status: 200 });
    steps.push(body.source ?? body.step);
    return new Response(JSON.stringify({ ok: true, status: 'ok', done: 1 }), { status: 200 });
  };
  return { steps, fetcher };
}

test('전체 실행: 매체 → 키워드 → 대기 기사 → 제목 → 정리', async () => {
  const f = fake();
  await runNewsFeed({ secret: 's', fetcher: f.fetcher, sleep: async () => {} });
  assert.deepEqual(f.steps, ['news-fake-a', 'keywords', 'pending', 'titles', 'prune']);
});

test('채우기만(mode fill): 대기 기사·제목만, 매체·키워드 요청 없음', async () => {
  const f = fake();
  const t = await runNewsFeed({ secret: 's', fetcher: f.fetcher, sleep: async () => {}, mode: 'fill' });
  assert.deepEqual(f.steps, ['pending', 'titles']);
  assert.equal(t.results.length, 2);
});
