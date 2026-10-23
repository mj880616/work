// 사업 보고 결과 창 열기. report-links.js와 나눈 이유: 결과 창(meeting-round-detail.js)이 report-links.js를 불러오므로 같은 파일에서 다시 부르면 순환이 된다.
// 사업 보고 결과 창을 연다(프로젝트·조직 화면 위에 겹쳐 열림, 프로젝트 화면의 회의 열기와 같은 길).
export async function openReport(id){
  await window.KPTUViewLoader?.prepare?.('meetings');
  await import('./meeting-round-detail.js');
  if(!(await window.__KPTU_MEETING_ROUND_DETAIL_READY__))throw new Error('report detail unavailable');
  await window.KPTUMeetingRoundDetail.open(id);
}
