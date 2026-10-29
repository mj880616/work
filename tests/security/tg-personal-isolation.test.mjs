// TG-개인대화: 개인 텔레그램 요약 표(app_tg_personal_days)는 허용된 파일 밖에서 이름이 나오면 안 된다.
// 원장 자동 기록·주간보고·업무일지·바구니 AI·전체 검색이 읽는 길에 개인 요약이 들어가지 않게 하는 고정 장치(docs/design/tg-personal.md 4절).
// 뒤 PR(서버 collector-feed, 화면 tg-personal-data.js)이 허용 목록에 한 줄씩 더한다. 이번 PR에는 이 표를 부르는 코드가 없다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
const root=new URL('../../',import.meta.url).pathname;
const ALLOWED=new Set([
 'supabase/migrations/20261025030000_tg_personal_days.sql',
 'docs/20261025030000_tg_personal_days.precheck.sql','docs/20261025030000_tg_personal_days.snapshot.sql',
 'docs/20261025030000_tg_personal_days.postcheck.sql','docs/20261025030000_tg_personal_days.rollback.sql','docs/20261025030000_tg_personal_days.summary.md',
 'docs/migration-history.md','docs/design/tg-personal.md',
 'docs/design/multi-user-audit.md', // 설계 문서(표 이름만 나열, 읽는 코드 아님) — #1451
 // MULTI 단계 ① 운영자 전용 잠금 시험: 이 표를 전제하지 않음을 확인하는 줄만(migration·짝 파일은 이 표를 부르지 않음 — 운영에 없음)
 'tests/auth-handoff/operator-features.test.mjs',
 // Web2에 물어보기(FEAT-1029묶음 ①): 이 표를 읽지 않음을 확인하는 확인 SQL·시험만(읽는 코드 아님).
 'docs/20261029061500_ask_web2.postcheck.sql','tests/auth-handoff/ask-web2-db.test.mjs','tests/auth-handoff/ask-web2-fixture.mjs',
 'tests/security/ai-assist-ask-web2.test.mjs',
 'tests/auth-handoff/tg-personal-days.test.mjs','tests/auth-handoff/package.json','tests/security/tg-personal-isolation.test.mjs',
]);
const SKIP=new Set(['.git','node_modules','.claude']);
function walk(dir,out=[]){
 for(const n of readdirSync(dir)){
  if(SKIP.has(n))continue;
  const p=join(dir,n),s=statSync(p);
  if(s.isDirectory())walk(p,out);else if(s.size<2_000_000&&/\.(sql|md|mjs|js|ts|json|html|yml|yaml|gs)$/.test(n))out.push(p);
 }
 return out;
}
test('app_tg_personal_days is named only in the allowed files',()=>{
 const hits=walk(root).map(p=>relative(root,p)).filter(f=>!ALLOWED.has(f)&&/app_tg_personal/.test(readFileSync(join(root,f),'utf8')));
 assert.deepEqual(hits,[],`개인 요약 표를 부르는 허용되지 않은 파일: ${hits.join(', ')}`);
});
