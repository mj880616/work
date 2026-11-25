// TG-발언자이름 4단계: 보낸 사람 이름표의 읽기(소유자 RLS REST)와 쓰기(DB 함수 4개). docs/design/telegram-sender-names.md 2절.
// 읽기: app_tg_senders(사람)·app_tg_day_senders(방·날짜·라벨 → 사람). 쓰기는 표에 직접 하지 않고 app_tg_sender_set_name·merge·forget·set_self 로만 한다
// (소유자 확인은 DB가 한다). 번호 원문은 어디에도 없고, 열쇠(해시)는 "열쇠 있음" 여부(keyed)만 남기고 버린다.
import {readRecordPages} from './basket-link-records.js';
import {senderError} from './tg-sender-model.mjs';
export {senderError};

const enc = encodeURIComponent;
const workspaceOf = rt => { const id = rt?.context?.read?.()?.workspace?.id; if (!id) throw Error('업무 공간을 확인할 수 없어요.'); return id; };

// TG-불러오기속도(S70-31): 방·날짜·라벨 줄은 날마다 쌓여 많다. 100줄씩 하나 끝나고 다음을 부르면 줄 수만큼 기다리므로,
// 첫 쪽을 읽고 꽉 찼으면 다음 여섯 쪽을 함께 부른다(같은 정렬·같은 100줄 쪽, 짧은 쪽에서 멈춤). 그 사이 로그인·업무 공간이 바뀌면 던진다.
const PAGE = 100, LANES = 6;
const scopeKey = rt => { const c = rt?.context?.read?.() || {}; return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
export async function readLinkPages(path, rt = window.KPTURuntime) {
  const owner = scopeKey(rt), rows = [];
  const page = async offset => {
    const got = await rt.api(`${path}&limit=${PAGE}&offset=${offset}`, {singleFlight:false});
    if (owner !== scopeKey(rt)) throw Error('업무 공간이나 로그인이 바뀌었어요. 다시 확인해 주세요.');
    if (!Array.isArray(got)) throw Error('기록을 확인하지 못했어요. 다시 시도해 주세요.');
    return got;
  };
  const first = await page(0); rows.push(...first); if (first.length < PAGE) return rows;
  for (let start = PAGE; ; start += PAGE * LANES) {
    const pages = await Promise.all(Array.from({length:LANES}, (_, i) => page(start + i * PAGE)));
    for (const got of pages) { rows.push(...got); if (got.length < PAGE) return rows; }
  }
}
// {senders:[{id,name,auto_name,is_self,keyed}], links:[{room_key,day,label,sender_id}]}. 표가 없거나 읽지 못하면 던진다(화면은 A·B 그대로).
export async function readSenders(rt = window.KPTURuntime) {
  const ws = workspaceOf(rt);
  const [people, links] = await Promise.all([
    readRecordPages(`/rest/v1/app_tg_senders?workspace_id=eq.${enc(ws)}&select=id,workspace_id,name,auto_name,is_self,sender_key&order=id.asc`, rt),
    readLinkPages(`/rest/v1/app_tg_day_senders?workspace_id=eq.${enc(ws)}&select=workspace_id,room_key,day,label,sender_id&order=day.desc,room_key.asc,label.asc`, rt),
  ]);
  return {
    senders:people.filter(s => s?.id && s.workspace_id === ws).map(s => ({id:s.id, name:s.name ?? null, auto_name:s.auto_name ?? null, is_self:s.is_self === true, keyed:!!s.sender_key})),
    links:links.filter(l => l?.sender_id && l.workspace_id === ws).map(l => ({room_key:l.room_key, day:l.day, label:l.label, sender_id:l.sender_id})),
  };
}
async function rpc(name, body, rt) {
  try {
    const data = await rt.api(`/rest/v1/rpc/${name}`, {method:'POST', body, singleFlight:false});
    return data && typeof data === 'object' && data.ok === true ? {...data, ok:true} : {ok:false, error:'UNKNOWN'};
  } catch (error) { return {ok:false, error:senderError(error)}; }
}
// 그 방·그 날 라벨에 이름을 붙인다(빈 글이면 직접 붙인 이름만 지움). 돌려주는 값: {ok, changed, id, name, keyed} 또는 {ok:false, error}.
export const setSenderName = (roomKey, day, label, name, rt = window.KPTURuntime) => rpc('app_tg_sender_set_name', {p_room_key:roomKey, p_day:day, p_label:label, p_name:name}, rt);
export const mergeSenders = (from, to, rt = window.KPTURuntime) => rpc('app_tg_sender_merge', {p_from:from, p_to:to}, rt);
export const forgetSender = (id, rt = window.KPTURuntime) => rpc('app_tg_sender_forget', {p_id:id}, rt);
// 이 사람이 나(기록 주인)인지 표시하거나 뺀다(TODO-내일만 3). 서버는 '나'가 보낸 부탁을 챙길 것 후보로 올리지 않는다. 돌려주는 값: {ok, changed, id, is_self, keyed} 또는 {ok:false, error}.
export const setSenderSelf = (id, self, rt = window.KPTURuntime) => rpc('app_tg_sender_set_self', {p_id:id, p_self:!!self}, rt);
