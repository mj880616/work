import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pickUnionTemplate,pickConvertTemplate,findUnionTemplate,saveUnionForm,ensureUnionFormCategory,unionFormFileProblem,
  UNION_TEMPLATE_CATEGORY,UNION_TEMPLATE_OLD_CATEGORY,UNION_TEMPLATE_FILTER,isUnionTemplateCategory,
  UNION_TEMPLATE_NOJO_CATEGORY,templateCategoriesFor,templateSaveCategory} from '../app/hwp-drive.js';
import {FACES,wordIn} from '../app/brand/faces.mjs';
import {withWordBase} from '../app/brand/custom-words-model.mjs';
import {categoryOf,setDocumentCategories,resetDocumentCategories} from '../app/document-categories.js';
import {saveOwnForm} from '../app/weekly-own-form-store.js';
// HWP-노조서식분류(요청함 11/16 07:26): HWP 편집 노조 서식의 자료실 분류 이름은 '노조 서식'. 옛 이름 '양식'으로 등록된 자료도 계속 찾고(읽기만 두 이름),
// 새로 올릴 때는 '노조 서식'만 쓴다. 분류가 내 목록에 없으면 기존 분류 추가 함수로 한 번 더한다. 서버 저장만(기기 저장소 없음).

const row=(id,title,file_name=id+'.hwp',category=UNION_TEMPLATE_CATEGORY)=>({id,title,file_name,category});
const fakeRt=({categories=['교섭','투쟁','교육','선전','정책','회의','기타'],addOk=true,docs=[]}={})=>{
  const calls=[];
  const rt={config:{url:'https://x.test',key:'k'},session:{ensure:async()=>true,read:()=>({access_token:'t'})},
    context:{read:()=>({user:{id:'u1'},workspace:{id:'w1'}})},
    api:async(path,init={})=>{calls.push({path,method:init.method||'GET',body:init.body});
      if(path.startsWith('/rest/v1/app_profiles'))return [{document_categories:categories}];
      if(path==='/rest/v1/rpc/app_document_category_add')return addOk?{ok:true,categories:[...categories.slice(0,-1),init.body.p_name,'기타'],documents:0}:{ok:false,error:'INVALID_NAME'};
      if(path.startsWith('/rest/v1/app_documents'))return docs;
      throw new Error('unexpected '+path);}};
  return {rt,calls};
};

test('category name: new uploads use 노조 서식; reads accept both 노조 서식 and the old 양식',()=>{
  assert.equal(UNION_TEMPLATE_CATEGORY,'노조 서식');
  assert.equal(UNION_TEMPLATE_OLD_CATEGORY,'양식');
  assert.ok(isUnionTemplateCategory('노조 서식')&&isUnionTemplateCategory('양식')&&!isUnionTemplateCategory('기타'));
  assert.equal(decodeURIComponent(UNION_TEMPLATE_FILTER),'in.("노조 서식","양식")');
  const mixed=pickUnionTemplate([row('a','노조 문서 양식','a.hwp','양식'),row('b','노조 보고','b.hwp','노조 서식'),row('c','다른','c.hwp','회의')]);
  assert.equal(mixed.total,2);
  assert.deepEqual([mixed.chosen.id,...mixed.others.map(r=>r.id)].sort(),['a','b']);
  assert.equal(pickConvertTemplate([row('old','노조 공문 양식','공문.hwp','양식')],'letter').chosen.id,'old');
  assert.equal(pickConvertTemplate([row('new','노조 보고서','보고서.hwp','노조 서식')],'report').chosen.id,'new');
  assert.equal(pickUnionTemplate([row('x','노조','x.hwpx','노조 서식')]).total,0,'.hwpx is not a form for the editor engine');
});

test('the library query asks for both names in the signed-in workspace only',async()=>{
  const {rt,calls}=fakeRt({docs:[row('a','노조 양식','a.hwp','양식')]});
  const found=await findUnionTemplate({rt});
  assert.equal(found.total,1);
  const url=new URL('https://x.test'+calls[0].path);
  assert.equal(url.searchParams.get('workspace_id'),'eq.w1');
  assert.equal(url.searchParams.get('category'),'in.("노조 서식","양식")');
});

test('library tags: old 양식 rows show under 노조 서식 when that is in my list (stored value unchanged)',()=>{
  try{
    setDocumentCategories(['교섭','노조 서식','기타']);
    assert.equal(categoryOf('양식'),'노조 서식');
    assert.equal(categoryOf('노조 서식'),'노조 서식');
    setDocumentCategories(['교섭','양식','기타']);
    assert.equal(categoryOf('노조 서식'),'양식','a list that still has 양식 keeps one tag for both');
  }finally{resetDocumentCategories();}
});

test('upload: adds the 노조 서식 category once if missing, then one library-files request with category 노조 서식 and a title from the file name',async()=>{
  resetDocumentCategories();
  const {rt,calls}=fakeRt();
  let form,count=0;
  const fetcher=async(url,init)=>{count++;assert.equal(url,'https://x.test/functions/v1/library-files');form=init.body;return {ok:true,status:200,json:async()=>({ok:true,document:{id:'doc-1',title:'보고서 서식',file_name:'보고서 서식.hwp'}})};};
  const out=await saveUnionForm(new File([new Uint8Array([0xd0,0xcf,0x11,0xe0])],'보고서 서식.hwp'),{},{rt,fetcher});
  assert.equal(out.kind,'created');assert.equal(out.document.id,'doc-1');
  assert.equal(count,1);
  assert.deepEqual([...form.keys()].sort(),['category','file','title']);
  assert.equal(form.get('category'),'노조 서식');
  assert.equal(form.get('title'),'보고서 서식');
  assert.equal(form.get('file').name,'보고서 서식.hwp');
  assert.deepEqual(calls.filter(c=>c.path.includes('rpc')).map(c=>c.body),[{p_name:'노조 서식'}]);
  // 이미 목록에 있으면 더하지 않는다.
  const again=fakeRt({categories:['노조 서식','기타']});resetDocumentCategories();
  assert.equal(await ensureUnionFormCategory({rt:again.rt}),true);
  assert.equal(again.calls.filter(c=>c.path.includes('rpc')).length,0);
  resetDocumentCategories();
});

test('upload: a failed category add does not block the upload; a refused upload says nothing changed; an unknown outcome is not retried',async()=>{
  resetDocumentCategories();
  {const {rt}=fakeRt({addOk:false});let n=0;
   const out=await saveUnionForm(new File([new Uint8Array([1])],'a.hwp'),{},{rt,fetcher:async()=>{n++;return {ok:true,status:200,json:async()=>({ok:true,document:{id:'d2',title:'a'}})};}});
   assert.equal(out.kind,'created');assert.equal(n,1);}
  resetDocumentCategories();
  {const {rt}=fakeRt();
   const out=await saveUnionForm(new File([new Uint8Array([1])],'a.hwp'),{},{rt,fetcher:async()=>({ok:false,status:400,json:async()=>({error:'형식'})})});
   assert.equal(out.kind,'refused');assert.match(out.message,/아무것도 바뀌지 않았어요/);}
  resetDocumentCategories();
  {const {rt}=fakeRt();let n=0;
   const out=await saveUnionForm(new File([new Uint8Array([1])],'a.hwp'),{},{rt,fetcher:async()=>{n++;throw new Error('net');}});
   assert.equal(out.kind,'unknown');assert.equal(n,1);}
  resetDocumentCategories();
});

test('file check: the editor form takes .hwp only; the weekly original takes .hwp or .hwpx; 30MB cap',()=>{
  const f=(name,size=10)=>({name,size});
  assert.equal(unionFormFileProblem(f('a.hwp'),{hwpOnly:true}),'');
  assert.match(unionFormFileProblem(f('a.hwpx'),{hwpOnly:true}),/\.hwp\)/);
  assert.match(unionFormFileProblem(f('a.pdf'),{hwpOnly:true}),/한글\(\.hwp\)/);
  assert.equal(unionFormFileProblem(f('a.hwpx')),'');
  assert.match(unionFormFileProblem(f('a.hwp',0)),/빈 파일/);
  assert.match(unionFormFileProblem(f('a.hwp',31*1024*1024)),/30MB/);
});

test('weekly own form: the original file id is saved with the form; editing without a new file keeps it',async()=>{
  const sent=[];
  const rt={context:{read:()=>({workspace:{id:'w1'}})},api:async(path,init={})=>{sent.push({path,method:init.method,body:init.body});return [{id:'f1',name:'내 양식',source_name:'a.hwp',source_file_id:init.body?.source_file_id??null,form:init.body?.form??{v:1,sections:[]},updated_at:'t2'}];}};
  const form={v:1,sections:[]};
  const id='0b8f5a3e-1111-4222-8333-444455556666';
  await saveOwnForm({known:null,name:'내 양식',sourceName:'a.hwp',sourceFileId:id,form},rt);
  assert.equal(sent[0].method,'POST');assert.equal(sent[0].body.source_file_id,id);
  await saveOwnForm({known:{id:'f1',updated_at:'t2',source_file_id:id},name:'내 양식',sourceName:'a.hwp',form},rt);
  assert.equal(sent[1].method,'PATCH');assert.ok(!('source_file_id' in sent[1].body),'not sent (kept) when no new file');
  await saveOwnForm({known:{id:'f1',updated_at:'t2',source_file_id:id},name:'내 양식',sourceName:'b.hwp',sourceFileId:null,form},rt);
  assert.equal(sent[2].body.source_file_id,null,'a new file that could not be uploaded clears the old link');
  await saveOwnForm({known:null,name:'내 양식',sourceFileId:'bad id!',form},rt);
  assert.equal(sent[3].body.source_file_id,null,'a malformed id is never sent');
});

// 기기 저장소를 쓰지 않는지는 browser-storage-audit 워크플로가 app/ 전체를 본다.
test('screen code: the text window waits for a form; the upload goes through saveUnionForm',()=>{
  const lab=readFileSync(new URL('../app/hwp-lab.js',import.meta.url),'utf8');
  const start=lab.slice(lab.indexOf('async function startConvert'),lab.indexOf('async function runConvert'));
  assert.ok(start.indexOf('findUnionTemplate')<start.indexOf('openFormUploadDialog'));
  assert.match(start,/found&&!found\.total/);
  assert.match(start,/saveUnionForm/);
  const journal=readFileSync(new URL('../app/journal.js',import.meta.url),'utf8');
  assert.match(journal,/saveUnionForm\(file/);
});

// S68-21(사용자 11/22 17:04): 서식 분류 이름 — WORK ON+ 기본(girok) '서식', 사용자 화면(nojo_words)·노동조합+ 얼굴 '노조 서식' 그대로.
// 저장된 분류 값은 바꾸지 않는다: 찾기는 세 이름 모두, 올릴 때 내 목록에 '노조 서식'이 이미 있으면 그 분류를 계속 쓴다.
test('S68-21: 서식 분류 이름은 얼굴 단어, 저장된 값은 그대로 찾고 이어 쓴다',()=>{
  const girok=wordIn(FACES.girok,'노조 서식'),mine=wordIn(withWordBase(FACES.girok,'nojo'),'노조 서식');
  assert.equal(girok,'서식');
  assert.equal(mine,'노조 서식','nojo_words는 지금 이름');
  assert.equal(wordIn(FACES.nojo,'노조 서식'),'노조 서식');
  assert.equal(UNION_TEMPLATE_NOJO_CATEGORY,'노조 서식');
  assert.match(readFileSync(new URL('../app/hwp-drive.js',import.meta.url),'utf8'),/export const UNION_TEMPLATE_CATEGORY=word\('노조 서식'\);/);
  assert.deepEqual([...templateCategoriesFor(girok)],['서식','노조 서식','양식']);
  assert.deepEqual([...templateCategoriesFor(mine)],['노조 서식','양식']);
  // girok: 새 사람은 '서식'을 새로 더하고, 전에 '노조 서식'을 만든 사람은 그 분류를 계속 쓴다.
  assert.equal(templateSaveCategory(['교섭','기타'],girok),'서식');
  assert.equal(templateSaveCategory(['노조 서식','기타'],girok),'노조 서식');
  assert.equal(templateSaveCategory(['서식','노조 서식','기타'],girok),'서식');
  assert.equal(templateSaveCategory(['양식','기타'],girok),'서식','옛 양식은 이어 쓰지 않는다(지금과 같음)');
  // nojo_words: 지금처럼 '노조 서식'.
  assert.equal(templateSaveCategory(['교섭','기타'],mine),'노조 서식');
  assert.equal(templateSaveCategory(['서식','기타'],mine),'노조 서식','사용자의 다른 서식 분류는 건드리지 않는다');
  // 꼬리표: 세 이름이 같은 분류로 보인다(자료 값은 그대로).
  setDocumentCategories(['서식','기타']);
  assert.equal(categoryOf('노조 서식'),'서식');assert.equal(categoryOf('양식'),'서식');
  setDocumentCategories(['노조 서식','기타']);
  assert.equal(categoryOf('서식'),'노조 서식');
  resetDocumentCategories();
});

test('S68-21: 내 양식 저장 안내는 실제로 들어간 분류 이름을 쓴다',()=>{
  const journal=readFileSync(new URL('../app/journal.js',import.meta.url),'utf8');
  assert.doesNotMatch(journal,/자료실 '노조 서식'에 두었어요/);
  assert.match(journal,/upCategory = up\.document\.category/);
});
