// HWP-편집기 메뉴 입구: 다른 화면이 고른 파일 하나를 자료실 [+ 자료 등록] 창에 채워 넘기는 1회용 요청.
// 업로드는 기존 자료실 등록 흐름(library-upload.js → library-files)이 그대로 하고, 여기서는 아무것도 보내지 않는다.
// 로그인 사용자·업무공간에 묶이고 곧 만료된다(basket-library-send.js의 자료실 hand-off와 같은 방식). 메모리에만 둔다.
const REQUEST_MS=60*1000;
let pending=null;
const scopeOf=rt=>{const c=rt?.context?.read?.();return c?.user?.id&&c?.workspace?.id?`${c.user.id}:${c.workspace.id}`:'';};
export function requestLibraryUpload(file,rt=window.KPTURuntime){
  const scope=scopeOf(rt);
  pending=file instanceof File&&file.size>0&&scope?{file,scope,at:Date.now()}:null;
  return !!pending;
}
export function takeLibraryUploadRequest(rt=window.KPTURuntime){
  const value=pending;pending=null;
  return value&&value.scope===scopeOf(rt)&&Date.now()-value.at<REQUEST_MS?value.file:null;
}
