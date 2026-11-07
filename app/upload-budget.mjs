// UPLOAD-올리기안됨(S52-13): 파일 올리기 시간 한도 한 곳.
// 불러오기(읽기)의 기본 한도(runtime-client.js config.timeoutMs 15초, load-deadline.js 30초)는 올리기에 쓰지 않는다.
// 올리기는 파일 크기에 맞춘 한도: 서버 처리(Drive 중계·DB 기록) 여유 90초 + 느린 업링크(약 2Mbps) 기준 MB당 4초, 최대 10분.
// 100MB 파일은 약 8분 10초. 올리기를 부르는 곳(노트·일기·업데이트·담당조직 기록 첨부, 자료실, 할 일 첨부, 회의 파일)은 모두 이 값을 쓴다.
// 나중에 올리는 중 표시(UI-올리기진행표시)도 이 파일 옆에서 같은 길로 붙인다. 기기 저장 없음.
export const UPLOAD_BASE_MS = 90000;
export const UPLOAD_MS_PER_MB = 4000;
export const UPLOAD_MAX_MS = 600000;

export function uploadTimeoutMs(size) {
  const bytes = Math.max(0, Number(size) || 0);
  return Math.min(UPLOAD_MAX_MS, UPLOAD_BASE_MS + Math.ceil(bytes / 1048576) * UPLOAD_MS_PER_MB);
}
