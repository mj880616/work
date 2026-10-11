// Untrusted AI proposals live only in memory. Never render reason as markup.
export const CLASSIFICATION_LIMITS = Object.freeze({bytes:1048576, items:100, targets:20, reason:2000, depth:6});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kinds = new Set(['organization','project','library','write_request_candidate','google_task']);
export const ERROR_TEXT = Object.freeze({NOTE_MISSING:'메모 없음 또는 접근 불가',NOTE_WORKSPACE:'메모가 다른 workspace에 있습니다.',NOTE_ARCHIVED:'보관된 메모입니다.',AI_EXCLUDED:'AI 제외 메모입니다.',NOTE_CHANGED:'원문 바뀜: 다시 분류해 주세요.',TARGET_MISSING:'목적지 없음 또는 접근 불가',TARGET_WORKSPACE:'목적지가 다른 workspace에 있습니다.',TARGET_UNSELECTABLE:'현재 선택할 수 없는 목적지입니다.',ALREADY_CONFIRMED:'이미 확정',NEXT_STAGE:'다음 단계에서 지원(4b)',FUNCTION_UNAVAILABLE:'확정 기능 준비 중',INVALID_TARGETS:'목적지 형식을 확인해 주세요.',INVALID_INPUT:'메모 ID와 시각을 확인해 주세요.',PERMISSION_DENIED:'접근 권한을 확인해 주세요.',SUGGESTED_EXISTS:'기존 제안 연결이 있습니다. 연결을 확인해 주세요.'});
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
    space();if(depth>6)fail('중첩은 6단계까지 허용합니다.');
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
    for(const target of item.destinations){shape(target,['kind','target_id','reason'],['kind','reason']);check(kinds.has(target.kind),'모르는 kind',target,'kind');
      check(typeof target.reason==='string'&&[...target.reason].length>=1&&[...target.reason].length<=2000,'이유는 1~2,000자입니다.',target,'reason');
      if(['organization','project'].includes(target.kind))check(typeof target.target_id==='string'&&uuid.test(target.target_id),'목적지 UUID 형식 오류',target,'target_id');
      else if(target.target_id!==undefined&&target.target_id!==null)check(typeof target.target_id==='string'&&/^[A-Za-z0-9_-]{1,255}$/.test(target.target_id),'4b 대상 ID 형식 오류',target,'target_id');
      if(typeof target.target_id==='string'&&uuid.test(target.target_id))target.target_id=target.target_id.toLowerCase();
    }
  }
  // Ordinary JSON objects leave the parser; internal objects protect __proto__ keys.
  return JSON.parse(JSON.stringify(data));
}
export function selectableProjects(projects) {
  const included=new Set(projects.filter(p=>p.metadata?.project_system==='v2'||Number(p.metadata?.management_version)===2).map(p=>p.id));
  let changed=true;while(changed){changed=false;for(const p of projects)if(included.has(p.parent_id)&&!included.has(p.id)){included.add(p.id);changed=true;}}
  const rows=projects.filter(p=>included.has(p.id)),visible=new Set();
  function walk(p){if(visible.has(p.id)||p.status==='archived')return;visible.add(p.id);rows.filter(c=>c.parent_id===p.id).forEach(walk);}
  rows.filter(p=>!p.parent_id||!rows.some(parent=>parent.id===p.parent_id)).forEach(walk);return visible;
}
export function previewClassification(proposal,{workspaceId,userId,notes,links,projects,organizations}) {
  const visible=selectableProjects(projects.filter(p=>p.workspace_id===workspaceId&&p.owner_id===userId));
  return proposal.items.map(item=>{
    const note=notes.find(n=>n.id===item.note_id);
    const error=!note?'NOTE_MISSING':note.workspace_id!==workspaceId?'NOTE_WORKSPACE':note.archived_at?'NOTE_ARCHIVED':note.ai_export_allowed!==true?'AI_EXCLUDED':timestampKey(note.updated_at)!==timestampKey(item.note_updated_at)?'NOTE_CHANGED':null;
    return {item,note,error,destinations:item.destinations.map(target=>{
      const supported=['organization','project'].includes(target.kind), rows=target.kind==='organization'?organizations:projects;
      const destination=supported?rows.find(d=>d.id===target.target_id):null;
      const targetError=!supported?'NEXT_STAGE':!destination?'TARGET_MISSING':destination.workspace_id!==workspaceId?'TARGET_WORKSPACE':target.kind==='project'&&!visible.has(destination.id)?'TARGET_UNSELECTABLE':links.some(l=>l.note_id===item.note_id&&l.status==='confirmed'&&l[target.kind==='project'?'project_id':'organization_id']===target.target_id)?'ALREADY_CONFIRMED':null;
      return {...target,name:destination?.name||target.kind,error:!supported?'NEXT_STAGE':error||targetError};
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
    ids?readPages(`/rest/v1/app_notes?id=in.(${ids})&select=id,workspace_id,raw_text,updated_at,archived_at,ai_export_allowed&order=id.asc`,rt):[],
    ids?readPages(`/rest/v1/app_record_links?note_id=in.(${ids})&select=note_id,status,organization_id,project_id&order=id.asc`,rt):[],
    readPages('/rest/v1/app_spaces?select=id,workspace_id,owner_id,name,parent_id,status,metadata&order=id.asc',rt),
    readPages('/rest/v1/app_suborganizations?select=id,workspace_id,name&order=id.asc',rt)
  ]);return {workspaceId,userId,notes,links,projects,organizations};
}
export async function confirmLinks(noteId,updatedAt,targets,rt=window.KPTURuntime) {
  try{return await rt.api('/rest/v1/rpc/app_basket_confirm_links',{method:'POST',body:{p_note_id:noteId,p_note_updated_at:updatedAt,p_targets:targets.map(t=>({kind:t.kind,target_id:t.target_id,reason:t.reason}))}});}
  catch(error){if(error?.status===404||/PGRST202|Could not find the function|function .*app_basket_confirm_links.*does not exist/i.test(error?.message||''))return {ok:false,error:'FUNCTION_UNAVAILABLE',created:0,existing:0};throw error;}
}
