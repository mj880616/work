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

// NEWS-모두에게열기 E3: 글은 공용 표(app_outside_articles·app_news_articles), 본문 블록·문장도 공용 표(글 id). 옛 줄은 지도 함수로 공용 id로.
const ART={...POST};delete ART.workspace_id;
const FART={...FOREIGN};delete FART.workspace_id;
test('loadItem with feedText (what P3c passes): no body-table or sentence-table read',async()=>{
  const d=deps({rows:{app_outside_articles:[ART],app_outside_posts:[]}});
  const item=await B.loadItem(d.deps,{type:'outside',id:POST.id,feedText:'수집 때 저장한 본문.'});
  assert.equal(item.body,'수집 때 저장한 본문.');assert.equal(item.fromFeed,true);
  assert.deepEqual(d.reads.map(p=>p.split('?')[0]),['app_outside_articles','app_outside_posts']);
  assert.ok(d.reads[1].includes(`workspace_id=eq.${WS}`),'옛 줄 찾기는 내 작업공간만');
  assert.equal(item.oldId,null);
});

test('loadItem without feedText reads the shared body blocks first, else the old way; ok/lead only',async()=>{
  const blocks=[{t:'p',text:'블록 본문.'}];
  let d=deps({rows:{app_outside_articles:[ART],app_outside_posts:[{id:POST.id}],app_outside_article_bodies:[{state:'ok',blocks}],app_outside_article_sentences:[{idx:0,text:'문장 표 본문.'}]}});
  let item=await B.loadItem(d.deps,{type:'outside',id:POST.id});
  assert.equal(item.body,'블록 본문.');assert.ok(!d.reads.some(p=>p.startsWith('app_outside_article_sentences')));
  assert.ok(d.reads.some(p=>p.startsWith('app_outside_article_bodies?article_id=eq.'+POST.id)));
  assert.equal(item.oldId,POST.id,'운영자 옛 줄 id = 공용 id');
  d=deps({rows:{app_outside_articles:[ART],app_outside_posts:[],app_outside_article_bodies:[{state:'image_only',blocks:[{t:'p',text:'첨부.hwp'}]}],app_outside_article_sentences:[{idx:0,text:'문장 표 본문.'}]}});
  item=await B.loadItem(d.deps,{type:'outside',id:POST.id});
  assert.equal(item.body,'문장 표 본문.');assert.equal(item.fromFeed,false);
  d=deps({rows:{app_news_articles:[{id:id(3),url_key:'n.example/3',title:'가상 기사',summary:'',body:'저장 body. 수집 때 기사 줄에 남겨 둔 본문 글자입니다.',lang:'ko'}],app_news_items:[]}});
  item=await B.loadItem(d.deps,{type:'news',id:id(3)});
  assert.equal(item.body,'저장 body. 수집 때 기사 줄에 남겨 둔 본문 글자입니다.');assert.ok(d.logs.some(l=>l.detail?.stage==='feed_body'));
  assert.equal(B.itemHasMaterial(item),true);
});

test('loadItem: old id → map rpc → shared id; missing → 404, read failure → 503',async()=>{
  const OLD=id(50);
  const rpcCalls=[];
  const rpc=async(name,args)=>{rpcCalls.push([name,args]);return name==='app_outside_article_of'?[{old_id:OLD,article_id:POST.id}]:[];};
  const d=deps({rows:{app_outside_articles:[ART],app_outside_article_bodies:[]},rpc});
  const item=await B.loadItem(d.deps,{type:'outside',id:OLD});
  assert.deepEqual([item.id,item.oldId],[POST.id,OLD]);
  assert.deepEqual(rpcCalls,[['app_outside_article_of',{p_old:[OLD]}]]);
  assert.ok(d.reads[0].startsWith(`app_outside_articles?id=eq.${POST.id}`));
  await assert.rejects(B.loadItem(deps({rows:{app_outside_articles:[]},rpc:async()=>[]}).deps,{type:'outside',id:POST.id}),{code:'not_found',status:404});
  await assert.rejects(B.loadItem(deps({rows:{app_outside_articles:[{...ART,id:id(77)}]}}).deps,{type:'outside',id:POST.id}),{code:'not_found'});
  await assert.rejects(B.loadItem(deps().deps,{type:'outside',id:POST.id}),{code:'read_unavailable',status:503});
  await assert.rejects(B.loadItem(deps({rows:{app_outside_articles:[ART]},rpc:async()=>{throw new Error('x');}}).deps,{type:'outside',id:POST.id}),{code:'read_unavailable'});
});

test('foreignBody: skipped when the body came from stored blocks; off-catalog url never fetched',async()=>{
  const d=deps({rows:{app_outside_articles:[FART],app_outside_posts:[],app_outside_article_bodies:[{state:'ok',blocks:[{t:'p',text:'Stored text.'}]}]}});
  const item=await B.loadItem(d.deps,{type:'outside',id:FOREIGN.id});
  const got=await B.detailBody(d.deps,item);
  assert.deepEqual(got,{body:'Stored text.',hay:'Stored text.\n\nSynthetic strike',fetched:false});
  assert.equal(d.sites.length,0);
  assert.equal(await B.foreignBody(d.deps,{...item,fromFeed:false,url:'https://evil.example/x'}),'');assert.equal(d.sites.length,0);
});

test('relatedCandidates without rpc (scheduled callers): only shared post/news title reads, no record or ledger search; my hidden news left out',async()=>{
  const d=deps({rows:{app_outside_articles:[{id:id(9),title:'가상 민영화 성명'}],app_news_articles:[{id:id(10),title:'민영화 숨긴 기사'},{id:id(11),title:'민영화 기사'}],
    app_news_marks:[{article_id:id(10),hidden_at:'2026-11-01T00:00:00Z'}]}});
  const item={type:'outside',id:id(1),title:'민영화 반대',titleKo:''};
  const c=await B.relatedCandidates(d.deps,item,[]);
  assert.deepEqual(c,[{ref:'r1',kind:'outside',id:id(9),title:'가상 민영화 성명'},{ref:'r2',kind:'news',id:id(11),title:'민영화 기사'}]);
  assert.ok(d.reads.find(p=>p.startsWith('app_news_marks')).includes(`workspace_id=eq.${WS}`),'숨김은 내 표시만');
});

test('AI request body: no storage, no tools, strict JSON schema',()=>{
  // S69-01: 처음 만들기는 요약·주요 문장(now_basic)과 연관·시사점(now_context) 두 요청.
  for(const [name,ins,schema,out] of [['now_basic',B.NOW_BASIC_INSTRUCTIONS,B.NOW_BASIC_SCHEMA,B.NOW_BASIC_OUT],['now_context',B.NOW_CONTEXT_INSTRUCTIONS,B.NOW_CONTEXT_SCHEMA,B.NOW_CONTEXT_OUT]]){
    const body=B.aiRequestBody('m',name,ins,'{}',schema,out);
    assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.equal(body.max_output_tokens,out);
    assert.deepEqual(body.input.map(i=>i.role),['developer','user']);
    assert.deepEqual(body.text.format,{type:'json_schema',name,strict:true,schema});
  }
  assert.equal(B.NOW_DETAIL_INSTRUCTIONS,undefined,'예전 한 요청(now_detail)은 없다');
});

test('S69-01 body fingerprint: content only (whitespace·case ignored), none when empty; changed only by content once stored',async()=>{
  const k=await B.bodyKey({body:'공공기관 민영화 저지.\n정부는 멈춰야 한다.'});
  assert.match(k,/^[a-f0-9]{32}$/);
  assert.equal(await B.bodyKey({body:'  공공기관  민영화 저지.  정부는 멈춰야 한다. '}),k);
  assert.notEqual(await B.bodyKey({body:'공공기관 민영화 저지.'}),k);
  assert.equal(await B.bodyKey({body:''}),'none');
  const item={fromFeed:true,bodyAt:'2026-11-23T00:00:00Z'};
  const made={generated_at:'2026-11-20T00:00:00Z'};
  assert.equal(B.bodyChanged(item,{...made,body_key:k},k),false,'본문 시각이 더 새로워도 지문이 같으면 그대로');
  assert.equal(B.bodyChanged(item,{...made,body_key:'none'},k),true,'본문 없이 만든 저장본 → 본문이 생기면 다시');
  assert.equal(B.bodyChanged(item,{...made,body_key:null},k),true,'지문 없는 옛 저장본만 시각 비교');
  assert.equal(B.bodyChanged({...item,bodyAt:'2026-11-19T00:00:00Z'},{...made,body_key:null},k),false);
  assert.equal(B.bodyChanged(item,null,k),false);
  // S73-01 NEWS-본문하루: 본문을 비운 지난 기사(지금 지문 none) — 본문으로 만든 저장본은 그대로, 본문 없이 만든 저장본은 그대로 none.
  assert.equal(B.bodyChanged(item,{...made,body_key:k},'none'),false,'본문이 비워져도 본문으로 만든 저장본은 그대로');
  assert.equal(B.bodyChanged(item,{...made,body_key:'none'},'none'),false);
  assert.equal(B.madeFromBody({body_key:k}),true);
  assert.equal(B.madeFromBody({body_key:'none'}),false);assert.equal(B.madeFromBody({body_key:null}),false);assert.equal(B.madeFromBody(null),false);
});

test('stored row shapes match the app_now_details columns',()=>{
  const core={summary:'요약.',key_sentences:[]},ctx={relevance:null,implications:null,related:[]};
  const t='2026-11-06T01:00:00.000Z';
  assert.deepEqual(Object.keys(B.fullRow(core,ctx,'none',t,'abc')).sort(),['body_key','context_at','generated_at','implications','interests_key','key_sentences','level','related','relevance','summary','updated_at']);
  assert.deepEqual([B.basicRow(core,'none',t,'abc').level,B.basicRow(core,'none',t,'abc').body_key],['basic','abc']);
  assert.equal(B.contextPatch,undefined,'관심 주제만 바뀐 다시 만들기는 없다(S69-01)');
  assert.deepEqual(B.detailUpsertBody(WS,{type:'news',id:id(3)},{level:'basic'}),{workspace_id:WS,news_item_id:id(3),level:'basic'});
  assert.equal(B.detailConflictColumn({type:'outside'}),'outside_post_id');
  assert.equal(B.detailTable({type:'outside'}),'app_outside_now_details');assert.equal(B.detailTable({type:'news'}),'app_news_now_details');
  assert.deepEqual(B.sharedDetailUpsertBody(WS,{id:id(3)},{level:'basic'}),{workspace_id:WS,article_id:id(3),level:'basic'});
  const fb=B.fallbackRow({lang:'en',summary:'저장 요약',keySentences:[{orig:'A.',ko:'가.'}]},'none',t,'none');
  assert.deepEqual([fb.level,fb.summary,fb.key_sentences,fb.body_key],['basic','저장 요약',[{orig:'A.',ko:'가.'}],'none']);
});

test('ai-assist re-exports the moved names (one source, no copy)',()=>{
  for(const k of ['bodyKey','cleanCore','cleanContext','interestsKey','isNoContentSummary','titleWords','foreignBody','relatedCandidates','NOW_BASIC_INSTRUCTIONS','NOW_CONTEXT_INSTRUCTIONS','NOW_BASIC_SCHEMA','NOW_CONTEXT_SCHEMA'])
    assert.equal(N[k],B[k],k);
  const nd=readFileSync('supabase/functions/ai-assist/now-detail.ts','utf8');
  for(const k of ['function cleanCore','function cleanContext','function loadItem','function relatedCandidates','function bodyKey','NOW_BASIC_INSTRUCTIONS = ['])
    assert.ok(!nd.includes(k),`${k} lives only in the shared module`);
});
