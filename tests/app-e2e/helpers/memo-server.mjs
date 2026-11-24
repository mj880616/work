// S69-94 NOTE-메모통일: 화면 시험용 메모 표(app_memos) 흉내. 읽기(작업공간 조건)·남기기·고치기(글만)·지우기를 메모리에서 한다.
// 원문 있는지 읽기(app_news_articles·app_outside_articles·app_reading_items·app_documents·app_meetings·app_suborganization_updates·app_feed_items
// ?id=in.(…) 또는 ?id=eq.…, select=id)는 gone에 든 id만 빼고 있다고 답한다.
// missing: true면 새 표가 아직 없는 운영(404 PGRST205)처럼 답한다. 나중에 등록한 길이 이기므로 각 시험의 흉내 서버 뒤에 부른다.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
export async function routeMemos(page, { memos = [], gone = [], missing = false } = {}) {
  const s = { memos: structuredClone(memos), posts: [], patches: [], deletes: [], reads: [], checks: [] };
  let n = 0;
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_memos', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method();
    if (missing) return r.fulfill({ status: 404, json: { code: 'PGRST205', message: 'Could not find the table public.app_memos' } });
    const id = (q.get('id') || '').replace(/^eq\./, '');
    if (method === 'GET') { s.reads.push(req.url()); return r.fulfill({ json: structuredClone(s.memos).sort((a, b) => b.created_at.localeCompare(a.created_at)) }); }
    if (method === 'POST') {
      const body = req.postDataJSON(); s.posts.push(body);
      const at = new Date(Date.parse('2026-11-25T01:00:00Z') + (++n) * 60000).toISOString();
      const row = { id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`, quote: null, kind: null, target_title: null, ...body, created_at: at, updated_at: at };
      s.memos.push(row); return r.fulfill({ status: 201, json: [row] });
    }
    if (method === 'PATCH') { const body = req.postDataJSON(); s.patches.push({ id, body }); const row = s.memos.find(m => m.id === id); if (!row) return r.fulfill({ json: [] }); Object.assign(row, body); return r.fulfill({ json: [row] }); }
    if (method === 'DELETE') { s.deletes.push(id); const i = s.memos.findIndex(m => m.id === id); const out = i >= 0 ? s.memos.splice(i, 1) : []; return r.fulfill({ json: out.map(m => ({ id: m.id })) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  // S69-95: 자료실 자료·사업 보고·담당조직 기록·텔레그램 소식 표도 같은 '있나' 읽기(?id=in.(…) 또는 ?id=eq.… &select=id)를 받는다.
  const CHECK = ['/rest/v1/app_news_articles', '/rest/v1/app_outside_articles', '/rest/v1/app_reading_items', '/rest/v1/app_documents', '/rest/v1/app_meetings', '/rest/v1/app_suborganization_updates', '/rest/v1/app_feed_items'];
  await page.route(u => u.origin === SB && CHECK.includes(u.pathname) && u.searchParams.get('select') === 'id', r => {
    s.checks.push(r.request().url());
    const ids = (new URL(r.request().url()).searchParams.get('id') || '').replace(/^in\.\(|\)$/g, '').replace(/^eq\./, '').split(',').filter(Boolean);
    return r.fulfill({ json: ids.filter(id => !gone.includes(id)).map(id => ({ id })) });
  });
  return s;
}
