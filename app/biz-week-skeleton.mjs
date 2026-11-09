// BIZ-주간칸밀림: 사업 보고 위 '이번 주 주간보고' 칸이 표가 그려지기 전에 차지하는 표 모양 자리.
// 진짜 표와 같은 머리글·같은 제목 글자·같은 칸 폭을 써서 글꼴이 달라도(줄바꿈이 달라도) 높이가 따라간다. 줄 높이는 칸마다 [쓰기] 누름 자리(50px)와 같다.
// 쓰는 곳 둘: ① index.html의 #bizWeekBox 본문(모듈이 오기 전 첫 그림, tests/biz-week-skeleton.test.mjs가 같은 글인지 검사) ② weekly-summary-table.js ensureBox(같은 자리를 처음부터 그림).
export const SKELETON_ROWS = 4;
const row = i => `<tr><th scope="rowgroup"></th><td></td><td></td><td></td></tr>`;
export const paperSkeletonHtml = () => `<div class="biz-skel" aria-hidden="true"><h3>1) 사업요약표</h3><table class="biz-skel-table"><thead><tr><th scope="col">사업영역</th><th scope="col">세부 과제</th><th scope="col">진행 상황 및 이후 계획</th><th scope="col">담당</th></tr></thead><tbody>${Array.from({length: SKELETON_ROWS}, row).join('')}</tbody></table><h3>2) 주요 사업·회의결과</h3><ul class="biz-detail-list"><li><p class="biz-skel-line"></p></li></ul></div>`;
export const weekBodyHtml = () => `<div class="biz-paper biz-week-paper" data-bp-paper>${paperSkeletonHtml()}</div><p class="status biz-week-status" data-bp-status role="status" aria-live="polite"></p><div class="biz-week-foot"><button type="button" class="biz-week-go" data-bw-journal>주간 정리에서 보기 ›</button></div>`;
