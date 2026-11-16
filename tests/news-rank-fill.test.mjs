// S63-12 NEWS-언론등급정렬 ②(Edge news-feed): 옛 기사 등급·받은 날 채우기(fillRanks — prune 단계 앞).
// 네트워크 없음. Supabase는 지어낸 표(합성 기사)다. 규칙은 news-rank.ts 하나뿐이고 여기서는 그 결과가 빈 줄에만 적히는지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';

const H = await import('../supabase/functions/news-feed/handler.ts');
const NOW = Date.parse('2026-11-16T03:00:00Z'); // 서울 11/16 12:00
const WS = 'a0000000-0000-4000-8000-000000000001';
const id = n => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function fakeDb(articles) {
  const sends = [];
  const pick = (rows, q) => rows.filter(r => {
    for (const [k, v] of q) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      if (v === 'is.null' && r[k] !== null && r[k] !== undefined) return false;
      if (v === 'not.is.null' && (r[k] === null || r[k] === undefined)) return false;
      if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
      if (v.startsWith('gte.') && !(Date.parse(r[k]) >= Date.parse(v.slice(4)))) return false;
      if (v.startsWith('lt.') && !(Date.parse(r[k]) < Date.parse(v.slice(3)))) return false;
      if (v.startsWith('in.(') && !v.slice(4, -1).split(',').includes(String(r[k]))) return false;
    }
    return true;
  });
  const params = p => { const u = new URL('https://x.test/' + p); const out = []; for (const [k, v] of u.searchParams) out.push([k, v]); return {path: u.pathname.slice(1), q: out, u}; };
  return {
    sends,
    get: async p => {
      const {path, q, u} = params(p);
      if (path === 'app_outside_sources') return [{workspace_id: WS, source_key: 'news-khan'}];
      if (path === 'app_news_keywords') return [];
      if (path === 'app_now_interests') return [];
      if (path !== 'app_news_articles') throw new Error('unexpected ' + path);
      const rows = pick(articles, q.filter(([k]) => !['created_at'].includes(k) || true)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      const off = Number(u.searchParams.get('offset') ?? 0), lim = Number(u.searchParams.get('limit') ?? 1000);
      return rows.slice(off, off + lim);
    },
    send: async (m, p, b) => {
      sends.push({m, p, b});
      const {path, q} = params(p);
      assert.equal(path, 'app_news_articles');
      for (const r of pick(articles, q)) Object.assign(r, b);
      return [];
    },
    rpcValue: async (fn, b) => (fn === 'app_operator_feature_workspace' && b.p_feature === 'outside' ? WS : null),
    rpcNumber: async () => 0,
  };
}

test('fillRanks: empty Seoul days and ranks are filled once, by the shared rule, without touching filled or out-of-window rows', async () => {
  const art = (n, o) => ({id: id(n), origin: 'site', lane: 'media', source_key: 'news-khan', news_rank: null, kst_day: null, summary: null, ...o});
  const rows = [
    art(1, {title: '가상 지부 파업 돌입', url: 'https://www.khan.co.kr/article/1', created_at: '2026-11-15T16:30:00Z'}), // 서울 11/16, 노동 → 1
    art(2, {title: '가상 동네 소식', url: 'https://www.khan.co.kr/national/article/2', created_at: '2026-11-15T14:30:00Z'}), // 서울 11/15, 사회 → 2
    art(3, {title: '가상 공공기관 예산 논의', url: 'https://www.khan.co.kr/politics/article/3', created_at: '2026-11-14T03:00:00Z'}), // 정치 + 공공 → 3
    art(4, {title: '가상 특징주 상한가', url: 'https://www.khan.co.kr/economy/article/4', created_at: '2026-11-14T04:00:00Z'}), // 주식 → 빈 값 그대로
    art(5, {title: '가상 이미 등급', url: 'https://www.khan.co.kr/article/5', created_at: '2026-11-14T05:00:00Z', news_rank: 3, kst_day: '2026-11-14'}),
    art(6, {title: '가상 오래된 파업', url: 'https://www.khan.co.kr/article/6', created_at: '2026-09-01T05:00:00Z'}), // 30일 밖 → 손대지 않음
    {id: id(7), origin: 'tg_room', lane: 'channel', source_key: null, news_rank: null, kst_day: null, title: '가상 채널 글', url: 'https://x.test/7', created_at: '2026-11-16T01:00:00Z'},
  ];
  const db = fakeDb(rows);
  const out = await H.fillRanks(db, NOW, NOW, () => NOW, () => {});
  const by = n => rows.find(r => r.id === id(n));
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(n => by(n).kst_day), ['2026-11-16', '2026-11-15', '2026-11-14', '2026-11-14', '2026-11-14', null, '2026-11-16']);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(n => by(n).news_rank), [1, 2, 3, null, 3, null, null]);
  assert.deepEqual(out, {days: 3, ranked: 3, unranked: 1});
  // 고치는 요청은 늘 빈 줄 조건을 달고, 칸은 kst_day·news_rank 하나씩만(지우기·다른 칸 없음).
  for (const s of db.sends) {
    assert.equal(s.m, 'PATCH');
    assert.ok(/kst_day=is\.null|news_rank=is\.null/.test(s.p), s.p);
    assert.equal(Object.keys(s.b).length, 1);
    assert.ok(['kst_day', 'news_rank'].includes(Object.keys(s.b)[0]));
  }
  // 두 번째 부르면 바뀌는 것이 없다(빈 값으로 남는 주식 줄만 다시 본다).
  const again = await H.fillRanks(db, NOW, NOW, () => NOW, () => {});
  assert.deepEqual(again, {days: 0, ranked: 0, unranked: 1});
});

test('fillRanks stops at the time budget without writing', async () => {
  const rows = [{id: id(1), origin: 'site', lane: 'media', source_key: 'news-khan', news_rank: null, kst_day: null, title: '가상 파업', url: 'https://www.khan.co.kr/article/1', created_at: '2026-11-15T16:30:00Z'}];
  const db = fakeDb(rows);
  const out = await H.fillRanks(db, NOW, NOW, () => NOW + H.RANK_FILL_BUDGET_MS + 1, () => {});
  assert.deepEqual(out, {days: 0, ranked: 0, unranked: 0});
  assert.equal(db.sends.length, 0);
});
