// HELP-메뉴안쓰는법 · HELP-처음쓰는사람안내(명진 확정 11/16 10:18 "모두 추천대로", 시안 docs/design/mockups/help-howto.html · help-first-use.html):
// '쓰는 법' 글의 유일한 원본. 쓰는 법 화면(help.js), 조직 관리·사업 관리·브리핑 룸의 빈 화면 안내(first-use.js), 앱 내려받기 안내
// (app-download-guide.js)가 모두 여기서 읽는다(두 벌 쓰지 않음). DOM·네트워크 없음.
// 메뉴 이름은 menu-model.mjs의 label을 그대로 읽어, 메뉴 이름이 바뀌면 쓰는 법 글도 같이 바뀐다(tests/help-content.test.mjs가 묶음).
// 예시 화면(ex)의 이름·내용은 모두 지어낸 것이다(공개 저장소 — 실제 사람·노조 이름·업무 내용 금지).
import {ITEMS, labelOf} from './menu-model.mjs';
import {word} from './brand/brand.mjs';

export const SUMMARY = word('WORK ON+는 내 일정·할 일·조직·사업 기록을 한곳에 모으는 개인 업무 수첩이에요. 내 기록은 나만 봐요.');
export const CONTACT = 'nojoplus.com@gmail.com';
export const PRIVACY_URL = 'https://work.bokdoong.com/work/about/privacy/';
export const TERMS_URL = 'https://work.bokdoong.com/work/about/terms/';
// 2026-11-23 명진 확정 문장(AGENTS.md 3절 '남의 기록 안 보기')을 그대로. 첫 줄은 '내 기록은 누가 보나' 줄의 한 문장(lead),
// 나머지 두 줄은 펼친 상자(help.js privacyNodes — 첫 줄을 상자에 또 쓰지 않는다). 처리방침·소개 페이지(about/)도 같은 문장.
export const PRIVACY_LINES = Object.freeze([
  '내가 기록한 내용은 운영자가 볼 수 없습니다.', // ui-words-ok 명진 확정 문장 그대로(11/23 15:53, 처리방침·소개와 같은 문장)
  '운영자에게 제공되는 정보: 이메일주소, 가입일, 마지막 사용 시각.',
  '제공되지 않는 정보: 유저가 기록·업로드한 정보.',
]);

// 쓰는 법 목차 묶음(시안 결정 ① '많이 쓰는 곳' 먼저). 운영자 묶음은 서버 기능 목록에 있는 메뉴만 줄이 생긴다.
export const GROUPS = Object.freeze([
  {id: 'main', label: '많이 쓰는 곳', topics: ['team', 'meetings', 'brief']},
  {id: 'daily', label: '매일', topics: ['home', 'basket', 'calendar', 'note', 'reading']},
  {id: 'docs', label: '자료', topics: ['library', 'files', 'photos', 'hwp', 'outside']},
  {id: 'operator', label: '운영자', topics: ['calls', 'telegram', 'arsenal']},
  {id: 'account', label: '계정', topics: ['profile', 'appdl', 'privacy']},
]);

// 메뉴가 아닌 쓰는 법 줄(계정 칸)의 이름. 메뉴 줄 이름은 menu-model.mjs에서 읽는다.
const OWN_LABELS = Object.freeze({profile: '내 프로필', appdl: '앱 내려받기', privacy: '내 기록은 누가 보나'});

// 줄마다: short(목차 한 줄) · lead(한 문장) · when(이럴 때 쓰세요) · steps(따라하기 3~4줄) · notes(알아 둘 것) · links(다른 메뉴와 이어지는 곳)
// · ex(예시 화면: 머리 이름과 줄들, 지어낸 이름) · open(이 메뉴 열기 — 라우터 화면 이름, note는 노트 쪽).
const TOPICS = {
  team: {
    short: word('맡은 조직별 상황을 쌓아 두기'),
    lead: word('맡은 조직별 상황을 쌓아 두는 곳이에요.'),
    when: [word('지회장과 통화하고 "단체협약 갱신 앞둠"을 남겨 둘 때'), word('주간 보고 쓰기 전에 조직별 이번 주를 훑을 때')],
    steps: [word('[+ 담당조직]으로 조직 이름을 직접 넣어요.'), word('조직을 누르고 있었던 일을 한 줄씩 적어요. 날짜가 붙어 쌓여요.'), word('[전체 표]에서 모든 조직의 이번 주 상황을 한눈에 봐요.'), word('주간 보고의 조직 칸은 여기 기록으로 채워져요.')],
    links: [[word('조직 관리 기록'), word("주간 보고 '조직' 칸")], ["홈 '잊지 말기'", word('조직을 선택하면 그 조직 기록으로')]],
    ex: {title: word('조직 관리'), rows: [word('● 바다지회 · 오늘 기록'), word('● 들판분회 · 9일 전 기록'), word('● 숲속지부 · 기록 없음')]},
    open: 'team',
  },
  meetings: {
    short: word('사업영역별 회의·활동 기록'),
    lead: word('회의·면담·집회처럼 날짜 있는 활동을 남기는 곳이에요.'),
    when: [word('교섭·면담을 마치고 결과와 다음 할 일을 남길 때'), word("주간 보고 '사업' 칸을 채우기 전에 이번 주 활동을 볼 때")],
    steps: [word("'사업영역'(큰 주제)을 만들어요. ⋯ › 사업영역 관리에서 만들어요."), word('[+ 사업 보고]로 무엇을 했나 · 결과 · 다음 할 일을 써요.'), word("주간 보고 '사업' 칸과 사업영역별 진행 상황에 모여요.")],
    links: [[word('사업 보고'), word("주간 보고 '사업' 칸")], [word('사업 보고의 다음 할 일'), '일정 › 할 일']],
    ex: {title: word('사업 관리'), rows: [word('11/18 실무 교섭 — 인력 충원안 회신 요구'), '11/14 현장 순회 — 안전 점검 3곳', word('11/12 운영위원회 — 하반기 계획')]},
    open: 'meetings',
  },
  brief: {
    short: '긴 자료를 대신 읽고 요약하기',
    lead: '긴 자료를 넣으면, 자료 짜임대로 요약해 줘요.',
    when: ['정부 발표 자료 80쪽을 회의 전에 10분 만에 파악할 때', '긴 회의록에서 누가 무슨 말을 했는지 빨리 볼 때'],
    steps: ['[자료 넣기]로 PDF·한글 파일을 넣어요(끌어다 놓아도 돼요).', '[브리핑 받기]를 눌러요. 몇 분 걸리고, 다른 화면에 가 있어도 돼요.', '맨 위 요지 몇 줄, 그 아래 자료 짜임에 맞춘 소제목별 요약이 나와요. 쪽 번호를 누르면 원문 그 쪽이 열려요.'],
    notes: ["'원문 인용'은 원문 문장을 그대로 옮겨요. 원문에 없는 문장은 서버가 빼요.", "누가 한 말인지는 문장 안에 밝혀요. 내 담당과 닿는 줄에는 '우리 관련'이 붙어요.", '글자가 없는 스캔 PDF는 읽지 못해요.'],
    links: [['브리핑 룸', "자료실 '브리핑 요청함' 폴더"]],
    ex: {title: '브리핑 룸', rows: ['PDF 예시 편람 개정안 · 한 줄 요지 보기', 'HWP 예시 연구 보고서 · 만드는 중 7/12', 'PDF 예시 계획 · [브리핑 받기]']},
    open: 'brief',
  },
  reading: {
    short: '나중에 읽을 글 모아 두기',
    lead: '나중에 읽을 글을 모아 두고, 원문 사본에 밑줄과 메모를 남기는 곳이에요.',
    when: ['기사·글을 보다가 지금은 못 읽고 나중에 읽고 싶을 때', '읽은 글의 중요한 문장을 노트로 옮겨 둘 때'],
    steps: ['맨 윗줄 돋보기 오른쪽 [+]에 글 주소를 넣거나, 폰에서 [공유] › WORK ON+ 저장한 글을 눌러요.', '원문 사본을 받아 두어요. 원래 페이지가 바뀌거나 사라져도 사본은 남아요.', '글을 선택하고 [밑줄 저장], 밑줄을 누르면 메모를 달아요.', '[밑줄을 노트로]로 밑줄 문장과 출처를 노트 하나로 보내요.'],
    notes: ['로그인이 필요한 글·유료 글은 공개된 앞부분만 받아 와요. 원래 페이지 링크는 늘 보여요.'],
    links: [['저장한 글 밑줄', '노트 › 밑줄'], ['[사업에 연결]', word('사업영역')]],
    ex: {title: '저장한 글', rows: ['● 예시 기사 제목 · example.com · 11/22', '예시 칼럼 · example.org · 11/21']},
    open: 'reading',
  },
  home: {
    short: '오늘 일정·할 일·잊지 말 것을 한 화면에',
    lead: '오늘 할 일과 일정, 남겨 둔 기록을 한 화면에서 보는 업무일지예요.',
    steps: ['맨 위 입력칸에 떠오른 것을 바로 적어요(잊지 말기·할 일).', word('[하루 | 주간 보고]로 오늘 하루와 이번 주를 바꿔 봐요.'), '날짜를 넘기면 그날 기록이 그대로 보여요.'],
    ex: {title: '홈', rows: ['오늘 일정 2 · 할 일 3', word('10:00 운영위원회(예시)'), word('□ 교섭 자료 챙기기(예시)')]},
    open: 'home',
  },
  basket: {
    short: '떠오른 것을 바로 적어 두는 곳',
    lead: '떠오른 것·받은 연락·잊지 말 것을 바로 적어 두는 곳이에요.',
    steps: ['한 줄로 적고 저장해요. 사진·파일도 붙일 수 있어요.', word('담당조직이나 사업영역을 선택하면 그 기록에도 같이 쌓여요.'), '끝난 것은 완료하거나 보관해요.'],
    ex: {title: '잊지 말기', rows: [word('바다지회 사무장 회신 기다림(예시)'), '안전 점검표 양식 받기(예시)', '다음 주 교육 장소 확인(예시)']},
    open: 'basket',
  },
  calendar: {
    short: '구글 캘린더·할 일·하루 기록',
    lead: '구글 캘린더 일정, 구글 할 일, 하루 기록을 한 메뉴에서 봐요.',
    steps: ['[달력]에서 날짜를 눌러 일정을 추가해요. 구글 캘린더에 바로 저장돼요.', '[할 일]은 구글 할 일과 같은 목록이에요. 마감일을 정하면 달력에도 보여요.', '[하루 기록]에는 그날 사진과 짧은 글을 남겨요.'],
    ex: {title: '일정', rows: ['[달력 | 할 일 | 하루 기록]', word('11/18(수) 10:00 실무 교섭(예시)'), '11/20(금) 14:00 현장 순회(예시)']},
    open: 'calendar',
  },
  note: {
    short: '길게 쓰는 글, 폴더·밑줄·태그',
    lead: '회의 메모·초안처럼 길게 쓰는 글을 모아 두는 곳이에요.',
    steps: ['[+ 노트]로 새 글을 써요. 쓰는 동안 저절로 저장돼요.', '폴더로 묶고, 위에 고정해 두면 찾기 쉬워요.', '글자를 선택해 밑줄을 그어 두면 나중에 모아 볼 수 있어요.', '노트 ⋯ [공유 링크 만들기]로 밖의 사람에게 링크로 보여 줘요. 넣은 사진도 함께 보여요.'],
    ex: {title: '노트', rows: [word('교섭 준비 메모(예시)'), '교육 자료 초안(예시)', '회의 메모 11/12(예시)']},
    open: 'note',
  },
  library: {
    short: '문서를 내 구글 드라이브에 정리',
    lead: '문서를 내 구글 드라이브에 올리고 폴더·종류별로 정리하는 곳이에요.',
    steps: ['[+ 자료]로 파일을 올려요(끌어다 놓아도 돼요).', word('담당조직·사업영역을 붙여 두면 그 화면에서도 보여요.'), '자료 ⋯에서 [브리핑 받기]를 누르면 브리핑 룸으로 가요.'],
    ex: {title: '자료실', rows: [word('폴더 · 교섭 자료(예시)'), word('HWP · 예시 단체협약안'), 'PDF · 예시 안전 점검표']},
    open: 'library',
  },
  files: {
    short: '원드라이브·구글 드라이브 파일 보기',
    lead: '원드라이브와 구글 드라이브의 파일을 한 화면에서 보고 옮기는 곳이에요.',
    steps: ['처음 한 번 [원드라이브 연결]·[구글 드라이브 연결]을 눌러요.', '폴더를 눌러 들어가고, 파일을 눌러 봐요.', '파일 ⋯에서 다른 클라우드로 복사·이동해요.'],
    ex: {title: '파일', rows: ['구글 드라이브 › 예시 폴더', 'DOCX · 예시 회의록', 'XLSX · 예시 일정표']},
    open: 'files',
  },
  photos: {
    short: '폰·구글 드라이브 사진 모아 보기',
    lead: '폰과 구글 드라이브에 있는 사진을 모아 보는 곳이에요.',
    steps: ['폰 앱에서는 폰 사진, 브라우저에서는 구글 드라이브 사진이 보여요.', '사진을 길게 눌러 여러 장을 선택해요.', '사진 ⋯에서 하루 기록이나 잊지 말기로 보내요.'],
    ex: {title: '사진', rows: ['11월 16일 · 4장(예시)', '11월 14일 · 2장(예시)', '앨범 · 현장 순회(예시)']},
    open: 'photos',
  },
  hwp: {
    short: '한글 파일을 열어 수정·저장',
    lead: '한글(HWP) 파일을 브라우저에서 열어 수정하고 저장하는 곳이에요.',
    steps: ['[파일 선택]으로 한글 파일을 열어요.', '글을 수정해요.', '[내 기기에 저장]하거나 [자료실에 업로드]를 눌러요.'],
    ex: {title: 'HWP 편집', rows: ['파일 ▾ · 저장 ▾', '예시 공문.hwp', '본문 수정 중…']},
    open: 'hwp',
  },
  outside: {
    short: '기사·성명 읽기, 저장·밑줄',
    lead: '노동·공공 관련 기사와 성명을 모아 읽는 곳이에요.',
    steps: ['탭을 넘기며 새 기사와 성명을 봐요.', '필요한 글은 [저장]해 저장한 글에 모으고, 문장에 밑줄을 그어 둬요.', '안 볼 글은 [숨기기], 숨긴 글은 ⋯ [숨긴 글]에서 다시 보이게 해요.', '찾기 칸에서 제목·문장으로 찾아요.'],
    ex: {title: '읽을 거리', rows: ['예시 기사 제목 하나', '예시 성명 제목 하나', '예시 기사 제목 둘']},
    open: 'outside',
  },
  calls: {
    short: '통화 기록과 요약',
    lead: '통화 기록과 요약을 모아 보는 운영자 메뉴예요.',
    steps: ['통화 줄을 누르면 요약과 원문이 보여요.', '통화에서 나온 일은 할 일이나 잊지 말기로 보내요.'],
    ex: {title: '통화', rows: ['예시 상대 · 3분', '예시 상대 · 12분']},
    open: 'calls',
  },
  telegram: {
    short: '텔레그램 방 소식 모아 보기',
    lead: '텔레그램 방 소식을 모아 보는 운영자 메뉴예요.',
    steps: ['방을 누르면 그 방 소식이 날짜별로 보여요.', '보낸 사람을 눌러 그 사람 소식만 봐요.'],
    ex: {title: '텔레그램 소식', rows: ['예시 방 · 새 소식 4', '예시 방 · 새 소식 1']},
    open: 'telegram',
  },
  arsenal: {
    short: '경기 기록 보기',
    lead: '경기 기록을 보는 운영자 메뉴예요.',
    steps: ['경기를 눌러 기록과 메모를 봐요.'],
    ex: {title: '아스날', rows: ['예시 경기 · 2:1', '예시 경기 · 0:0']},
    open: 'arsenal',
  },
  profile: {
    short: '소속·폰 알림·구글 연결',
    lead: '내 소속·이름·폰 알림·구글 연결을 정하는 곳이에요.',
    steps: [word('소속(조직·부서)과 이름·직책을 적어요.'), '폰 알림을 켜면 일정·할 일 알림을 받아요.', '구글 캘린더·할 일·드라이브 연결 상태를 봐요.'],
    ex: {title: '내 프로필', rows: [word('소속 · 예시노조 예시지부'), '폰 알림 · 켜짐', '구글 연결 · 연결됨']},
    open: 'profile',
  },
  appdl: {
    short: '폰·PC·맥에서 앱처럼 쓰기',
    lead: '쓰는 기기를 선택하면 앱처럼 쓰는 방법이 나와요.',
  },
  privacy: {
    short: '운영자가 보는 것과 안 보는 것',
    lead: PRIVACY_LINES[0],
  },
};

const FEATURE = new Map(ITEMS.filter(item => item.feature).map(item => [item.id, item.feature]));
export const topicLabel = id => OWN_LABELS[id] || labelOf(id);
/** 쓰는 법 줄 하나(없는 이름이면 null). */
export function topic(id) {
  const t = TOPICS[id];
  return t ? {id, label: topicLabel(id), feature: FEATURE.get(id) || null, ...t} : null;
}
export const TOPIC_IDS = Object.freeze(Object.keys(TOPICS));
/**
 * 그 사람에게 보일 목차. features = 서버 기능 목록(app_my_features). 목록이 아니면(아직 못 읽음) 운영자 기능 메뉴 줄은 넣지 않는다 —
 * 다른 사람 쓰는 법에 운영자 메뉴 줄이 잠깐이라도 생기지 않게. 빈 묶음은 빠진다.
 */
export function helpGroups(features) {
  const have = new Set(Array.isArray(features) ? features : []);
  return GROUPS.map(g => ({id: g.id, label: g.label, topics: g.topics.map(topic).filter(t => t && (!t.feature || have.has(t.feature)))}))
    .filter(g => g.topics.length);
}
/** 찾기: 이름·한 줄·설명·따라하기 글에 낱말이 모두 들어 있는 줄만. */
export function matchTopic(t, query) {
  const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [t.label, t.short, t.lead, ...(t.when || []), ...(t.steps || []), ...(t.notes || [])].join(' ').toLowerCase();
  return words.every(w => text.includes(w));
}

// 처음 쓰는 사람 안내(빈 화면, 시안 help-first-use.html ①②③): 기록이 하나도 없을 때만 그 화면 목록 자리에 그린다(숨김이 아니라 그리는 조건).
// steps는 [글, 예시] — 예시 이름은 지어낸 것(명진 결정 ③ '이대로').
export const FIRST_USE = Object.freeze({
  team: {
    title: word('맡은 조직별 상황을 쌓아 두는 곳이에요'),
    sub: word("지부·지회·분회처럼 내가 챙기는 조직마다 '요즘 무슨 일이 있는지'를 한 줄씩 남겨요."),
    steps: [[word('[+ 담당조직]으로 조직 이름을 넣어요'), word('예: 바다지회, 들판분회')], [word('조직을 눌러 있었던 일을 한 줄씩 적어요. 날짜가 붙어 쌓여요'), word('예: 임금 교섭 3차, 사측 기본급 2% 제시')], [word("[전체 표]에서 모든 조직의 이번 주를 한눈에 보고, 주간 보고 '조직' 칸으로 모여요"), '']],
    action: word('+ 담당조직'),
  },
  meetings: {
    title: word('회의·면담·집회처럼 날짜 있는 활동을 남기는 곳이에요'),
    sub: word("'사업영역'(큰 주제)별로 활동을 모아 두면, 주간 보고와 '이번 주 사업' 표가 저절로 채워져요."),
    steps: [[word('사업영역을 만들어요'), word('예: 임금 교섭, 안전 인력 확충, 조직 확대')], [word('[+ 사업 보고]로 무엇을 했나 · 결과 · 다음 할 일을 써요'), word('예: 11/18 사측 실무 교섭 — 인력 충원안 회신 요구')], [word("주간 보고 '사업' 칸과 사업영역별 진행 상황에 모여요"), '']],
    action: word('+ 사업 만들기'),
  },
  brief: {
    title: '긴 자료를 넣으면, 자료 짜임대로 요약해 줘요',
    sub: '수십~백 쪽 보고서·법안·공문을 다 읽기 전에 핵심부터 봐요.',
    steps: [['[자료 넣기]로 PDF·한글 파일을 넣어요', '끌어다 놓아도 돼요'], ['[브리핑 받기]를 눌러요. 몇 분 걸리고, 다른 화면에 가 있어도 돼요', ''], ['맨 위 요지와 소제목별 요약이 나와요', '꼭 볼 대목은 원문 인용으로(쪽 번호를 누르면 원문 그 쪽)']],
    action: '자료 넣기',
    foot: "넣은 자료는 자료실 '브리핑 요청함' 폴더에도 같이 보여요.",
  },
});

// 앱 내려받기 기기별 안내(시안 ④). android·windows의 내려받기 주소는 app-download.mjs가 정한다(여기는 글만).
export const DEVICES = Object.freeze([
  {id: 'android', label: '안드로이드'},
  {id: 'iphone', label: '아이폰'},
  {id: 'windows', label: '윈도우'},
  {id: 'mac', label: '맥'},
]);
export const APP_GUIDE = Object.freeze({
  android: {
    steps: [['아래 [안드로이드 앱 내려받기]를 눌러 받아요', ''], ["받은 파일을 열어 설치해요", "처음 한 번 '알 수 없는 앱 설치 허용'을 켜야 해요"], [word('WORK ON+ 앱을 열고 로그인해요. 업데이트는 앱이 스스로 해요'), '']],
    action: 'android',
  },
  iphone: {
    steps: [[word('사파리로 WORK ON+에 로그인해요'), ''], ['아래 [공유] → 홈 화면에 추가', ''], [word('홈 화면의 WORK ON+ 아이콘으로 열면 주소창 없이 앱처럼 열려요'), '']],
    note: word("아이폰은 '공유로 보내기'(다른 앱에서 WORK ON+로 보내기)는 아직 안 돼요."),
  },
  windows: {
    steps: [['크롬·엣지 주소창 오른쪽 설치 아이콘 → [설치]', ''], [word('바탕화면·시작 메뉴에 WORK ON+ 아이콘이 생기고, 주소창 없는 창 하나로 열려요'), ''], ['업데이트는 저절로 돼요. 따로 받을 것 없어요', '']],
    note: word("'WORK ON+ 파일 올리기' 도우미는 WORK ON+ 자체가 아니에요. [파일]에서 이 PC 폴더를 볼 때만 받아요."),
    action: 'windows',
  },
  mac: {
    steps: [['크롬: 주소창 오른쪽 설치 아이콘 → [설치]', '사파리(macOS 14 이상): 메뉴 막대 파일 › Dock에 추가'], [word('Dock·Launchpad에 WORK ON+ 아이콘이 생기고, 주소창 없는 창 하나로 열려요'), ''], ['업데이트는 저절로 돼요. 따로 받을 것 없어요', '']],
    note: word("윈도우용 'WORK ON+ 파일 올리기'는 맥에 없어요. 맥에서는 구글 드라이브에 둔 파일을 [파일]에서 봐요."),
  },
});
/** 지금 기기에 맞는 칸(먼저 열리는 탭). */
export function deviceOf(ua = '') {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iphone';
  if (/Android/i.test(ua)) return 'android';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  return 'windows';
}
