// NOTE-탐색기 ③(2026-10-28 09:24): 새 노트를 저장한 뒤 한 번, 서버(ai-assist kind=note_title)에 AI 요약 제목을 부탁한다. 노트 ID만 보낸다.
// 서버가 만들지 말지 정한다(직접 쓴 제목·AI 제외·보관·비밀번호 모양 글·이미 만듦이면 AI를 부르지 않음, 월 AI 상한·사용량 줄 안).
// 기다리지 않는다: 실패·배포 전(not_ready)·건너뜀은 조용히 넘어가고, 제목이 생기면 노트 목록을 다시 읽게 알린다. 기기 저장 없음.
import {callAiAssist} from './basket-ai-summary.js';

export function requestNoteAiTitle(id, {rt = globalThis.window?.KPTURuntime, call = callAiAssist, notify = () => globalThis.window?.dispatchEvent?.(new CustomEvent('kptu:basket-notes-restored'))} = {}) {
  if (typeof id !== 'string' || !id) return Promise.resolve(null);
  return Promise.resolve().then(() => call({kind: 'note_title', id}, {rt})).then(r => {
    const title = r?.ok && typeof r.data?.title === 'string' ? r.data.title : null;
    if (title) notify();
    return title;
  }).catch(() => null);
}
