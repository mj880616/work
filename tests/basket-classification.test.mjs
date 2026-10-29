import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmLinks } from '../app/basket-classification.js';
// BASKET-AI메뉴삭제: [AI 분류 요청]·'분류 결과 입력'은 지웠다. 남은 것은 연결 확정 호출 하나(직접 연결·되돌리기·기록할 곳이 쓴다).
const n='10000000-0000-4000-8000-000000000001', p='20000000-0000-4000-8000-000000000001', w='30000000-0000-4000-8000-000000000001';
const stamp='2026-10-11T01:02:03.123456Z';
const proposal=()=>({schema_version:1,copied_at:stamp,items:[{note_id:n,note_updated_at:stamp,destinations:[{kind:'project',target_id:p,reason:'<img src=x onerror=alert(1)> https://example.org'}]}]});
test('confirm sends only typed note/version/selected targets and recognizes absent function',async()=>{
 const calls=[];const rt={api:async(path,options)=>{calls.push({path,...options});return {ok:true,created:1,existing:0};}};
 assert.equal((await confirmLinks(n,stamp,proposal().items[0].destinations,rt)).created,1);
 assert.deepEqual(Object.keys(calls[0].body),['p_note_id','p_note_updated_at','p_targets']);
 assert.equal(calls[0].path,'/rest/v1/rpc/app_basket_confirm_links');
 for(const error of [{status:404},{message:'Could not find the function public.app_basket_confirm_links in the schema cache'},{message:'function public.app_basket_confirm_links does not exist'}])assert.equal((await confirmLinks(n,stamp,[],{api:async()=>{throw error;}})).error,'FUNCTION_UNAVAILABLE');
 await assert.rejects(confirmLinks(n,stamp,[],{api:async()=>{throw Error('RLS denied');}}),/RLS/);
});
