// S61-52·S62-01 (CALL-상대표시정리 ④ 같은 종류 전수): 모든 조직 고르기 창의 맨 아래 [직접 쓰기].
// 지킬 것: 비슷한 이름을 먼저 보여 준다(중복 방지) / 만들기는 담당조직 추가와 같은 서버 경로 한 곳 / 새 저장소(브라우저 저장) 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

function fakeRuntime(calls) {
  return {
    context:{read:() => ({workspace:{id:'ws-1'}, user:{id:'u-1'}})},
    api:async (path, opts = {}) => {
      calls.push({path, method:opts.method || 'GET', body:opts.body});
      if (path.startsWith('/rest/v1/app_suborganizations?') && opts.method === 'POST') return [{id:'new-1', name:opts.body.name, aliases:[], active:true}];
      if (path.startsWith('/rest/v1/app_suborganization_assignees?')) return [{organization_id:'a'}];
      return [];
    },
  };
}

test('[직접 쓰기] 칸: 비슷한 조직 줄이 먼저 나오고, 그 줄은 부르는 창과 같은 값으로 눌린다', async () => {
  const {orgWriteIn, orgWriteInHtml} = await import('../app/area-org-picker.js');
  assert.equal(orgWriteIn(null), null);
  assert.equal(orgWriteInHtml(null), '');
  const k = orgWriteIn({make:async () => ({}), similar:() => []});
  assert.match(orgWriteInHtml(k), /data-aop-create-input[^>]*placeholder="직접 쓰기 — 조직 이름"/);
  assert.doesNotMatch(orgWriteInHtml(k), /data-aop-create-force/, '비슷한 조직이 없으면 [새로 만들기] 버튼을 따로 내지 않는다');
  k.text = '철도'; k.similar = [{key:'o:1', name:'철도노조'}];
  const html = orgWriteInHtml(k, key => key === 'o:1');
  assert.ok(html.indexOf('비슷한 조직이 있어요') < html.indexOf('data-aop-create-force'), '비슷한 조직 안내가 [새로 만들기]보다 먼저');
  assert.match(html, /<button data-aop-similar [^>]*data-sheet-value="o:1" aria-pressed="true"/);
  assert.match(html, /'철도' 새로 만들기/);
  k.busy = true;
  assert.match(orgWriteInHtml(k), /data-aop-create-input[^>]*disabled/, '만드는 중에는 칸·버튼을 막는다');
});

test('orgWriteInFor: 비슷한 이름은 활동 중인 조직 전체에서, 만들기는 담당조직 추가와 같은 표 한 곳', async () => {
  const calls = [];
  globalThis.window = {KPTURuntime:fakeRuntime(calls), dispatchEvent() {}};
  try {
    const {orgWriteInFor} = await import('../app/feed-link.js');
    const orgs = [{id:'a', name:'철도노조', active:true}, {id:'b', name:'철도 옛 지부', active:false}, {id:'c', name:'병원지부', active:true}];
    const mine = new Set(), made = [];
    const w = orgWriteInFor({orgs, mine, onOrg:org => made.push(org)});
    const like = w.similar('철도노조');
    assert.deepEqual(like.map(x => x.key), ['o:a'], '쉰 조직은 비슷한 이름 후보에서 뺀다');
    const row = await w.make('  새   조직 ');
    assert.deepEqual({key:row.key, name:row.name}, {key:'o:new-1', name:'새 조직'});
    assert.ok(orgs.some(o => o.id === 'new-1') && mine.has('new-1') && made[0]?.id === 'new-1', '새 조직은 그 창의 목록·내 담당에 더해진다');
    const post = calls.filter(c => c.method === 'POST');
    assert.deepEqual(post.map(c => c.path.split('?')[0]), ['/rest/v1/app_suborganizations', '/rest/v1/app_suborganization_assignees']);
    assert.equal(post[0].body.workspace_id, 'ws-1', '내 작업공간에만 만든다(작업공간 주인 RLS가 막는 같은 표)');
    const idOnly = orgWriteInFor({orgs:() => orgs, key:id => id});
    assert.equal(idOnly.similar('병원지부')[0]?.key, 'c', "'기록할 곳' 창은 조직 id 그대로가 값");
    await assert.rejects(() => w.make('   '), /조직 이름을 써 주세요/);
  } finally { delete globalThis.window; }
});

test('같은 종류 전수: 조직 고르기 창을 여는 곳이 모두 같은 부품·같은 만들기 경로를 쓴다', () => {
  const callers = {
    'app/feed-link.js':/orgWriteInFor\(\{orgs, mine\}\)/,                       // 통화·텔레그램 소식 연결
    'app/update-window.js':/bindPlaceWriteIn\(/,                                // 업데이트 '기록할 곳'
    'app/home-quick.js':/bindPlaceWriteIn\(/,                                   // 홈 입력칸 '기록할 곳'
    'app/report-places-sheet.js':/bindPlaceWriteIn\(/,                          // 사업 보고 [연결할 곳]
    'app/basket-manual-link.js':/orgWriteInFor\(/,                              // 잊지 말기 [연결하기](여러 개)
    'app/google-tasks.js':/create:\(\)=>[\s\S]{0,120}orgWriteInFor\(/,           // 할 일 조직 줄
    'app/suborganizations.js':/create:soWriteIn/,                               // 일정 관련 담당조직
    'app/library-upload.js':/orgWriteInFor\(/,                                  // 자료실 일괄 바꾸기
  };
  for (const [file, pattern] of Object.entries(callers)) assert.match(read(file), pattern, file);
  const places = read('app/update-places.js');
  assert.match(places, /orgWriteInFor\(\{orgs:[^}]*key:id => id\}\)/, "'기록할 곳' 창도 같은 만들기 경로");
  // 조직을 새로 만드는 곳은 feed-data.js createMyOrganization 한 곳뿐(중복 구현 없음).
  for (const file of [...Object.keys(callers), 'app/update-places.js', 'app/area-org-picker.js']) {
    const src = read(file);
    // google-tasks.js는 이 작업 전부터 쓰던 Google 할 일 화면 상태 보관이 있어(main 그대로) 브라우저 저장 검사에서 뺀다.
    if (file !== 'app/google-tasks.js') assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/, `${file}: 브라우저 저장 금지`);
    // suborganizations.js는 원래 [담당조직 추가] 화면 자체(같은 표)라 뺀다.
    if (!['app/feed-link.js', 'app/suborganizations.js'].includes(file)) assert.doesNotMatch(src, /app_suborganizations\?[^'"`]*['"`],\s*\{method:'POST'/, `${file}: 조직 만들기는 한 곳`);
  }
  const picker = read('app/area-org-picker.js');
  assert.match(picker, /export function bindOrgWriteIn/);
  assert.doesNotMatch(picker, /c\.multi\)return ''/, '여러 개 고르는 창에서도 [직접 쓰기]를 보인다');
});
