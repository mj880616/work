// LIB-업로드완료알림 (2026-11-03): 자료가 올라가는 모든 길이 끝나면 쓰는 공용 알림 하나.
// 앱 공용 작은 알림(small-notice.js notify)이라 올리는 동안 다른 화면으로 옮겨 가도 그 화면 위에 뜬다.
// announceUploaded({done,names,failed,where,openId,retry}) — openId가 있으면 [열기](자료실에서 그 자료를 보여 줌), retry가 있으면 실패 때 [다시].
import {notify} from './small-notice.js';
import {uploadDoneLine,uploadDoneMs} from './upload-done-model.mjs';

async function openInLibrary(id){
  const router=window.KPTURouter;
  if(router?.current!=='library')await router?.go?.('library');
  const loader=window.KPTUViewLoader;if(loader?.load&&!loader.isLoaded?.('library'))await loader.load('library');
  window.KPTULibrary?.reveal?.(id);
}
export function announceUploaded({done=0,names=[],failed=0,where='',openId='',retry=null,doc=globalThis.document}={}){
  const text=uploadDoneLine({done,names,failed,where});if(!text)return {close(){}};
  const actions=[];
  if(done&&openId)actions.push({label:'열기',run:({close})=>{close();void openInLibrary(openId)}});
  if(failed&&typeof retry==='function')actions.push({label:'다시',run:({close})=>{close();retry()}});
  return notify(text,{actions,error:!!failed&&!done,ms:uploadDoneMs({failed}),record:false,doc});
}
