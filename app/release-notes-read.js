// UI-업데이트기록입구: 배포물 app/release-notes.json(빌드가 만든 공개 파일) 읽기 한 곳. 업데이트 기록 화면(release-notes-ui.js)과
// 계정 메뉴 [업데이트 기록] 줄의 판 이름(topbar-actions.js)이 함께 쓴다. 서버·기기 저장 없음(이 탭 메모리에 한 번).
import {parseReleaseNotes} from './release-notes-model.mjs';

let reading=null;
/** 이번 배포의 기록. 못 읽으면 null이고 다음 부름 때 다시 읽는다. */
export function readReleaseNotes(){
  if(reading)return reading;
  const url=new URL('./release-notes.json',import.meta.url);
  // 배포마다 이 모듈 주소(내용 해시)가 바뀌므로 그 값을 붙여 Pages 보관본 대신 이번 배포의 기록을 받는다.
  const deploy=new URL(import.meta.url).searchParams.get('v');if(deploy)url.searchParams.set('d',deploy);
  const flight=fetch(url.href,{cache:'no-store'}).then(async res=>res.ok?parseReleaseNotes(await res.json()):null).catch(()=>null)
    .then(list=>{if(!list&&reading===flight)reading=null;return list});
  reading=flight;
  return flight;
}
