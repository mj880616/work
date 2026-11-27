// HOME-오늘사진은사진으로(S73-07): 다른 화면(홈 '오늘 사진' 칸)이 [사진] 화면을 "그날, 그 사진"으로 열어 달라는 한 번짜리 요청.
// 일기 화면의 requestDiaryDay/takeRequestedDay와 같은 모양이다. 요청은 쓰는 사람(scope)이 같을 때만 받고, 한 번 받으면 지운다.
let requested = null;
export function requestPhotoDay(day, {key = '', scope = ''} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return;
  requested = {day:String(day), key:String(key || ''), scope:String(scope || '')};
}
export function takePhotoDay(scope = '') {
  const value = requested;
  requested = null;
  return value && value.scope === String(scope || '') ? {day:value.day, key:value.key} : null;
}
