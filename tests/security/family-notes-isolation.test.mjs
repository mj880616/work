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
 assert.deepEqual(hits,[],`이번 단계에는 앱·Edge가 이 표를 부르지 않는다: ${hits.join(', ')}`);
});
