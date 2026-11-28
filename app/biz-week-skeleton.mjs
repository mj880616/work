// BIZ-주간칸밀림: 사업 보고 위 '이번 주 주간보고' 칸이 표가 그려지기 전에 차지하는 표 모양 자리.
// 진짜 표와 같은 머리글·같은 제목 글자·같은 칸 폭을 써서 글꼴이 달라도(줄바꿈이 달라도) 높이가 따라간다. 줄 높이는 진짜 표 한 줄(29px, meeting-ui.css)과 같다(WEEKLY-화면정돈 ②: 칸 [쓰기] 단추가 없어짐).
// 쓰는 곳은 weekly-summary-table.js drawPaper 하나 — 사업영역이 있다고 확인된 칸에만 그린다(BIZ-빈표잠깐보임다시: index.html에는 표 모양을 두지 않음, tests/biz-week-skeleton.test.mjs가 검사).
import {word} from './brand/brand.mjs';
export const SKELETON_ROWS = 4;
const row = i => `<tr><th scope="rowgroup"></th><td></td><td></td><td></td></tr>`;
export const paperSkeletonHtml = () => word`<div class="biz-skel" aria-hidden="true"><h3>1) 사업요약표</h3><table class="biz-skel-table"><thead><tr><th scope="col">사업영역</th><th scope="col">세부 과제</th><th scope="col">진행 상황 및 이후 계획</th><th scope="col">담당</th></tr></thead><tbody>${Array.from({length: SKELETON_ROWS}, row).join('')}</tbody></table><h3>2) 주요 사업·회의결과</h3><ul class="biz-detail-list"><li><p class="biz-skel-line"></p></li></ul></div>`;
// 아래 [주간 보고에서 보기 ›] 자리: 부품은 진짜 버튼(footHtml)을 넘긴다. 넘기지 않으면 누를 수 없는 같은 모양 글자(span).
export const FOOT_SKELETON = '<span class="biz-week-go" aria-hidden="true">주간 보고에서 보기 ›</span>';
export const weekBodyHtml = (footHtml = FOOT_SKELETON) => `<div class="biz-paper biz-week-paper" data-bp-paper>${paperSkeletonHtml()}</div><p class="status biz-week-status" data-bp-status role="status" aria-live="polite"></p><div class="biz-week-foot">${footHtml}</div>`;
