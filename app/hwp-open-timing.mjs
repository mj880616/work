// LIB-편집열기느림: 자료실 [편집]이 열리기까지 단계별 걸린 시간(밀리초)을 상태 글 끝에 붙일 짧은 글로 만든다. 숫자만 쓴다(파일 이름·내용 없음).
// lap = {file(파일 받음), editor(편집기 준비됨), load(문서 펼침), total(전체)}. 3초 안에 열렸으면 붙이지 않는다.
export const TIMING_SHOW_AFTER_MS = 3000;
const sec = ms => (Math.max(0, ms) / 1000).toFixed(1);
export function openTimingText(lap = {}) {
  const total = Number(lap.total);
  if (!Number.isFinite(total) || total < TIMING_SHOW_AFTER_MS) return '';
  const parts = [['파일', lap.file], ['HWP 편집', lap.editor], ['펼침', lap.load]]
    .filter(([, v]) => Number.isFinite(Number(v)) && v != null)
    .map(([name, v]) => `${name} ${sec(Number(v))}초`);
  return ` (걸린 시간: ${parts.join(' · ')} · 전체 ${sec(total)}초)`;
}
