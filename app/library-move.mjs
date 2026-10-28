// LIB-최근올린파일·폴더로옮기기 (2026-10-27 17:01 사용자 요청): 순수 함수(화면·네트워크 없음).
// ① 최근 올린 파일 칸: 서버에 있는 올린 시각(app_documents.created_at) 기준 최신 몇 개, 줄에 보일 시각 글자, 최근 3일 '새' 표시.
// ② 옮길 곳 목록: 자료 하나(또는 여럿)를 넣을 수 있는 폴더 줄(최근 넣은 폴더 먼저, 폴더 찾기, 들여쓰기, 프로젝트 틀이 다르면 흐리게 + 이유).
// ③ 최근 넣은 폴더 기억 목록(최대 5개, 맨 앞이 가장 최근). 저장은 library-view-pref.js(서버 app_profiles.library_view.recent_folders)가 한다.
// 옮기는 서버 길은 library-folders.js(LIB-폴더탐색기와 같은 app_library_folder_items 쓰기) 하나이고, 여기는 목록만 만든다.
import {folderDepth,folderSiblings} from './library-tree.js';
import {folderIndent} from './folder-limits.mjs';

export const RECENT_UPLOAD_LIMIT=5,RECENT_UPLOAD_MORE=15,NEW_DAYS=3,RECENT_FOLDER_MAX=5;
const DAY=24*3600*1000;

// 올린 시각(ms). 값이 없거나 읽을 수 없으면 NaN.
export const uploadedAt=d=>Date.parse(d?.created_at||'');
// 최근 3일 안에 올렸나(미래 시각은 새로 보지 않는다).
export function isNewUpload(d,now=Date.now()){const t=uploadedAt(d);return Number.isFinite(t)&&t<=now+60000&&now-t<NEW_DAYS*DAY}
// 올린 시각이 있는 자료를 최신 순으로 limit개. 같은 시각이면 id 순(항상 같은 차례).
export function recentUploads(docs,{limit=RECENT_UPLOAD_LIMIT}={}){
  return (docs||[]).map(d=>({d,t:uploadedAt(d)})).filter(x=>Number.isFinite(x.t)).sort((a,b)=>b.t-a.t||String(a.d.id).localeCompare(String(b.d.id))).slice(0,Math.max(0,limit)).map(x=>x.d);
}
const two=n=>String(n).padStart(2,'0');
const ymd=date=>date.getFullYear()*10000+(date.getMonth()+1)*100+date.getDate();
// 줄에 보일 올린 시각: 오늘 14:05 / 어제 14:05 / 10.25 14:05 (보는 사람의 시간대).
export function uploadTimeLabel(d,now=Date.now()){
  const t=uploadedAt(d);if(!Number.isFinite(t))return '';
  const at=new Date(t),today=new Date(now),yesterday=new Date(now-DAY),clock=two(at.getHours())+':'+two(at.getMinutes());
  if(ymd(at)===ymd(today))return '오늘 '+clock;
  if(ymd(at)===ymd(yesterday))return '어제 '+clock;
  return two(at.getMonth()+1)+'.'+two(at.getDate())+' '+clock;
}

// ---- 최근 넣은 폴더 ----
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isFolderId=v=>typeof v==='string'&&UUID.test(v);
// 폴더 id를 맨 앞에 두고 중복·넘침을 정리한다(원본은 바꾸지 않음).
export function rememberFolder(list,id,max=RECENT_FOLDER_MAX){
  if(!isFolderId(id))return [...(list||[])].filter(isFolderId).slice(0,max);
  return [id,...(list||[]).filter(x=>x!==id&&isFolderId(x))].slice(0,max);
}
// 서버 값 → 쓸 수 있는 목록(모양이 틀린 것은 버린다).
export function cleanRecentFolders(list,max=RECENT_FOLDER_MAX){
  if(!Array.isArray(list))return [];
  const out=[];for(const x of list){if(isFolderId(x)&&!out.includes(x))out.push(x);if(out.length>=max)break}
  return out;
}

// ---- 옮길 곳 목록 ----
// folders: 폴더 행 {id,project_id,parent_id,name,sort_order}. docs: 옮길 자료 {id,project_id}. itemFolder: Map(자료 id → 지금 폴더 id, 연결된 것만).
// free: 폴더 묶기(프로젝트 틀을 보지 않음). free가 아니면 자료의 프로젝트 틀과 같은 폴더에만 넣을 수 있고 나머지는 흐리게(enabled=false) 보인다.
// recent: 최근 넣은 폴더 id 목록. query: 폴더 찾기 글자(폴더 경로 이름에서 찾음).
// 돌려주는 줄: {id,name,label(경로),depth,enabled,current,reason,recent}. recent 칸이 먼저, all 칸은 트리 차례(상위 → 그 안).
export const FRAME_REASON='프로젝트가 달라 넣을 수 없어요';
export const MIXED_REASON='프로젝트가 다른 자료가 섞여 있어요';
export function pickerRows({folders=[],docs=[],itemFolder=new Map(),free=false,recent=[],query=''}){
  const byId=new Map(folders.map(f=>[f.id,f]));
  const frames=new Set(docs.map(d=>d.project_id||null));
  const pathOf=id=>{const out=[];let f=byId.get(id),guard=0;while(f&&guard++<6){out.unshift(f.name);f=f.parent_id?byId.get(f.parent_id):null}if(f)out.unshift('…');return out.join(' › ')};// LIB-폴더100단: 가까운 6단만, 더 깊으면 앞을 '…'로
  const row=f=>{
    const frameOk=free||(frames.size===1&&frames.has(f.project_id||null));
    const current=docs.length>0&&docs.every(d=>itemFolder.get(d.id)===f.id);
    return {id:f.id,name:f.name,label:pathOf(f.id),depth:folderIndent(folderDepth(folders,f.id)-1),enabled:frameOk&&!current,current,reason:frameOk?'':(frames.size>1?MIXED_REASON:FRAME_REASON),recent:false};
  };
  const all=[];
  const walk=parent=>{for(const f of folderSiblings(folders,{free:true,parentId:parent})){all.push(row(f));walk(f.id)}};
  walk(null);
  const rank=new Map(cleanRecentFolders(recent).map((id,i)=>[id,i]));
  const q=String(query||'').trim().toLowerCase();
  const matches=q?all.filter(r=>r.label.toLowerCase().includes(q)):all;
  const recents=matches.filter(r=>rank.has(r.id)).sort((a,b)=>rank.get(a.id)-rank.get(b.id)).map(r=>({...r,recent:true,depth:0}));
  // 찾는 중에는 경로 이름을 그대로 보이고(들여쓰기 없이), 안 찾을 때는 트리 모양으로 들여쓴다.
  const rest=q?matches.map(r=>({...r,depth:0})):matches;
  return {recent:recents,all:rest,total:all.length,frameLimited:!free&&all.some(r=>!r.enabled&&r.reason)};
}
