// FAMILY-잊지말기: 가족 1명 '잊지 말기' 표(app_family_notes)는 허용된 파일 밖에서 이름이 나오면 안 된다.
// 원장 자동 기록·주간보고·업무일지·정리함 AI·전체 검색·업무 소식이 읽는 길에 이 표가 들어가지 않게 하는 고정 장치(docs/design/tg-personal.md 7절).
// 뒤 PR(서버 collector-feed 넣기, phone-push 알림, 화면 family-notes-data.js)이 허용 목록에 한 줄씩 더한다. 이번 DB PR에는 이 표를 부르는 앱·Edge 코드가 없다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
const root=new URL('../../',import.meta.url).pathname;
const ALLOWED=new Set([
 'supabase/migrations/20261105100000_family_notes.sql',
 'docs/20261105100000_family_notes.precheck.sql','docs/20261105100000_family_notes.snapshot.sql',
 'docs/20261105100000_family_notes.postcheck.sql','docs/20261105100000_family_notes.rollback.sql','docs/20261105100000_family_notes.summary.md',
 'docs/migration-history.md','docs/design/tg-personal.md',
 'tests/auth-handoff/family-notes-db.test.mjs','tests/security/family-notes-isolation.test.mjs',
 // 3단계(수집·서버): collector-feed가 뽑은 줄을 넣고(칸별 grant), 중복·최근 줄·가족 방 거름을 위해 읽는다. 시험 하나.
 'supabase/functions/collector-feed/handler.ts','tests/security/collector-feed-family.test.mjs',
 // 4단계(화면·폰 알림): phone-push는 새 제안 수·시각만 읽고(내용 칸 없음), 화면은 데이터 모듈 하나만 부른다.
 'supabase/functions/phone-push/handler.ts','app/family-notes-data.js','tests/app-e2e/home-family.spec.mjs',
 // S51-26 FAMILY-노트로: 옛 [기억만] 줄을 노트로 한 번 옮기는 운영 SQL(커맨드센터가 실행, 건수만 출력).
 'docs/ops/family-kept-to-note.sql',
]);
const SKIP=new Set(['.git','node_modules','.claude']);
function walk(dir,out=[]){
 for(const n of readdirSync(dir)){
  if(SKIP.has(n))continue;
  const p=join(dir,n),s=statSync(p);
  if(s.isDirectory())walk(p,out);else if(s.size<2_000_000&&/\.(sql|md|mjs|js|ts|json|html|yml|yaml|gs|css)$/.test(n))out.push(p);
 }
 return out;
}
test('app_family_notes is named only in the allowed files',()=>{
 const hits=walk(root).map(p=>relative(root,p)).filter(f=>!ALLOWED.has(f)&&/app_family_notes/.test(readFileSync(join(root,f),'utf8')));
 assert.deepEqual(hits,[],`잊지 말기 표를 부르는 허용되지 않은 파일: ${hits.join(', ')}`);
});
test('no work-side reader names the table (ai-assist, weekly, journal, search, feed screens)',()=>{
 const readers=walk(join(root,'supabase/functions')).concat(walk(join(root,'app'))).map(p=>relative(root,p));
 const hits=readers.filter(f=>/app_family_notes|app_family_feature_guard/.test(readFileSync(join(root,f),'utf8')));
 // Edge에서는 collector-feed handler 하나만(넣기·중복 확인). 원장·주간보고·업무일지·정리함 AI(ai-assist)·검색은 이 표를 부르지 않는다.
 // 화면은 family-notes-data.js 하나, phone-push는 알림 건수 세기만.
 assert.deepEqual(hits.sort(),['app/family-notes-data.js','supabase/functions/collector-feed/handler.ts','supabase/functions/phone-push/handler.ts'],`이 표를 부르는 앱·Edge 파일: ${hits.join(', ')}`);
});
test('잊지 말기 화면 모듈은 홈 하나에서만 부르고, 업무 화면(원장·주간보고·검색·정리함·업무 소식)은 부르지 않는다',()=>{
 const app=walk(join(root,'app')).map(p=>relative(root,p));
 const users=app.filter(f=>/\.m?js$/.test(f)&&/family-notes-data|home-family|family-notes-model/.test(readFileSync(join(root,f),'utf8'))).sort();
 assert.deepEqual(users,['app/family-notes-data.js','app/family-notes-model.mjs','app/home-family.js','app/journal.js'],users.join(', '));
 const journal=readFileSync(join(root,'app/journal.js'),'utf8');
 assert.equal([...journal.matchAll(/home-family/g)].length>=1,true);
 assert.doesNotMatch(journal,/family-notes-data|family-notes-model/,'업무일지 본체는 잊지 말기 자료를 직접 읽지 않는다(칸 모듈만 불러 둠)');
});
