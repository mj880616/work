// UI-업데이트기록입구 → UPDATE-운영자전용기록업데이트소식 PR1(사용자 11/15): 개발 기록 '업데이트 기록'은 운영자만 본다.
// 읽기는 서버 함수 app_release_notes_read 하나(운영자 기능 dev_inbox 작업공간 owner만, 아니면 서버가 42501로 거절 — 화면 숨김이 막는 게 아님).
// 기록 파일은 더는 공개 배포물에 없다(scripts/build-pages.mjs). 업데이트 기록 화면(release-notes-ui.js)·계정 메뉴 판 이름(topbar-actions.js)·
// 운영자 새 판 안내(version-notice.js)가 함께 쓴다. 기기 저장 없음(이 탭 메모리에 한 번).
import {parseReleaseNotes} from './release-notes-model.mjs';
import {hasFeature} from './my-features.js';

/** 운영자 개발 기능 키. 서버 허용 표(app_operator_features)가 정한다. 화면은 줄을 그릴지 정하는 데만 쓴다. */
export const RELEASE_NOTES_FEATURE='dev_inbox';
export const canReadReleaseNotes=(rt=window.KPTURuntime)=>hasFeature(rt,RELEASE_NOTES_FEATURE).catch(()=>false);

let reading=null;
/** 서버의 기록. 못 읽거나 운영자가 아니면 null이고 다음 부름 때 다시 읽는다. fresh면 이 탭에 기억한 것 대신 새로 읽는다. */
export function readReleaseNotes({fresh=false}={}){
  if(reading&&!fresh)return reading;
  const rt=window.KPTURuntime;
  const flight=Promise.resolve().then(()=>rt.api('/rest/v1/rpc/app_release_notes_read',{method:'POST',body:{},singleFlight:false}))
    .then(value=>value?parseReleaseNotes(value):null).catch(()=>null)
    .then(list=>{if(!list&&reading===flight)reading=null;return list});
  reading=flight;
  return flight;
}
if(typeof window!=='undefined')window.addEventListener?.('kptu:session-changed',()=>{reading=null});
