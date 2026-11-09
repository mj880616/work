// REPORT-기간고르기 (2026-11-03 명진 요청 10:10) → S52-22 TEAM-맨위한줄(11/07): 사업 보고 목록의 기간 한 줄 ‹ 날짜 · n건 › + [이번 주 ▾] — 화면 없이 시험하는 부분.
// 모드: all(전체) · week(주간 보기, 늘 이번 주부터) · range(기간 설정: 시작·끝 날). 고른 모드와 기간은 서버(view_prefs.report_period)에 기억한다.
// 날짜는 모두 서울 날짜 'YYYY-MM-DD'. 일시가 없는 보고는 어느 기간에서나 빠지지 않는다(주간 보기와 같은 규칙).
import {reportDay, weekOf} from './business-area-model.mjs';

// 기간 고르기 상자 [이번 주 ▾]의 줄: 이번 주(주 단위, 이번 주로) · 주차 고르기(연도·주차, BIZ-주차고르기) · 전체 기간 · 기간 정하기(달력).
// 주차 고르기는 주 단위 보기의 한 가지(고른 주로 가고 번호를 붙여 보인다)라 기억하는 모드는 week 그대로다.
export const PERIOD_CHOICES = Object.freeze([['week', '이번 주'], ['isoweek', '주차 선택'], ['all', '전체 기간'], ['range', '기간 정하기']]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const real = day => DAY.test(String(day)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
export const validRange = (from, to) => real(from) && real(to) && from <= to;
const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// 서버에서 읽은 값 → {mode, from, to}. 모르는 모양은 주간 보기(기본)로.
export function periodFromPref(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.mode === 'all') return {mode: 'all', from: '', to: ''};
    if (value.mode === 'range' && validRange(value.from, value.to)) return {mode: 'range', from: value.from, to: value.to};
  }
  return {mode: 'week', from: '', to: ''};
}
// 저장할 값: 주간 보기는 기본이라 비운다(null).
export function prefFromPeriod({mode, from, to} = {}) {
  if (mode === 'all') return {mode: 'all'};
  if (mode === 'range' && validRange(from, to)) return {mode: 'range', from, to};
  return null;
}
// 기간 안의 보고 + 일시 없는 보고.
export const inRange = (list, from, to) => (list || []).filter(m => { const day = reportDay(m); return !day || (day >= from && day <= to); });
export const undatedIn = list => (list || []).filter(m => !reportDay(m)).length;
const short = day => `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}`;
export const rangeLabel = (from, to) => `${short(from)}~${short(to)}`;
// 빠른 고르기 칩(BIZ-기간정하기 11/09: 누르면 아래 날짜 칸을 채우고 [적용]으로 정한다): 이번 주 · 이번 달 · 지난 달 · 최근 3달(두 달 전 1일부터 이번 달 끝까지) · 전체.
// 전체 = 일시가 있는 보고의 첫날~마지막 날(오늘이 더 늦으면 오늘까지). 이 칩 그대로 [적용]하면 '전체 기간'이 된다(화면 쪽).
export function quickRanges(today, list = []) {
  if (!real(today)) return [];
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const prev = m === 1 ? [y - 1, 12] : [y, m - 1], back2 = m <= 2 ? [y - 1, m + 10] : [y, m - 2];
  const week = weekOf(today), days = (list || []).map(reportDay).filter(Boolean).sort();
  const first = days[0] || today, last = days.at(-1) && days.at(-1) > today ? days.at(-1) : today;
  return [
    {key: 'week', label: '이번 주', from: week.from, to: week.to},
    {key: 'month', label: '이번 달', from: ymd(y, m, 1), to: ymd(y, m, lastDay(y, m))},
    {key: 'last-month', label: '지난 달', from: ymd(prev[0], prev[1], 1), to: ymd(prev[0], prev[1], lastDay(prev[0], prev[1]))},
    {key: 'last-3', label: '최근 3달', from: ymd(back2[0], back2[1], 1), to: ymd(y, m, lastDay(y, m))},
    {key: 'all', label: '전체', from: first < today ? first : today, to: last}
  ];
}
