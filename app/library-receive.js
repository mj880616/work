// LIB-받는폴더 (S59-11, 시안 docs/design/mockups/lib-receive-folder.html, 명진 11/11 "잡동사니 시안 ㄱ"):
// 폴더 하나를 '받는 폴더'로 켜 두면 폴더를 정하지 않고 자료실에 들어오는 자료가 저절로 그 폴더에 들어간다. 받는 폴더는 하나뿐이다.
// 저장 위치: 내 프로필 행의 library_receive_folder 칸(app_profiles, migration 20261111181000). 기존 owner RLS로 내 행의 이 칸만 읽고 쓴다.
//   library_view(보기 기억 JSON)에 넣지 않은 까닭: 그 칸은 묶기·칩을 바꿀 때마다 통째로 다시 쓰므로 다른 기기에서 켠 값을 지울 수 있다.
// 자료를 그 폴더에 넣는 일은 서버(넣기 뒤 트리거)가 한다: 새 자료마다 이 칸을 다시 읽고, 같은 작업공간·휴지통 아닌 폴더일 때만 넣는다.
//   화면이 보낸 폴더 id를 서버가 그대로 믿지 않는다. 이 모듈은 켜고 끄기·표시·'폴더 밖' 자료 세기만 한다(브라우저 기기 저장소는 쓰지 않음).
// 칸이 아직 없는 서버(적용 전)에서는 읽기·쓰기가 400 → 'pending'이고, 화면은 메뉴 줄을 숨기고 지금처럼 동작한다.
import {profileUrl} from './library-view-pref.js';

const FOLDER_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isReceiveId=v=>typeof v==='string'&&FOLDER_ID.test(v);
export const RECEIVE_MARK='받는 폴더';
export const RECEIVE_MENU='폴더 안 정한 자료 받기';

// {status:'ok', id:폴더 id|null} | {status:'pending'}(칸이 아직 없음) | {status:'error'}.
export async function readReceiveFolder(rt=globalThis.window?.KPTURuntime){
  const url=profileUrl(rt);if(!url)return {status:'error'};
  try{
    const rows=await rt.api(`${url}&select=library_receive_folder&limit=1`);
    if(!Array.isArray(rows)||rows.length!==1)return {status:'error'};
    const v=rows[0]?.library_receive_folder;
    if(v===null)return {status:'ok',id:null};
    return isReceiveId(v)?{status:'ok',id:v}:{status:'error'};
  }catch(error){return {status:error?.status===400?'pending':'error'}}
}
// id = 켤 폴더 id, null = 끄기. 없는 폴더면 서버(외래 키)가 거절한다.
export async function saveReceiveFolder(id,rt=globalThis.window?.KPTURuntime){
  const url=profileUrl(rt);
  if(!url||(id!==null&&!isReceiveId(id)))return {status:'error'};
  try{
    const saved=await rt.api(url,{method:'PATCH',prefer:'return=representation',body:{library_receive_folder:id},singleFlight:false});
    return Array.isArray(saved)&&saved.length===1&&(saved[0]?.library_receive_folder??null)===id?{status:'ok'}:{status:'error'};
  }catch(error){return {status:error?.status===400?'pending':'error'}}
}
// 화면이 쓸 받는 폴더: 저장된 id가 지금 보이는 폴더(휴지통·지워진 폴더 제외)에 있을 때만 그 폴더, 아니면 null.
// 휴지통에 넣은 받는 폴더는 서버도 무시한다(자료는 '폴더 밖'). 휴지통에서 되돌리면 다시 받는 폴더, 영구 삭제하면 서버가 칸을 비운다.
export function liveReceiveFolder(id,folders){
  if(!isReceiveId(id))return null;
  const f=(Array.isArray(folders)?folders:[]).find(x=>x?.id===id);
  return f?{id:f.id,name:String(f.name||'폴더')}:null;
}
// '폴더 밖' 자료: 폴더 연결 줄이 하나도 없는 자료(휴지통 폴더에 든 자료는 연결이 있어 빠진다 — 자료실 목록에서도 숨는 자료).
// 사진 묶음·같은 파일 묶음은 낱자료 단위로 센다(묶음 줄도 결국 낱자료를 옮긴다). 분류 칩으로 가린 자료도 센다(모두 옮김).
export function outsideDocuments(docs,items){
  const filed=new Set((Array.isArray(items)?items:[]).map(x=>x?.document_id).filter(Boolean));
  return (Array.isArray(docs)?docs:[]).filter(d=>d?.id&&!filed.has(d.id));
}
