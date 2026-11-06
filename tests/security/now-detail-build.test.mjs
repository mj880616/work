import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// NEWS-전면개편 P3b: 글 상세 만들기 공용 모듈(_shared/now-detail-build.ts) 단위 시험.
// 주입받는 읽기(rest·rpc)·fetch만 쓰고, 다음 단계(P3c) 수집 함수가 넘길 입력(글 id + 작업공간 + 재료 글자)을 받는지 본다.
// 네트워크·열쇠 없음, 가상 글·가상 id만.
const B=await import('../../supabase/functions/_shared/now-detail-build.ts');
const N=await import('../../supabase/functions/ai-assist/now-detail.ts');

const WS='a0000000-0000-4000-8000-000000000001',USER='b0000000-0000-4000-8000-000000000001';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const NOW=Date.parse('2026-11-06T01:00:00Z');

function deps({rows={},rpc=null}={}){
  const reads=[],logs=[],sites=[];
  return {
    reads,logs,sites,
    deps:{
      workspaceId:WS,userId:USER,
      rest:async(path)=>{reads.push(path);const t=path.split('?')[0];if(!(t in rows))throw new Error('rest_404');return rows[t];},
      rpc,
      doFetch:async(u)=>{sites.push(String(u));throw new Error('no network in this test');},
      sleep:async()=>{},now:()=>NOW,log:(code,detail)=>logs.push({code,detail}),
      fail:(status,code)=>Object.assign(new Error(code),{status,code}),
    },
  };
}
const POST={id:id(1),workspace_id:WS,source_key:'kptu',kind:'statement',lang:'ko',title:'[성명] 가상 성명',title_ko:null,author:null,url:'https://www.kptu.net/x/1',summary_ko:null,key_sentences:[],has_body:true};
const FOREIGN={...POST,id:id(2),source_key:'socialistworker',lang:'en',title:'Synthetic strike',url:'https://www.socialistworker.co.uk/news/x/',has_body:false};

test('blocksText: text blocks only, joined by lines, capped at the material size',()=>{
  assert.equal(B.blocksText([{t:'h',text:'제목 줄'},{t:'img',src:'https://e.example/1.jpg',cap:'캡션'},{t:'p',text:' 본문 \u0007'},{t:'quote',text:'인용'},{t:'x',text:'모르는 칸'}]),'제목 줄\n본문\n인용');
  assert.equal(B.blocksText(null),'');assert.equal(B.blocksText('p'),'');
  assert.equal([...B.blocksText([{t:'p',text:'가'.repeat(7000)}])].length,B.NOW_MATERIAL_CHARS);
});

test('loadItem with feedText (what P3c passes): no body-table or sentence-table read',async()=>{
  const d=deps({rows:{app_outside_posts:[POST]}});
  const item=await B.loadItem(d.deps,{type:'outside',id:POST.id,feedText:'수집 때 저장한 본문.'});
  assert.equal(item.body,'수집 때 저장한 본문.');assert.equal(item.fromFeed,true);
  assert.deepEqual(d.reads.map(p=>p.split('?')[0]),['app_outside_posts']);
  assert.ok(d.reads[0].includes(`workspace_id=eq.${WS}`));
});

test('loadItem without feedText reads app_feed_bodies first, else the old way; ok/lead only',async()=>{
  const blocks=[{t:'p',text:'블록 본문.'}];
  let d=deps({rows:{app_outside_posts:[POST],app_feed_bodies:[{state:'ok',blocks}],app_outside_sentences:[{idx:0,text:'문장 표 본문.'}]}});
  let item=await B.loadItem(d.deps,{type:'outside',id:POST.id});
  assert.equal(item.body,'블록 본문.');assert.ok(!d.reads.some(p=>p.startsWith('app_outside_sentences')));
  d=deps({rows:{app_outside_posts:[POST],app_feed_bodies:[{state:'image_only',blocks:[{t:'p',text:'첨부.hwp'}]}],app_outside_sentences:[{idx:0,text:'문장 표 본문.'}]}});
  item=await B.loadItem(d.deps,{type:'outside',id:POST.id});
  assert.equal(item.body,'문장 표 본문.');assert.equal(item.fromFeed,false);
  d=deps({rows:{app_news_items:[{id:id(3),workspace_id:WS,title:'가상 기사',summary:'',body:'저장 body.',lang:'ko'}]}});
  item=await B.loadItem(d.deps,{type:'news',id:id(3)});
  assert.equal(item.body,'저장 body.');assert.ok(d.logs.some(l=>l.detail?.stage==='feed_body'));
  assert.equal(B.itemHasMaterial(item),true);
});

test('loadItem: another workspace or missing → 404, read failure → 503',async()=>{
  await assert.rejects(B.loadItem(deps({rows:{app_outside_posts:[{...POST,workspace_id:'a0000000-0000-4000-8000-000000000002'}]}}).deps,{type:'outside',id:POST.id}),{code:'not_found',status:404});
  await assert.rejects(B.loadItem(deps({rows:{app_outside_posts:[]}}).deps,{type:'outside',id:POST.id}),{code:'not_found'});
  await assert.rejects(B.loadItem(deps().deps,{type:'outside',id:POST.id}),{code:'read_unavailable',status:503});
});

test('foreignBody: skipped when the body came from stored blocks; off-catalog url never fetched',async()=>{
  const d=deps({rows:{app_outside_posts:[FOREIGN],app_feed_bodies:[{state:'ok',blocks:[{t:'p',text:'Stored text.'}]}]}});
  const item=await B.loadItem(d.deps,{type:'outside',id:FOREIGN.id});
  const got=await B.detailBody(d.deps,item);
  assert.deepEqual(got,{body:'Stored text.',hay:'Stored text.\n\nSynthetic strike',fetched:false});
  assert.equal(d.sites.length,0);
  assert.equal(await B.foreignBody(d.deps,{...item,fromFeed:false,url:'https://evil.example/x'}),'');assert.equal(d.sites.length,0);
});

test('relatedCandidates without rpc (scheduled callers): only post/news title reads, no record or ledger search',async()=>{
  const d=deps({rows:{app_outside_posts:[{id:id(9),title:'가상 민영화 성명'}],app_news_items:[]}});
  const item={type:'outside',id:id(1),title:'민영화 반대',titleKo:''};
  const c=await B.relatedCandidates(d.deps,item,[]);
  assert.deepEqual(c,[{ref:'r1',kind:'outside',id:id(9),title:'가상 민영화 성명'}]);
  assert.ok(d.reads.every(p=>p.includes(`workspace_id=eq.${WS}`)));
});

test('AI request body: no storage, no tools, strict JSON schema',()=>{
  const body=B.aiRequestBody('m','now_detail',B.NOW_DETAIL_INSTRUCTIONS,'{}',B.NOW_DETAIL_SCHEMA,B.NOW_DETAIL_OUT);
  assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.equal(body.max_output_tokens,1600);
  assert.deepEqual(body.input.map(i=>i.role),['developer','user']);
  assert.deepEqual(body.text.format,{type:'json_schema',name:'now_detail',strict:true,schema:B.NOW_DETAIL_SCHEMA});
});

test('stored row shapes match the app_now_details columns',()=>{
  const core={summary:'요약.',key_sentences:[]},ctx={relevance:null,implications:null,related:[]};
  const t='2026-11-06T01:00:00.000Z';
  assert.deepEqual(Object.keys(B.fullRow(core,ctx,'none',t)).sort(),['context_at','generated_at','implications','interests_key','key_sentences','level','related','relevance','summary','updated_at']);
  assert.equal(B.basicRow(core,'none',t).level,'basic');
  assert.deepEqual(Object.keys(B.contextPatch(ctx,'k',t)).sort(),['context_at','implications','interests_key','related','relevance','updated_at']);
  assert.deepEqual(B.detailUpsertBody(WS,{type:'news',id:id(3)},{level:'basic'}),{workspace_id:WS,news_item_id:id(3),level:'basic'});
  assert.equal(B.detailConflictColumn({type:'outside'}),'outside_post_id');
  const fb=B.fallbackRow({lang:'en',summary:'저장 요약',keySentences:[{orig:'A.',ko:'가.'}]},'none',t);
  assert.deepEqual([fb.level,fb.summary,fb.key_sentences],['basic','저장 요약',[{orig:'A.',ko:'가.'}]]);
});

test('ai-assist re-exports the moved names (one source, no copy)',()=>{
  for(const k of ['cleanCore','cleanContext','interestsKey','isNoContentSummary','titleWords','foreignBody','relatedCandidates','NOW_DETAIL_INSTRUCTIONS','NOW_BASIC_INSTRUCTIONS','NOW_CONTEXT_INSTRUCTIONS','NOW_DETAIL_SCHEMA'])
    assert.equal(N[k],B[k],k);
  const nd=readFileSync('supabase/functions/ai-assist/now-detail.ts','utf8');
  for(const k of ['function cleanCore','function cleanContext','function loadItem','function relatedCandidates','NOW_DETAIL_INSTRUCTIONS = ['])
    assert.ok(!nd.includes(k),`${k} lives only in the shared module`);
});
