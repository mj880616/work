// APP-낭비줄이기 ①: 사업 보고·자료실 목록은 화면이 쓰는 열만 받는다(select=*는 회의록 전문·자료 본문 글자까지 딸려 왔다).
// 목록 열은 코드에서 쓰는 열을 전수 확인해 고른 것이다(PR 본문 표). 본문이 필요한 곳은 따로 받는다:
//  - 회의 상세(meeting-round-detail.js)·AI 창(workflow-ai-v3.js)은 열 때 한 건을 select=*로 읽는다.
//  - 사업영역 달기 AI 추천(report-area-tag.js)은 추천 직전 그 줄의 글을 읽는다.
//  - 목록의 '일시'는 저장 시각이 직접 고른 값이 아닐 때만 전문 앞부분에서 시각을 읽으므로(meeting-when.js) 그런 줄의 전문만 더 받는다.
//  - 자료 글자(extracted_text)는 서버(검색·AI)만 읽는다.
// 열이 서버에 없어 읽기가 거절되면(칸이 늘어나기 전 서버) 예전처럼 select=*로 한 번 더 읽는다.
import {storedTimeIsSet} from './meeting-when.js';

export const MEETING_LIST_FIELDS='id,workspace_id,title,series_name,round_no,meeting_at,activity_kind,project_id,business_area_id,business_area_none,location,attendees,next_plan,result_status,finalized_at,created_by,created_at,updated_at';
export const DOCUMENT_LIST_FIELDS='id,workspace_id,project_id,meeting_id,organization_id,title,category,source,document_date,description,tags,drive_url,file_id,file_name,mime_type,file_size,auto_classified,classification_note,field_origin,previous_files,reclassify_needed,extraction_status,created_at,updated_at';
const MEETING_ORDER='order=meeting_at.desc';
const DOCUMENT_ORDER='order=document_date.desc.nullslast,created_at.desc';
const TEXT_CHUNK=40;

export const isColumnRefused=error=>{
  if(Number(error?.status)===400)return true;
  return /column|schema cache|PGRST204|42703/i.test(String(error?.message||error?.code||''));
};

async function readWithFallback(api,base,fields,order){
  try{return await api(`${base}&select=${fields}&${order}`)}
  catch(error){if(!isColumnRefused(error))throw error;return api(`${base}&select=*&${order}`)}
}

// LIB-연결줄다읽기(11/24): 서버는 한 번에 1000줄까지만 돌려준다(Supabase max rows). 자료가 1000개를 넘으면 나머지가 화면에서 빠지므로
// 1000줄씩 이어 읽는다(같은 순서 + id로 끊김 없이). 열이 거절되면 처음 한 번만 select=*로 바꿔 같은 방식으로 읽는다.
export const DOCUMENT_PAGE=1000;
export async function readDocuments(api,workspaceId,{page=DOCUMENT_PAGE,max=100000}={}){
  const base='/rest/v1/app_documents?workspace_id=eq.'+workspaceId,order=DOCUMENT_ORDER+',id.asc';
  let fields=DOCUMENT_LIST_FIELDS;const out=[];
  for(let from=0;from<max;from+=page){
    const tail=`&${order}&limit=${page}&offset=${from}`;
    let rows;
    try{rows=await api(`${base}&select=${fields}${tail}`)}
    catch(error){if(fields==='*'||!isColumnRefused(error))throw error;fields='*';rows=await api(`${base}&select=*${tail}`)}
    const list=Array.isArray(rows)?rows:[];out.push(...list);
    if(list.length<page)break;
  }
  return out;
}

// 직접 고른 시각이 없는 줄(0시·초가 있는 값)만 전문이 필요하다. 그 줄의 번호만 모아 transcript_text를 더 받아 붙인다.
async function addTimeText(api,workspaceId,rows){
  if(!Array.isArray(rows))return rows;
  const need=rows.filter(m=>m&&m.id&&m.transcript_text===undefined&&Number.isFinite(Date.parse(m.meeting_at))&&!storedTimeIsSet(m.meeting_at));
  if(!need.length)return rows;
  const chunks=[];for(let i=0;i<need.length;i+=TEXT_CHUNK)chunks.push(need.slice(i,i+TEXT_CHUNK).map(m=>m.id));
  const pages=await Promise.all(chunks.map(ids=>api('/rest/v1/app_meetings?workspace_id=eq.'+workspaceId+'&id=in.('+ids.map(encodeURIComponent).join(',')+')&select=id,transcript_text')));
  const text=new Map();for(const page of pages)for(const row of page||[])text.set(row.id,row.transcript_text);
  for(const m of need)if(text.has(m.id))m.transcript_text=text.get(m.id);
  return rows;
}

export async function readMeetings(api,workspaceId){
  const rows=await readWithFallback(api,'/rest/v1/app_meetings?workspace_id=eq.'+workspaceId,MEETING_LIST_FIELDS,MEETING_ORDER);
  return addTimeText(api,workspaceId,rows);
}

// 사업영역 달기 AI 추천 한 줄 분(전문·결정·특이사항). 읽지 못하면 빈 글.
export async function readMeetingBody(api,workspaceId,id){
  try{const rows=await api('/rest/v1/app_meetings?id=eq.'+encodeURIComponent(id)+'&workspace_id=eq.'+encodeURIComponent(workspaceId)+'&select=transcript_text,decisions,notes&limit=1');return rows?.[0]||{}}
  catch{return {}}
}
