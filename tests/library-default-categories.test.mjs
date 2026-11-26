import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {saveWeeklyReport,ensureWeeklyPersonalCategory} from '../app/hwp-drive.js';
import {DEFAULT_DOCUMENT_CATEGORIES,WEEKLY_PERSONAL_CATEGORY,categoryOf,resetDocumentCategories} from '../app/document-categories.js';
// LIB-기본분류흔적빼기(사용자 11/17): 주간보고 팀·개인 확정본은 기본 분류로 주지 않는다. 기본은 7개 그대로(화면·서버 AI·DB 칸 기본값 같음).
// 주간보고를 처음 [확정] 저장하는 사람에게만 그때 '주간보고'·'주간보고›개인 확정본'을 기존 분류 추가 함수로 만든다. 이미 쓰는 사람의 목록·자료는 그대로.

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const SEVEN=['교섭','투쟁','교육','선전','정책','회의','기타'];
const fakeRt=({categories=SEVEN,addOk=true,readFails=false}={})=>{
  const calls=[];let list=[...categories];
  const rt={config:{url:'https://x.test',key:'k'},session:{ensure:async()=>true,read:()=>({access_token:'t'})},
    context:{read:()=>({user:{id:'u1'},workspace:{id:'w1'}})},
    api:async(path,init={})=>{calls.push({path,method:init.method||'GET',body:init.body});
      if(path.startsWith('/rest/v1/app_profiles')){if(readFails)throw Object.assign(new Error('x'),{status:500});return [{document_categories:list}];}
      if(path==='/rest/v1/rpc/app_document_category_add'){if(!addOk)return {ok:false,error:'INVALID_NAME'};list=[...list.slice(0,-1),init.body.p_name,'기타'];return {ok:true,categories:list,documents:0};}
      if(path==='/rest/v1/rpc/app_document_read_text')return {ok:true};
      return {};}};
  return {rt,calls,adds:()=>calls.filter(c=>c.path==='/rest/v1/rpc/app_document_category_add').map(c=>c.body.p_name)};
};
const okFetch=box=>async(url,init)=>{box.form=init.body;return {ok:true,status:200,json:async()=>({ok:true,document:{id:'doc-1',title:'주간보고'}})};};
const save=(rt,box)=>saveWeeklyReport(new Uint8Array([1,2]),{fileName:'주간보고.hwpx',title:'주간보고',documentDate:'2026-11-17'},{rt,fetcher:okFetch(box)});

test('기본 분류 7개에 주간보고 확정본 계열이 없다(화면·서버 AI·DB 칸 기본값)',()=>{
  assert.deepEqual([...DEFAULT_DOCUMENT_CATEGORIES],SEVEN);
  assert.ok(!DEFAULT_DOCUMENT_CATEGORIES.some(n=>n.includes('주간보고')||n.includes('확정본')));
  assert.match(read('../supabase/functions/ai-assist/library-fill.ts'),/DEFAULT_CATEGORIES = Object\.freeze\(\["교섭", "투쟁", "교육", "선전", "정책", "회의", "기타"\]\)/);
  assert.match(read('../supabase/migrations/20261018112943_doc_categories_profile.sql'),/array\['교섭', '투쟁', '교육', '선전', '정책', '회의', '기타'\]/);
  assert.equal(WEEKLY_PERSONAL_CATEGORY,'주간보고›개인 확정본');
});

test('새 사람(기본 7개): 처음 확정 저장 때 주간보고·개인 확정본을 만들고 그 분류로 저장한다',async()=>{
  resetDocumentCategories();
  const {rt,adds}=fakeRt(),box={};
  const out=await save(rt,box);
  assert.equal(out.kind,'created');
  assert.deepEqual(adds(),['주간보고','주간보고›개인 확정본']);
  assert.equal(box.form.get('category'),'주간보고›개인 확정본');
  assert.equal(categoryOf('주간보고›개인 확정본'),'주간보고›개인 확정본');
  assert.match(out.message,/주간보고 › 개인 확정본/);
  resetDocumentCategories();
});

test('이미 쓰는 사람: 목록에 있으면(옛 이름·바꾼 이름 포함) 더하지 않고 그 이름으로 저장한다',async()=>{
  for(const [list,want] of [
    [['주간보고','주간보고›팀 확정본','주간보고›개인 확정본','기타'],'주간보고›개인 확정본'],
    [['주간보고','주간보고›확정본','주간보고›개인본','기타'],'주간보고›개인본'],
    [['주간보고 개인본','기타'],'주간보고 개인본'],
  ]){
    resetDocumentCategories();
    const {rt,adds}=fakeRt({categories:list}),box={};
    await save(rt,box);
    assert.deepEqual(adds(),[],list.join(','));
    assert.equal(box.form.get('category'),want);
  }
  resetDocumentCategories();
});

test('큰 분류 주간보고만 있으면 소분류만 더한다',async()=>{
  resetDocumentCategories();
  const {rt,adds}=fakeRt({categories:['교섭','주간보고','기타']});
  assert.equal(await ensureWeeklyPersonalCategory({rt}),true);
  assert.deepEqual(adds(),['주간보고›개인 확정본']);
  resetDocumentCategories();
});

test('목록을 못 읽거나·30개가 찼거나·추가가 실패해도 저장은 한 번 그대로(옛 이름 값)',async()=>{
  const full=[...Array.from({length:29},(_,i)=>'분류'+i),'기타'];
  for(const opts of [{readFails:true},{categories:full},{addOk:false}]){
    resetDocumentCategories();
    const {rt,calls}=fakeRt(opts),box={};
    const out=await save(rt,box);
    assert.equal(out.kind,'created');
    assert.equal(box.form.get('category'),'주간보고 개인본');
    if(opts.categories)assert.equal(calls.filter(c=>c.path.includes('category_add')).length,0);
  }
  resetDocumentCategories();
});
