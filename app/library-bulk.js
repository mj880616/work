// LIB-폴더탐색기 화면 ③(docs/design/library-tree.md 12절): 자료실 선택 모드의 일괄 수정.
// 고른 자료의 프로젝트·담당조직·종류를 한 번에 바꾼다. 자료 한 건의 [정보 수정]과 같은 서버 길(app_documents PATCH, 소유자 RLS)을
// 한 번에 하나씩 차례로 부르고, 바꾼 칸은 칸별 기록(field_origin)에 'user'로 남겨 AI 자동 정리가 되돌리지 않게 한다(originAfterEdit 그대로).
// 폴더로 옮기기는 library-folders.js(bulkMove). 이 파일은 화면·네트워크 부품만 받아 쓰는 순수한 부분과 차례 실행만 맡는다.
import {originAfterEdit} from './library-ai-fill.js';
import {deleteSequentially} from './library-select.js';

export const BULK_FIELDS=Object.freeze({
  project:Object.freeze({field:'project_id',label:'프로젝트',none:'프로젝트 없음'}),
  organization:Object.freeze({field:'organization_id',label:'담당조직',none:'담당조직 없음'}),
  category:Object.freeze({field:'category',label:'종류',none:''}),
});
const norm=v=>v===undefined||v===''?null:v;

// 한 자료의 한 칸을 value로 바꾸는 PATCH 본문. 이미 같은 값이면 null(요청하지 않음).
// 자료 정보 수정과 같이 auto_classified=false·classification_note='사용자 수정'을 남기고, 칸 기록이 있는 DB면 field_origin의 그 칸을 'user'로 한다.
export function bulkBody(doc,kind,value,now=new Date().toISOString()){
  const spec=BULK_FIELDS[kind];if(!spec||!doc)return null;
  const next=norm(value);
  if(kind==='category'&&!next)return null;
  if(norm(doc[spec.field])===next)return null;
  const body={[spec.field]:next,updated_at:now,auto_classified:false,classification_note:'사용자 수정'};
  const origin=originAfterEdit(doc,[spec.field]);if(origin)body.field_origin=origin;
  return body;
}
// 되돌리기 본문: 바꾸기 전 값·기록으로 돌린다.
export function bulkUndoBody(before,kind,now=new Date().toISOString()){
  const spec=BULK_FIELDS[kind];
  const body={[spec.field]:norm(before[spec.field]),updated_at:now,auto_classified:before.auto_classified===undefined?false:before.auto_classified,classification_note:before.classification_note??null};
  if(Object.hasOwn(before,'field_origin'))body.field_origin=before.field_origin;
  return body;
}
// 작은 목록에 보일 선택지. current는 고른 자료들의 값(모두 같으면 그 값, 아니면 undefined)이라 '지금 값'은 표시만 한다.
export function bulkChoices(kind,{projects=[],organizations=[],categories=[]}={}){
  const spec=BULK_FIELDS[kind];
  if(kind==='project')return [{value:'',label:spec.none},...projects.map(p=>({value:p.value,label:p.label,depth:p.depth||0}))];
  if(kind==='organization')return [{value:'',label:spec.none},...organizations.map(o=>({value:o.id,label:String(o.name||'이름 없는 조직')}))];
  return categories.map(name=>({value:name,label:name}));
}
export const commonValue=(docs,kind)=>{
  const field=BULK_FIELDS[kind].field,first=norm(docs[0]?.[field]);
  return docs.length&&docs.every(d=>norm(d[field])===first)?first:undefined;
};
export function bulkResultText({label,changed,same=0,failed=0,skipped=0}){
  const bad=failed+skipped;
  if(!bad)return changed?`${changed}개의 ${label}을(를) 바꿨어요${same?` (${same}개는 이미 같았어요)`:''} ·`:`이미 모두 같은 ${label}이에요.`;
  return `${changed}개의 ${label}을(를) 바꿨고 ${bad}개는 바꾸지 못했어요. 못 바꾼 자료는 그대로 골라 두었어요.`;
}

// 차례 실행(한 번에 하나, 서버 부담을 같게). 로그인·권한 문제(401/403)면 남은 것은 요청하지 않고 멈춘다.
// api(path,opt), scope()는 {workspace,epoch}|null, docs()는 지금 자료 목록, replaceRow(row)로 화면 자료를 서버 값으로 갈아 끼운다.
export function createBulkEditor({api,scope,docs,replaceRow,isCurrent=()=>true,onProgress=null}){
  const enc=encodeURIComponent;
  const url=(id,sc)=>`/rest/v1/app_documents?id=eq.${enc(id)}&workspace_id=eq.${enc(sc.workspace)}&select=*`;
  async function patchOne(id,body,sc){
    const rows=await api(url(id,sc),{method:'PATCH',body,prefer:'return=representation',expectedSessionEpoch:sc.epoch});
    const row=Array.isArray(rows)?rows[0]:null;
    if(!row||row.id!==id)throw Object.assign(new Error('BULK_NOT_CONFIRMED'),{status:0});
    return row;
  }
  async function apply(ids,kind,value){
    const sc=scope();if(!sc)return {error:'scope'};
    const before=new Map();let same=0;
    const r=await deleteSequentially(ids,async id=>{
      const d=docs().find(x=>x.id===id);if(!d)return {ok:false};
      const body=bulkBody(d,kind,value);if(!body){same++;return {ok:true}}
      const old=structuredClone(d);
      try{const row=await patchOne(id,body,sc);before.set(id,old);replaceRow(row);return {ok:true}}
      catch(e){return {ok:false,stop:e?.status===401||e?.status===403}}
    },{isCurrent,onProgress});
    return {done:r.done,failed:r.failed,skipped:r.skipped,changed:before.size,same,before};
  }
  // 되돌리기: 바꾼 값이 아직 그대로인 자료만 원래 값으로.
  async function undo(before,kind,value){
    const sc=scope();if(!sc)return {error:'scope'};
    const field=BULK_FIELDS[kind].field;let back=0,kept=0;
    for(const [id,old] of before){
      const d=docs().find(x=>x.id===id);
      if(!d||norm(d[field])!==norm(value)){kept++;continue}
      try{replaceRow(await patchOne(id,bulkUndoBody(old,kind),sc));back++}catch(e){kept++;if(e?.status===401||e?.status===403)break}
    }
    return {back,kept};
  }
  return {apply,undo};
}

// Ctrl/Shift+클릭용: 보이는 줄 차례(order)에서 anchor부터 target까지 id들.
export function rangeIds(order,anchor,target){
  const a=order.indexOf(anchor),b=order.indexOf(target);
  if(b<0)return [];
  if(a<0)return [target];
  return order.slice(Math.min(a,b),Math.max(a,b)+1);
}
