import { ordered } from './project-order.mjs';
// Untrusted AI proposals live only in memory. Never render reason as markup.
export const CLASSIFICATION_LIMITS = Object.freeze({bytes:1048576, items:100, targets:20, reason:2000, depth:7, compared:5});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const VERDICTS = Object.freeze(['new','duplicate','changed']);
const kinds = new Set(['organization','project','library','write_request_candidate','google_task']);
export const ERROR_TEXT = Object.freeze({RESULT_UNKNOWN:'결과를 확인하지 못했어요. 다시 확인을 눌러 현재 연결을 확인해 주세요.',NOTE_MISSING:'업데이트를 찾거나 열 수 없어요.',NOTE_WORKSPACE:'다른 업무 공간의 업데이트예요.',NOTE_ARCHIVED:'보관된 업데이트예요.',AI_EXCLUDED:'AI에게 맡기지 않기로 한 업데이트예요.',NOTE_CHANGED:'업데이트가 바뀌었어요. AI에게 다시 맡겨 주세요.',TARGET_MISSING:'연결할 곳을 찾거나 열 수 없어요.',TARGET_WORKSPACE:'다른 업무 공간에 있는 곳이에요.',TARGET_UNSELECTABLE:'지금은 선택할 수 없는 곳이에요.',ALREADY_CONFIRMED:'이미 연결됨',NEXT_STAGE:'아직 지원하지 않는 항목',FUNCTION_UNAVAILABLE:'연결 기능 준비 중',INVALID_TARGETS:'연결할 곳을 다시 확인해 주세요.',INVALID_INPUT:'업데이트 정보가 맞지 않아요. AI에게 다시 맡겨 주세요.',PERMISSION_DENIED:'이 내용을 열거나 연결할 권한이 없어요.',SUGGESTED_EXISTS:'이미 제안된 연결이 있어요. 현재 연결을 확인해 주세요.'});
// The handoff instructions use the parser's limits and a canonical valid shape.
// These keys belong in the copied AI instructions, never in screen errors.
export function classificationFormat(now) {
  const example={schema_version:1,copied_at:now.toISOString(),items:[]};
  return `답은 다음 순서로 써 주세요.\n① 사람이 읽는 짧은 정리: 메모 첫 줄 → 목적지 이름 · 기록 요약\n② 아래 문장을 그대로 써 주세요.\n아래 블록을 복사해서 바구니의 '분류 결과 입력'에 붙여 넣으세요\n③ 아래 형식의 json 코드 블록을 정확히 하나 써 주세요.\n사람이 읽는 정리와 블록이 다르면 블록이 기준입니다.\n\n\`\`\`json\n${JSON.stringify(example,null,2)}\n\`\`\`\nproject는 {"kind":"project", "target_id":"프로젝트 ID", "reason":"기록 요약"}로 제안하세요.\nitems에 정리할 메모마다 {"note_id":"메모 ID", "note_updated_at":"메모의 updated_at", "destinations":[{"kind":"organization", "target_id":"목적지 ID", "reason":"기록 요약"}]}를 넣으세요.\nkind는 organization(담당조직), project(프로젝트) 두 종류만 쓰세요. schema_version은 1, copied_at은 위 시각을 그대로 쓰세요. ID와 updated_at은 아래 목록의 값을 그대로 쓰세요.\nreason은 기록 요약입니다. 원문에 있는 핵심 내용을 한 줄로 짧게 정리하고, 날짜·요일·시간·장소·주체·대상·숫자와 진행 상태(예정·검토·확정·취소)를 그대로 보존하세요. 예정이나 검토를 확정으로 바꾸지 마세요. 원문에 없는 사실을 만들거나 추측하지 마세요. 원문에 없는 날짜·요일·시간·장소·주체·대상·숫자·상태는 추가하지 마세요. '내용 공유'나 '일정 및 장소 안내'처럼 구체적인 사실이 없는 말만 쓰지 마세요.\n합성 원문: 한빛지부 10/20 10:00 시청 앞 광장 기자회견 예정 참석30명\n좋은 기록 요약: 한빛지부, 10/20 10:00 시청 앞 광장 기자회견 예정, 참석 30명\n나쁜 기록 요약: 한빛지부 기자회견 일정 및 장소 안내\n나쁜 요약은 원문의 날짜·시간·장소·예정 상태·참석 인원을 빠뜨렸습니다. 합성 예의 사실은 아래 메모의 요약에 넣지 마세요.\n메모는 최대 ${CLASSIFICATION_LIMITS.items}개, 메모당 목적지는 최대 ${CLASSIFICATION_LIMITS.targets}개, 기록 요약은 1~${CLASSIFICATION_LIMITS.reason}자, 블록은 최대 ${CLASSIFICATION_LIMITS.bytes}바이트입니다. copied_at과 note_updated_at은 시간대가 포함된 시각을 그대로 쓰고, 같은 메모나 같은 항목 이름을 중복해서 쓰지 마세요. 메모 본문은 답에 다시 싣지 마세요.`;
}
export function parseAIAnswer(input) {
  const source=String(input);
  if(new TextEncoder().encode(source).length>CLASSIFICATION_LIMITS.bytes)throw Error('글이 너무 길어요. 업데이트 100개 이내의 복사용 블록만 넣어 주세요.');
  // Only inspect fence structure outside the block. Prose is never rendered,
  // interpreted, or sent to the strict parser. Reject extra/unsupported fences.
  const fences=[...source.matchAll(/^[\t ]*```([^\r\n]*)\r?$/gm)];
  const trimmed=source.trim(),raw=fences.length===0&&trimmed.startsWith('{')&&trimmed.endsWith('}');
  if(/^[\t ]*~~~/m.test(source)||(!raw&&(fences.length!==2||! /^(?:json)?[\t ]*$/i.test(fences[0][1])||! /^[\t ]*$/.test(fences[1][1]))))throw Error('AI 답 전체나, 답 속 복사용 블록만 넣어 주세요');
  // Code-block copy buttons omit the fences. Both forms use the same strict parser.
  const block=raw?trimmed:source.slice(fences[0].index+fences[0][0].length,fences[1].index).trim();
  try{return parseClassification(block);}catch(error){
    const text=error.message;
    const limit=[['메모는 100개','업데이트는 100개까지 넣을 수 있어요.'],['메모당 목적지는 20개','업데이트 하나에 연결할 곳은 20개까지예요.'],['이유는 1~2,000자','연결 이유는 1~2,000자로 써 주세요.'],['문자열은 2,000자','한 항목의 글은 2,000자까지 넣을 수 있어요.'],['중복 메모 ID','같은 업데이트가 두 번 들어 있어요. AI에게 다시 정리해 달라고 해 주세요.']].find(([prefix])=>text.startsWith(prefix));
    throw Error(limit?.[1]||'복사용 블록의 내용이 맞지 않아요. AI에게 같은 형식으로 다시 정리해 달라고 해 주세요.');
  }
}
export function timestampKey(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) return null;
  const [,y,mo,d,h,mi,s,us='',zone]=m, year=+y, month=+mo, day=+d;
  const days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<1||month<1||month>12||day<1||day>days[month-1]||+h>23||+mi>59||+s>59) return null;
  let offset=0;
  if(zone!=='Z') {const hours=+zone.slice(1,3), minutes=+zone.slice(4);if(hours>15||minutes>59)return null;offset=(hours*60+minutes)*(zone[0]==='+'?1:-1);}
  const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(+h,+mi,+s,0);
  return BigInt(date.getTime()-offset*60000)*1000n+BigInt(us.padEnd(6,'0'));
}
export function parseClassification(input) {
  let source=String(input), pos=0;
  const positions=new WeakMap();
  const fail=(message, at=pos)=>{const before=source.slice(0,at),line=before.split('\n').length,col=at-(before.lastIndexOf('\n')+1)+1;throw new Error(`${message} (행 ${line}, 열 ${col})`);};
  if(new TextEncoder().encode(source).length>CLASSIFICATION_LIMITS.bytes)fail('UTF-8 1 MiB까지 붙여넣을 수 있습니다.',0);
  // Keep original offsets, including the fence, for useful input locations.
  const fence=/^\s*```(?:json)?[^\S\n]*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(source);
  let end=source.length;
  if(fence){pos=source.indexOf('\n')+1;end=pos+fence[1].length;}
  const space=()=>{while(pos<end&&/[\x20\t\r\n]/.test(source[pos]))pos++;};
  function string() {
    const start=pos++;let escaped=false;
    while(pos<end){const c=source[pos++];if(!escaped&&c==='"'){
      let value;try{value=JSON.parse(source.slice(start,pos));}catch{fail('문자열 형식 오류',start);}
      if(value.includes('\0')||value.isWellFormed?.()===false)fail('잘못된 Unicode 문자열',start);
      if([...value].length>2000)fail('문자열은 2,000자까지 허용합니다.',start);
      return value;
    }if(!escaped&&c==='\\')escaped=true;else escaped=false;}
    fail('문자열 끝을 확인해 주세요.',start);
  }
  function value(depth=1) {
    space();if(depth>7)fail('중첩은 7단계까지 허용합니다.');
    if(source[pos]==='"')return string();
    if(source[pos]==='{'||source[pos]==='['){
      const object=source[pos++]==='{',close=object?'}':']',out=object?Object.create(null):[],keys=new Map();positions.set(out,keys);space();
      if(source[pos]===close){pos++;return out;}
      for(;;){space();let key;
        if(object){const at=pos;if(source[pos]!=='"')fail('JSON 키가 필요합니다.');key=string();if(keys.has(key))fail('중복 키: '+key,at);keys.set(key,at);space();if(source[pos++]!==':')fail('콜론이 필요합니다.',pos-1);}
        const entry=value(depth+1);if(object)out[key]=entry;else out.push(entry);space();
        if(source[pos]===close){pos++;return out;}if(source[pos++]!==',')fail('쉼표 또는 닫는 괄호가 필요합니다.',pos-1);
      }
    }
    const token=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(pos,end));
    if(!token)fail('JSON만 붙여넣어 주세요. 설명 글은 제외해 주세요.');pos+=token[0].length;return JSON.parse(token[0]);
  }
  const data=value();space();if(pos!==end)fail('JSON 뒤의 설명 글을 제외해 주세요.');
  const check=(ok,message,obj,key)=>{if(!ok)fail(message,positions.get(obj)?.get(key)??0);};
  const shape=(obj,allowed,required=allowed)=>{
    check(obj&&typeof obj==='object'&&!Array.isArray(obj),'객체 형식이 필요합니다.');
    for(const key of Object.keys(obj))check(allowed.includes(key),'모르는 키: '+key,obj,key);
    for(const key of required)check(Object.hasOwn(obj,key),'필수 키: '+key,obj,key);
  };
  shape(data,['schema_version','copied_at','items']);check(data.schema_version===1,'schema_version=1만 지원합니다.',data,'schema_version');
  check(timestampKey(data.copied_at)!==null,'잘못된 날짜: copied_at',data,'copied_at');
  check(Array.isArray(data.items)&&data.items.length<=100,'메모는 100개까지 허용합니다.',data,'items');const seen=new Set();
  for(const item of data.items){shape(item,['note_id','note_updated_at','destinations']);check(typeof item.note_id==='string'&&uuid.test(item.note_id),'메모 UUID 형식 오류',item,'note_id');
    item.note_id=item.note_id.toLowerCase();check(!seen.has(item.note_id),'중복 메모 ID',item,'note_id');seen.add(item.note_id);
    check(timestampKey(item.note_updated_at)!==null,'잘못된 날짜: note_updated_at',item,'note_updated_at');
    check(Array.isArray(item.destinations)&&item.destinations.length<=20,'메모당 목적지는 20개까지 허용합니다.',item,'destinations');
    for(const target of item.destinations){shape(target,['kind','target_id','reason','verdict','compared_link_ids'],['kind','reason']);check(kinds.has(target.kind),'모르는 kind',target,'kind');
      if(Object.hasOwn(target,'verdict'))check(VERDICTS.includes(target.verdict),'모르는 verdict',target,'verdict');
      if(Object.hasOwn(target,'compared_link_ids'))check(Array.isArray(target.compared_link_ids)&&target.compared_link_ids.length<=CLASSIFICATION_LIMITS.compared&&target.compared_link_ids.every(id=>typeof id==='string'&&uuid.test(id)),'비교한 기록 ID 형식 오류',target,'compared_link_ids');
      check(typeof target.reason==='string'&&[...target.reason].length>=1&&[...target.reason].length<=2000,'이유는 1~2,000자입니다.',target,'reason');
      if(['organization','project'].includes(target.kind))check(typeof target.target_id==='string'&&uuid.test(target.target_id),'목적지 UUID 형식 오류',target,'target_id');
      else if(target.target_id!==undefined&&target.target_id!==null)check(typeof target.target_id==='string'&&/^[A-Za-z0-9_-]{1,255}$/.test(target.target_id),'4b 대상 ID 형식 오류',target,'target_id');
      if(typeof target.target_id==='string'&&uuid.test(target.target_id))target.target_id=target.target_id.toLowerCase();
      if(Array.isArray(target.compared_link_ids))target.compared_link_ids=target.compared_link_ids.map(id=>id.toLowerCase());
    }
  }
  // Ordinary JSON objects leave the parser; internal objects protect __proto__ keys.
  return JSON.parse(JSON.stringify(data));
}
// BASKET-분류순서: the picker lists projects in the one project order (project-order.mjs): each top project, then its
// children, siblings by the user's order. `visible` is selectableProjects(). Rows outside it are dropped.
export function orderedSelectableProjects(projects,visible=selectableProjects(projects)) {
  const rows=ordered(projects.filter(p=>visible.has(p.id))),out=[],seen=new Set();
  const walk=p=>{if(seen.has(p.id))return;seen.add(p.id);out.push(p);rows.filter(c=>c.parent_id===p.id).forEach(walk);};
  rows.filter(p=>!p.parent_id||!rows.some(x=>x.id===p.parent_id)).forEach(walk);return out;
}
export function selectableProjects(projects) {
  const included=new Set(projects.filter(p=>p.metadata?.project_system==='v2'||Number(p.metadata?.management_version)===2).map(p=>p.id));
  let changed=true;while(changed){changed=false;for(const p of projects)if(included.has(p.parent_id)&&!included.has(p.id)){included.add(p.id);changed=true;}}
  const rows=projects.filter(p=>included.has(p.id)),visible=new Set();
  function walk(p){if(visible.has(p.id)||p.status==='archived')return;visible.add(p.id);rows.filter(c=>c.parent_id===p.id).forEach(walk);}
  rows.filter(p=>!p.parent_id||!rows.some(parent=>parent.id===p.parent_id)).forEach(walk);return visible;
}
// sentRecords: the existing records the request carried ({id,kind,target_id}). A duplicate/changed verdict
// counts only when every compared id was sent for that same destination; otherwise it falls back to 'new'.
// A duplicate is only marked excluded here; nothing is deleted or linked automatically.
export function judgeVerdict(target,sentRecords=[]) {
  const verdict=target.verdict||'new',ids=target.compared_link_ids||[];
  if(verdict==='new')return {verdict:'new',comparedLinkIds:[],verdictNoBasis:false};
  const ok=ids.length>0&&ids.every(id=>sentRecords.some(r=>String(r.id).toLowerCase()===id&&r.kind===target.kind&&String(r.target_id).toLowerCase()===target.target_id));
  if(!ok)return {verdict:'new',comparedLinkIds:[],verdictNoBasis:true};
  return {verdict,comparedLinkIds:[...ids],verdictNoBasis:false,...(verdict==='duplicate'?{excluded:true,excludedReason:'already_recorded'}:{})};
}
export function previewClassification(proposal,{workspaceId,userId,notes,links,projects,organizations,sentRecords=[]}) {
  const visible=selectableProjects(projects.filter(p=>p.workspace_id===workspaceId&&p.owner_id===userId));
  return proposal.items.map(item=>{
    const note=notes.find(n=>n.id===item.note_id);
    const error=!note?'NOTE_MISSING':note.workspace_id!==workspaceId?'NOTE_WORKSPACE':note.archived_at?'NOTE_ARCHIVED':note.ai_export_allowed!==true?'AI_EXCLUDED':timestampKey(note.updated_at)!==timestampKey(item.note_updated_at)?'NOTE_CHANGED':null;
    return {item,note,error,destinations:item.destinations.map(target=>{
      const supported=['organization','project'].includes(target.kind), rows=target.kind==='organization'?organizations:projects;
      const destination=supported?rows.find(d=>d.id===target.target_id):null;
      const existing=supported?links.find(l=>l.note_id===item.note_id&&l.status==='confirmed'&&l[target.kind==='project'?'project_id':'organization_id']===target.target_id):null;
      const targetError=!supported?'NEXT_STAGE':!destination?'TARGET_MISSING':destination.workspace_id!==workspaceId?'TARGET_WORKSPACE':target.kind==='project'&&!visible.has(destination.id)?'TARGET_UNSELECTABLE':existing&&!existing.id?'ALREADY_CONFIRMED':null;
      return {...target,...judgeVerdict(target,sentRecords),...(supported?{summary:existing?.summary??null,action:existing?'update':'create',linkId:existing?.id??null,expectedSummary:existing?.summary??null}:{}),name:destination?.name||'이름을 확인할 수 없어요.',error:!supported?'NEXT_STAGE':error||targetError};
    })};
  });
}
async function readPages(path,rt){const rows=[];for(let offset=0;;offset+=100){const page=await rt.api(`${path}&limit=100&offset=${offset}`);rows.push(...page);if(page.length<100)return rows;}}
export async function readClassificationSnapshot(proposal,rt=window.KPTURuntime) {
  const context=rt.context.read(),workspaceId=context?.workspace?.id,userId=context?.user?.id;if(!workspaceId||!userId)throw Error('업무 공간을 확인할 수 없습니다.');
  const ids=proposal.items.map(item=>item.note_id).join(',');
  // Query exact note IDs with RLS, so a visible note in another owned workspace
  // can be distinguished from a missing/inaccessible note without broad reads.
  const [notes,links,projects,organizations]=await Promise.all([
    ids?readPages(`/rest/v1/app_notes?id=in.(${ids})&kind=eq.basket&select=id,workspace_id,raw_text,updated_at,archived_at,ai_export_allowed&order=id.asc`,rt):[],
    ids?readPages(`/rest/v1/app_record_links?note_id=in.(${ids})&select=id,note_id,status,summary,organization_id,project_id&order=id.asc`,rt):[],
    readPages('/rest/v1/app_spaces?select=id,workspace_id,owner_id,name,parent_id,status,metadata,sort_order,created_at&order=id.asc',rt),
    readPages('/rest/v1/app_suborganizations?select=id,workspace_id,name&order=id.asc',rt)
  ]);return {workspaceId,userId,notes,links,projects,organizations};
}
export async function confirmLinks(noteId,updatedAt,targets,rt=window.KPTURuntime) {
  try{return await rt.api('/rest/v1/rpc/app_basket_confirm_links',{method:'POST',body:{p_note_id:noteId,p_note_updated_at:updatedAt,p_targets:targets.map(t=>({kind:t.kind,target_id:t.target_id,reason:t.reason,...(Object.hasOwn(t,'summary')?{summary:t.summary}:{})}))}});}
  catch(error){if(error?.status===404||/PGRST202|Could not find the function|function .*app_basket_confirm_links.*does not exist/i.test(error?.message||''))return {ok:false,error:'FUNCTION_UNAVAILABLE',created:0,existing:0};throw error;}
}
