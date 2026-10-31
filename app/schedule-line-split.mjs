// WEEKLY-장소칸(요청함 10/31 00:28, 명진 결정 추천안대로): 한 줄 모양('10:30 / 제목 / 장소')으로 들어온 일정 제목을 칸별로 나눠 읽는다.
// 달력 제목·주간보고 기억(app_profiles.weekly_schedule_memory)·임시저장(draft.titles)·수기 줄(draft.hq)에 예전 한 줄 모양이 섞여 있으면
// 제목 칸에 시간·장소가 통째로 보이고 한글 파일 칸이 '종일 / 10:30 / … / 미정'이 된다. 저장된 값은 고치지 않고 읽을 때만 나눈다
// (화면에서 고쳐 저장하면 그때 나뉜 모양으로 저장된다). 화면 없는 부분, 브라우저 저장소 없음.
// 규칙: 제목이 '시각 / …'로 시작할 때만 나눈다(제목 안의 '/'는 흔하므로 시각이 없으면 그대로).
//   - 시간 칸: 비었거나 '종일'이면 제목 앞 시각으로. 다른 시각이 이미 있으면 그 시각을 둔다.
//   - 제목 칸: 시각 뒤 부분. 셋 이상이면 마지막이 장소, 가운데가 제목.
//   - 장소 칸: 비었으면 마지막 부분, 이미 다른 장소가 있으면 그대로(그때 마지막 부분은 제목에 남긴다).
const ALL_DAY = '종일';
const one = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const pad = n => String(n).padStart(2, '0');
function lineTime(s) {
  if (s === ALL_DAY) return ALL_DAY;
  const x = /^(\d{1,2})[:.](\d{2})$/.exec(s);
  if (!x || +x[1] > 23 || +x[2] > 59) return null;
  return `${pad(+x[1])}:${pad(+x[2])}`;
}
// '10:30 / 제목 / 장소' → {time, title, place}, 한 줄 모양이 아니면 null.
export function parseScheduleLine(text) {
  const parts = one(text).split(/\s*\/\s*/);
  if (parts.length < 2 || parts.some(p => !p)) return null;
  const time = lineTime(parts[0]);
  if (!time) return null;
  const rest = parts.slice(1);
  return rest.length >= 2 ? {time, title:rest.slice(0, -1).join(' / '), place:rest.at(-1)} : {time, title:rest[0], place:''};
}
// 칸 값 {time, title, place, ...} → 나눠 읽은 칸 값(나눌 것이 없으면 같은 값). 다른 칸(day·who 등)은 그대로 둔다.
export function splitScheduleFields(f) {
  const line = parseScheduleLine(f?.title);
  if (!line) return f;
  const time = one(f.time), place = one(f.place);
  const out = {...f, time:!time || time === ALL_DAY ? line.time : f.time};
  if (!place || place === line.place) { out.title = line.title; out.place = line.place || place; }
  else out.title = line.place ? `${line.title} / ${line.place}` : line.title;
  return out;
}
