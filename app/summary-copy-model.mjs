// 요약 복사 글 만들기(공용 순수 규칙): 통화·텔레그램 소식 같은 AI 요약 화면의 [요약 복사]가 클립보드에 넣는 글.
// 제목 줄, 날짜 줄, 빈 줄, 요약 본문 순서. 본문이 비면 복사할 글이 없다('').
import {readPoints} from './feed-model.mjs';

const clean = value => String(value ?? '').trim();

export function summaryCopyText({title = '', meta = '', body = []} = {}) {
  const lines = (Array.isArray(body) ? body : [body]).map(clean).filter(Boolean);
  if (!lines.length) return '';
  const head = [title, meta].map(clean).filter(Boolean);
  return (head.length ? [...head, ''] : []).concat(lines).join('\n');
}

// 통화 핵심내용: 한 줄씩 "- 글", [확정]·[예정]·[확인] 머리표는 화면처럼 글 뒤에 붙인다.
export const pointCopyLines = points => readPoints(points).map(p => `- ${p.text}${p.tag ? ` [${p.tag}]` : ''}`);

// 통화: 제목 줄 = 화면의 상대 표기(조직 · 사람 직함) · 주제, 날짜 줄 = "10. 25. (일) 10:30".
export function callCopyText({who = '', title = '', dayText = '', time = '', points = []} = {}) {
  return summaryCopyText({title:[clean(who), clean(title) || '(제목 없음)'].filter(Boolean).join(' · '), meta:[dayText, time].map(clean).filter(Boolean).join(' '), body:pointCopyLines(points)});
}
