// LIB-업로드완료알림 (2026-11-03): 자료가 올라가는 모든 길이 끝나면 쓰는 공용 알림 하나.
// UX-알림하나로(S59-21): 끝 알림은 하단바 위 한 줄(upload-progress.js announceDock) 하나에 쓴다 — 올리는 중 진행과 같은 자리라 다른 화면으로
// 옮겨 가도 보이고, 화면 위쪽 작은 알림(notify)과 둘로 뜨지 않는다. 여기는 글(upload-done-model.mjs)과 단추만 정한다.
// announceUploaded({done,names,failed,where,openId,retry,files}) — openId가 있으면 [열기](자료실에서 그 자료를 보여 줌), retry가 있으면 실패 때 [다시 올리기].
// files: 이 알림이 맡는 파일(그 파일의 화면 안 '실패 [다시]'·'✓ 완료' 줄은 그리지 않는다). 못 올린 것이 있으면 누를 때까지 남는다.
import {announceDock} from './upload-progress.js';
import {uploadDoneLine,uploadDoneMs} from './upload-done-model.mjs';
import {requestLibraryDocument} from './basket-library-send.js';

// 자료실에서 그 자료를 연다. 다른 화면에서 오면 자료실이 목록을 새로 읽은 뒤 그 줄을 보여 주도록 맡긴다(basket-library-send.js — 업무일지·바구니·
// 파일 화면이 자료를 열 때와 같은 길). 이미 자료실이면 그 자리에서 보여 준다. UX-올림보기그자료(S64-12): [보기]·[열기] 모두 이것 하나.
export async function openInLibrary(id){
  if(typeof id!=='string'||!id)return;
  const router=window.KPTURouter;
  if(router?.current!=='library'){requestLibraryDocument(id);await router?.go?.('library',{source:'delegated'});return}
  window.KPTULibrary?.reveal?.(id);
}
export function announceUploaded({done=0,names=[],failed=0,where='',openId='',retry=null,note='',files=[]}={}){
  const text=uploadDoneLine({done,names,failed,where});if(!text)return {close(){}};
  const actions=[];
  if(done&&openId)actions.push({label:'열기',aria:'올린 자료 열기',run:()=>{void openInLibrary(openId)}});
  if(failed&&typeof retry==='function')actions.push({label:'다시 업로드',aria:'못 올린 파일 다시 업로드',run:()=>retry()});
  return announceDock({text,note,actions,error:!!failed,ms:failed?0:uploadDoneMs({failed}),files});
}
