// Google 일정 저장 안내(BUG-일정시간전환). 화면에는 "무엇이 됐고 무엇을 하면 되는지"를 한국어로만 보이고,
// 서버·Google 영어 원문은 detail(개발용, console)로만 남긴다.
// kind: 'rejected' = 서버가 저장 전에 거절했거나 Google이 요청을 거절함(일정은 바뀌지 않음, 바로 다시 저장해도 됨)
//       'unknown'  = 응답을 받지 못했거나 해석하지 못함(저장됐는지 모름, 다음 저장 전에 Google 상태를 먼저 확인)
const HANGUL=/[가-힣]/;
const TIME_REJECTED=/invalid (start|end) time|time range|start time|end time/i;
// The Edge function also answers 400 when its own request to Google broke or Google failed internally; that write may have landed.
const TRANSPORT=/sending request|connect|closed|reset|network|timed? ?out|fetch failed|dns|tls|backend error|internal error|unavailable/i;
export function googleSaveFailure(error,{create=false}={}){
  const raw=String(error?.message||error||'').trim(),status=Number(error?.status)||0,korean=HANGUL.test(raw),unchanged=create?'일정은 만들지 않았고':'일정은 바뀌지 않았고';
  if(status===401||error?.code==='session_required')return {kind:'rejected',detail:raw,text:'로그인이 풀려 저장하지 않았습니다. '+unchanged+' 입력은 유지했습니다. 다시 로그인한 뒤 저장해 주세요.'};
  // Otherwise a 400 comes from the Edge function's own check or from Google rejecting the whole request.
  if(status===400&&!TRANSPORT.test(raw)){
    const text=TIME_REJECTED.test(raw)?'Google 캘린더가 시작·종료 시각을 받지 않아 저장하지 않았습니다.':korean?'저장하지 않았습니다. '+raw:'Google 캘린더가 이 저장 요청을 받지 않았습니다.';
    return {kind:'rejected',detail:raw,text:text+' '+unchanged+' 입력은 유지했습니다. 입력을 확인해 다시 저장해 주세요. 계속 안 되면 Google 캘린더에서 직접 고쳐 주세요.'};
  }
  return {kind:'unknown',detail:raw,text:'저장 결과를 확인하지 못했습니다. 입력은 유지했습니다.'+(korean?' '+raw:'')};
}
export function unknownRetryText(buttonLabel){return ' ['+buttonLabel+']을 다시 누르면 Google에 저장된 상태를 먼저 확인합니다.'}
export function addressConfirmedText(calendarName,buttonLabel){return '앞선 저장의 위치를 확인했습니다. 일정은 지금 「'+(calendarName||'현재')+'」 캘린더에 있습니다. 내용 수정은 저장되지 않았을 수 있으니 입력을 확인한 뒤 ['+buttonLabel+']을 한 번 더 눌러 주세요.'}
export function calendarName(calendarId){const c=(window.__KPTU_GOOGLE_STATE__?.calendars||[]).find(x=>x.id===calendarId||(calendarId==='primary'&&x.primary));return c?.summary||''}
export function logSaveDetail(detail){if(detail)console.warn('Google 일정 저장 실패(개발용 원문):',detail)}
