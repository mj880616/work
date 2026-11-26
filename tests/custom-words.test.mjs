import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { FACES, wordIn } from '../app/brand/faces.mjs';
import { SLOTS, SLOT_IDS, NAME_MAX, defaultName, cleanName, parseCustomWords, buildSaveValue, applyCustomWords } from '../app/brand/custom-words-model.mjs';
import { CUSTOM_WORDS } from '../app/brand/custom-words.mjs';
import { CUSTOMIZED, word, BASE_FACE, FACE } from '../app/brand/brand.mjs';
import { withWordBase as withWordBaseSync } from '../app/brand/custom-words-model.mjs';
import { readdirSync } from 'node:fs';

// APP-기록+이름바꾸기(S67-44): 단어 값의 출처 = 얼굴 기본값 위에 사람별 덮어쓰기(서버 내 프로필 custom_words).
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const nojo = FACES.nojo, girok = FACES.girok;
const say = (face, text, slot) => wordIn(face, text, slot);
// 지금 노동조합+ 화면 이름 그대로(명진이 기록+에서 고친 이름으로 넣을 값, docs/ops/custom-words-operator.apply.sql).
const OPERATOR = JSON.parse(read('docs/ops/custom-words-operator.apply.sql').match(/set custom_words = '(\{[^']*\})'::jsonb/)[1]);
// app/의 word('글자')·word('글자','자리') 고정 글자(정규식으로 모음 — 전수는 scripts/check-girok-words.mjs가 AST로 본다).
function wordLiterals() {
  const out = [];
  const walk = dir => {
    for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (!/rhwp|node_modules|-\d+\.\d+/.test(entry.name)) walk(path); continue; }
      if (!/\.(m?js)$/.test(entry.name)) continue;
      for (const m of read(path).matchAll(/\bword\('((?:[^'\\\n]|\\.)+)'(?:\s*,\s*'([a-z]+)')?\)/g)) out.push([m[1], m[2]]);
    }
  };
  walk('app');
  return out;
}
const UNION_WORDS = /노동조합|노조|조직|사업 ?보고|사업 ?관리|사업 ?영역|투쟁|교섭|상집|조합원|국회|언론|정책/;

test('시험(노드)에서는 고친 이름이 없고 word()는 얼굴 그대로다', () => {
  assert.deepEqual(CUSTOM_WORDS, {});
  assert.equal(CUSTOMIZED, false);
  assert.equal(BASE_FACE, FACE, '바탕 낱말 묶음 없음');
  for (const text of ['사업 관리', '사업영역을 고르세요', '담당조직']) assert.equal(word(text), say(nojo, text));
});

test('칸 목록: 15칸, id는 DB 검사와 같고 뜻(열쇠)이 겹치지 않는다', () => {
  assert.equal(SLOTS.length, 15);
  assert.deepEqual(SLOT_IDS.filter(id => id.startsWith('kind_')).length, 8);
  const sql = read('supabase/migrations/20261120210000_profile_custom_words.sql');
  const keys = [...sql.match(/strict \$\.keyvalue\(\) \? \(!\(([^']*)\)\)'/)[1].matchAll(/@\.key == "([a-z_]+)"/g)].map(m => m[1]);
  assert.deepEqual(keys, SLOT_IDS, 'DB 검사 칸 id = 화면 칸 id');
  const all = SLOTS.flatMap(slot => slot.keys);
  assert.equal(new Set(all).size, all.length, '한 열쇠는 한 칸만');
  for (const slot of SLOTS) assert.ok(slot.hint && !UNION_WORDS.test(slot.hint), `${slot.id} 이름표에 노조 색 없음`);
  // 분류 칸은 app/report-kinds.mjs의 화면 글자(word(글자,'kind'))와 같은 열쇠.
  const kinds = read('app/report-kinds.mjs');
  for (const slot of SLOTS.filter(s => s.kind)) assert.ok(kinds.includes(`word('${slot.keys[0].replace('#kind', '')}','kind')`), slot.id);
});

test('기록+ 기본 이름(고친 이름 없음)에는 노조 색 단어가 없다 — 금지어 검사는 기본값에만', () => {
  for (const slot of SLOTS) {
    const def = defaultName(girok, slot);
    assert.ok(def && !UNION_WORDS.test(def), `${slot.id}: ${def}`);
  }
  assert.equal(applyCustomWords(girok, {}), girok, '고친 이름이 없으면 얼굴 그대로');
  // 고친 이름은 사람의 선택이라 노조 단어여도 된다(금지어 검사 대상 아님).
  assert.deepEqual(parseCustomWords(OPERATOR), OPERATOR);
});

test('명진 값 = 지금 노동조합+ 화면 이름 그대로: 노동조합+ 얼굴에서는 아무것도 바뀌지 않는다', () => {
  assert.deepEqual(Object.keys(OPERATOR), SLOT_IDS, '15칸 모두');
  for (const slot of SLOTS) assert.equal(OPERATOR[slot.id], defaultName(nojo, slot), slot.id);
  assert.equal(applyCustomWords(nojo, OPERATOR), nojo, '얼굴 그대로(바뀌는 글자 없음)');
});

test('기록+ 얼굴 + 명진 값: 메뉴·한 건·분류 이름이 지금과 같게 보인다', () => {
  const shown = applyCustomWords(girok, OPERATOR);
  const same = {
    '사업 관리': '사업 관리', '사업 보고 쓰기': '사업 보고 쓰기', '사업영역 관리': '사업영역 관리', '사업영역을 고르세요': '사업영역을 고르세요',
    '사업영역이 없습니다': '사업영역이 없습니다', '담당조직이 없습니다': '담당조직이 없습니다', '투쟁사업장은 3곳': '투쟁사업장은 3곳',
    '조직 보고': '조직 보고', '[+ 사업 보고]로 무엇을 했나 · 결과 · 다음 할 일을 써요.': '[+ 사업 보고]로 무엇을 했나 · 결과 · 다음 할 일을 써요.'
  };
  for (const [from, to] of Object.entries(same)) assert.equal(say(shown, from), to, from);
  assert.equal(say(shown, '조직 관리'), '조직 관리');
  assert.equal(say(shown, '조직 관리', 'title'), '조직 관리');
  assert.equal(say(shown, '사업 관리', 'title'), '사업 관리');
  for (const [label, value] of [['정책', '정책'], ['교섭', '교섭'], ['언론', '언론'], ['국회', '국회'], ['투쟁', '투쟁'], ['회의', '회의']]) assert.equal(say(shown, label, 'kind'), value, label);
  // 고칠 수 없는 낱말(칸 밖)은 기록+ 기본 그대로.
  assert.equal(say(shown, '조합원을 찾기'), '구성원을 찾기');
});

test('사람별 덮어쓰기: 메뉴·문장 안·조사·자리 열쇠', () => {
  const shown = applyCustomWords(girok, {area: '캠페인', menu_org: '고객 관리', report: '활동 일지'});
  assert.equal(say(shown, '사업영역'), '캠페인');
  assert.equal(say(shown, '사업영역을 고르세요'), '캠페인을 고르세요');
  assert.equal(say(shown, '사업영역으로 옮기기'), '캠페인으로 옮기기');
  assert.equal(say(shown, '사업영역 관리'), '캠페인 관리', '얼굴의 문장 열쇠 대신 낱말 바꾸기');
  assert.equal(say(shown, "'사업영역'(큰 주제)을 만들어요. ⋯ › 사업영역 관리에서 만들어요."), "'캠페인'(큰 주제)을 만들어요. ⋯ › 캠페인 관리에서 만들어요.");
  assert.equal(say(shown, '조직 관리'), '고객 관리');
  assert.equal(say(shown, '조직 관리', 'title'), '고객 관리');
  assert.equal(say(shown, '사업 보고 저장'), '활동 일지 저장');
  assert.equal(say(shown, '사업 관리'), '활동 기록', '고치지 않은 칸은 기록+ 기본');
  assert.equal(say(shown, '담당조직'), '관리 대상');
  assert.equal(say(girok, '사업영역'), '프로젝트', '얼굴 표는 그대로(새 표를 만든다)');
  // 노동조합+ 얼굴에서도 같은 길.
  const n = applyCustomWords(nojo, {area: '캠페인'});
  assert.equal(say(n, '사업영역 n개'), '캠페인 n개');
  assert.equal(say(n, '담당조직'), '담당조직');
});

test('분류 칸은 분류 자리(#kind)에만: 문장 안 같은 낱말은 그대로', () => {
  const shown = applyCustomWords(girok, {kind_meeting: '미팅', kind_education: '연수'});
  assert.equal(say(shown, '회의', 'kind'), '미팅');
  assert.equal(say(shown, '교육', 'kind'), '연수');
  assert.equal(say(shown, '회의'), '회의');
  assert.equal(say(shown, '교육 일정'), '교육 일정');
  assert.equal(say(shown, '정책', 'kind'), '기획', '고치지 않은 분류는 기록+ 기본');
});

test('서버 값 읽기: 모르는 칸·틀린 모양은 버린다', () => {
  for (const raw of [null, undefined, 'x', 1, [], ['a']]) assert.deepEqual(parseCustomWords(raw), {});
  assert.deepEqual(parseCustomWords({area: '캠페인', nope: 'x', report: '', menu_biz: 3, org_one: ' 앞', workplace: 'a<b', kind_other: '가'.repeat(21)}), {area: '캠페인'});
  assert.ok(Object.isFrozen(parseCustomWords({area: '캠페인'})));
});

test('이름 모양: 1~20자, 앞뒤 공백 다듬기, 제어문자·< > & " \' ` \\ 없음', () => {
  assert.equal(cleanName('  캠페인 '), '캠페인');
  assert.equal(cleanName('가'.repeat(NAME_MAX)), '가'.repeat(NAME_MAX));
  for (const bad of ['', '   ', '가'.repeat(NAME_MAX + 1), 'a<b', 'a>b', 'a&b', 'a"b', "a'b", 'a`b', 'a\\b', '두\n줄', '탭\t중간', 7, null]) assert.equal(cleanName(bad), '', String(bad));
});

test('저장할 값: 빈칸·기본 이름과 같은 칸은 빼고([기본으로]), 없으면 null, 틀리면 그 칸', () => {
  assert.deepEqual(buildSaveValue(girok, {}), {value: null});
  assert.deepEqual(buildSaveValue(girok, {area: '', report: '  '}), {value: null}, '[기본으로] = 빈칸');
  assert.deepEqual(buildSaveValue(girok, {area: '프로젝트'}), {value: null}, '기본 이름과 같으면 담지 않음');
  assert.deepEqual(buildSaveValue(girok, {area: ' 캠페인 ', kind_policy: '기획'}), {value: {area: '캠페인'}});
  assert.deepEqual(buildSaveValue(girok, {area: 'a<b'}), {error: 'area'});
  assert.deepEqual(buildSaveValue(girok, {nope: '이름'}), {value: null}, '모르는 칸은 무시');
  assert.deepEqual(buildSaveValue(girok, OPERATOR).value, Object.fromEntries(Object.entries(OPERATOR).filter(([id]) => OPERATOR[id] !== defaultName(girok, SLOTS.find(s => s.id === id)))));
  assert.deepEqual(buildSaveValue(nojo, OPERATOR), {value: null}, '노동조합+ 얼굴에서 명진 값은 모두 기본과 같다');
});

test('시작 순서: 고친 이름 약속은 소유자 확인에 묶이고, word()를 쓰는 모듈보다 먼저 생긴다', () => {
  const loader = read('app/loader-v2.js');
  const promiseAt = loader.indexOf('window.__KPTU_CUSTOM_WORDS__=');
  assert.ok(promiseAt > 0);
  assert.ok(promiseAt > loader.indexOf("window.__KPTU_BOOT_MEMBERSHIP_PROMISE__=window.KPTURuntime.api(membershipPath)"), '소속 확인 뒤에 묶음');
  const block = loader.slice(promiseAt, loader.indexOf(';\n', loader.indexOf('Promise.resolve(null)', promiseAt)));
  assert.match(block, /member\.rows\[0\]\?\.role==='owner'/, '소유자만 읽는다(비구성원은 데이터 요청 없음)');
  assert.match(block, /select=custom_words&limit=1/);
  // S71-32: 고친 이름은 소속 확인과 같은 기다림(15초)으로 받는다 — 3초 남짓에 끊겨 그 접속 내내 기본 이름으로 굳던 원인(명진 폰).
  assert.match(loader, /const BOOT_WORDS_MS=15000;/);
  assert.match(block, /timeoutMs:BOOT_WORDS_MS\}/);
  assert.match(block, /setTimeout\(\(\)=>resolve\(null\),BOOT_WORDS_MS\+500\)/, '서버가 끝내 답하지 않을 때만 기본 이름으로 연다');
  assert.doesNotMatch(block, /timeoutMs:3000|3500/, '짧게 끊지 않는다');
  // S67-62: 바탕 낱말 묶음은 같은 소유자 확인 뒤 서버 기능 목록(GET)에서만 — 그 답은 my-features.js 첫 물음이 그대로 쓴다(두 번 묻지 않음).
  assert.match(block, /window\.__KPTU_BOOT_FEATURES__=\{userId:bootUserId,promise:window\.KPTURuntime\.api\('\/rest\/v1\/rpc\/app_my_features'/);
  assert.match(block, /\.then\(\(\[custom_words,features\]\)=>\(\{custom_words,features\}\)\)/);
  const mine = read('app/my-features.js');
  assert.match(mine, /boot\.userId !== userId/);
  assert.match(mine, /window\.__KPTU_BOOT_FEATURES__ = null;\n  return boot\.promise/);
  for (const mod of ['action-labels.js', 'topbar-actions.js', 'team.js']) assert.ok(loader.indexOf(`import('./${mod}')`) > promiseAt, `${mod}는 약속 뒤`);
  // 약속보다 앞에서 실행되는 모듈은 brand.mjs를 정적으로 부르지 않는다(부르면 이번 접속은 고친 이름 없이 굳는다).
  const early = [...loader.slice(0, promiseAt).matchAll(/import\('\.\/([^']+)'\)/g)].map(m => m[1]);
  const seen = new Set();
  const reaches = file => {
    if (seen.has(file)) return false; seen.add(file);
    let src; try { src = read(`app/${file}`); } catch { return false; }
    const deps = [...src.matchAll(/^\s*import\s[^'"]*['"]\.\/([^'"]+)['"]/gm)].map(m => m[1]);
    return deps.some(dep => dep === 'brand/brand.mjs' || dep.endsWith('/brand.mjs') || reaches(dep));
  };
  for (const file of early) assert.equal(reaches(file), false, `${file}가 brand.mjs를 일찍 부름`);
  // 앱 바탕 글자 입히기는 고친 이름이 있을 때만, 화면 모듈보다 먼저 한 번.
  const shellAt = loader.indexOf("await import('./custom-words-boot.js')");
  assert.ok(shellAt > promiseAt && shellAt < loader.indexOf("import('./topbar-actions.js')"));
  assert.match(read('app/custom-words-boot.js'), /if \(CUSTOMIZED\) \{\n  const \{applyShellWords\} = await import\('\.\/brand\/custom-words-shell\.mjs'\);\n  applyShellWords\(document\.body, word\);/);
});

test('저장은 서버뿐: 주소·쿠키로 고친 이름을 정하는 길이 없다(기기 저장소는 browser-storage-audit.yml이 app/ 전체에서 막는다)', () => {
  for (const file of ['app/brand/custom-words.mjs', 'app/brand/custom-words-model.mjs', 'app/brand/custom-words-shell.mjs', 'app/custom-words-boot.js', 'app/custom-words-store.js', 'app/menu-edit.js']) {
    const source = read(file).replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(source, /document\.cookie|URLSearchParams|location\.(search|hash)/, file);
  }
  const words = read('app/brand/custom-words.mjs').replace(/^\s*\/\/.*$/gm, '');
  assert.match(words, /globalThis\.__KPTU_CUSTOM_WORDS__/);
  assert.doesNotMatch(words, /fetch\(|api\(/, '읽기는 loader 한 곳');
  // S67-71: 읽기·쓰기는 custom-words-store.js 한 곳. S71-32: 고치는 화면은 '메뉴 수정' 창 하나(내 프로필 '이름 바꾸기' 상자 없앰).
  const store = read('app/custom-words-store.js');
  assert.match(store, /\/rest\/v1\/app_profiles\?user_id=eq\.\$\{encodeURIComponent\(userId\)\}`/);
  assert.match(store, /method: 'PATCH', prefer: 'return=representation', body: \{custom_words: value\}/);
  assert.match(store, /const merged = \{\.\.\.saved\};/, '고친 칸만 갈아 끼우고 다른 칸은 서버 값 그대로');
  assert.match(store, /buildSaveValue\(face, merged\)/, '같은 규칙(buildSaveValue)');
  for (const file of ['app/menu-edit.js']) {
    const source = read(file);
    assert.match(source, /from '\.\/custom-words-store\.js'/, file);
    assert.doesNotMatch(source, /app_profiles|method: 'PATCH'/, `${file}: 서버 길을 따로 쓰지 않는다`);
  }
  assert.doesNotMatch(read('app/profile-settings.js'), /custom-words-panel|psCustomWordsPanel|이름 바꾸기/, '내 프로필에 이름 바꾸기 상자 없음');
  assert.equal(existsSync(new URL('../app/custom-words-panel.js', import.meta.url)), false, '옛 상자 코드 없음');
});

test('운영자 이름 SQL: 코드에 계정을 넣지 않고 운영자 허용 표로 대상 한 명을 고른다', () => {
  const apply = read('docs/ops/custom-words-operator.apply.sql');
  assert.match(apply, /feature in \('calls', 'telegram'\)/);
  assert.match(apply, /having count\(distinct feature\) = 2/);
  assert.match(apply, /where user_id = target and custom_words is null/);
  for (const file of ['docs/ops/custom-words-operator.apply.sql', 'docs/ops/custom-words-operator.rollback.sql', 'docs/ops/custom-words-operator.precheck.sql', 'app/brand/custom-words-model.mjs', 'docs/design/girok-custom-words.md']) {
    const text = read(file);
    assert.doesNotMatch(text, /@[a-z0-9.-]+\.[a-z]{2,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, `${file}에 이메일·id 없음`);
  }
  assert.match(read('docs/ops/custom-words-operator.rollback.sql'), /and custom_words = '\{[^']*\}'::jsonb/);
});

// S67-57: 내 프로필·묶음·주간 캘린더 칸의 소속·주간 이름.
// 소속·주간은 이름 바꾸기 칸이 아니다(DB 변경 없음): 명진(서버 허용 표 nojo_words)은 바탕 낱말 묶음으로 지금 글자 그대로다.
test('소속·주간 자리: WORK ON 기본은 노조 색 없음, 명진(바탕 nojo + 15칸)은 예시·안내까지 지금 글자 그대로', () => {
  const EXAMPLES = ['○○노동조합 ○○지부', '○○사업팀', '국장'];
  const EMPTY = '같은 부서·같은 노조 사람과 일정·자료·조직·사업을 선택해서 나눠 볼 수 있어요. 나누는 건 항목마다 직접 켜요.';
  // WORK ON 기본(고친 이름 없음)
  assert.equal(say(girok, '노조', 'group'), '소속');
  assert.equal(say(girok, '주간 보고', 'weekly'), '주간 정리');
  for (const text of EXAMPLES) assert.doesNotMatch(say(girok, text, 'example'), UNION_WORDS, text);
  assert.deepEqual(EXAMPLES.map(text => say(girok, text, 'example')), ['○○회사·○○단체', '○○팀', '팀장']);
  assert.doesNotMatch(say(girok, EMPTY), UNION_WORDS);
  // 노동조합+ 얼굴: 모두 글자 그대로
  assert.equal(say(nojo, '노조', 'group'), '노조');
  assert.equal(say(nojo, '주간 보고', 'weekly'), '주간 보고');
  for (const text of EXAMPLES) assert.equal(say(nojo, text, 'example'), text);
  // WORK ON + 명진(바탕 nojo + 15칸)
  const mine = applyCustomWords(withWordBaseSync(girok, 'nojo'), OPERATOR);
  assert.equal(say(mine, '노조', 'group'), '노조');
  assert.equal(say(mine, '주간 보고', 'weekly'), '주간 보고');
  for (const text of EXAMPLES) assert.equal(say(mine, text, 'example'), text, text);
  assert.equal(say(mine, EMPTY), EMPTY);
  // 프로필 화면 '담당조직 현황'·'조직 관리로'·없음 안내(기존 칸이 맡음)
  assert.equal(say(mine, '담당조직 현황'), '담당조직 현황');
  assert.equal(say(mine, '조직 관리로'), '조직 관리로');
  assert.equal(say(mine, '조직 관리에서 담당조직을 더하면 여기서 선택할 수 있어요.'), '조직 관리에서 담당조직을 더하면 여기서 선택할 수 있어요.');
  assert.doesNotMatch(say(girok, '담당조직 현황') + say(girok, '조직 관리로') + say(girok, '조직 관리에서 담당조직을 더하면 여기서 선택할 수 있어요.'), UNION_WORDS);
  // 바탕 없이 15칸만 고친 사람(테스터 등)은 소속·주간·예시가 WORK ON 기본(칸이 없어 고칠 수 없음).
  const only15 = applyCustomWords(girok, OPERATOR);
  assert.equal(say(only15, '노조', 'group'), '소속');
  assert.equal(say(only15, '주간 보고', 'weekly'), '주간 정리');
  assert.deepEqual(EXAMPLES.map(text => say(only15, text, 'example')), ['○○회사·○○단체', '○○팀', '팀장']);
  assert.ok(!SLOT_IDS.includes('affiliation') && !SLOT_IDS.includes('weekly'), '이름 칸은 15칸 그대로');
});

test('내 프로필·묶음·주간 캘린더 칸 글자는 소속·주간 칸 자리로만 부른다', () => {
  const words = read('app/profile-words.mjs');
  assert.match(words, /UNION_WORD = word\('노조', 'group'\)/);
  assert.match(words, /UNION_LABEL = `\$\{UNION_WORD\}명`/);
  assert.match(words, /REPORT_CALENDAR_TITLE = `\$\{WEEKLY_WORD\} 일정 캘린더`/);
  const profile = read('app/profile-settings.js');
  assert.match(profile, /placeholder="\$\{UNION_LABEL\} \(예: \$\{word\('○○노동조합 ○○지부','example'\)\}\)" aria-label="\$\{UNION_LABEL\}"/);
  assert.match(profile, /placeholder="부서명 \(예: \$\{word\('○○사업팀','example'\)\}\)"/);
  assert.match(profile, /placeholder="직책 \(예: \$\{word\('국장','example'\)\}\)"/);
  assert.match(profile, /aria-label="\$\{REPORT_CALENDAR_TITLE\}"/);
  const groups = read('app/collab-groups.js');
  assert.match(groups, /\+ \$\{KIND_NAME\.union\} 만들기/);
  assert.match(groups, /<span>\$\{UNION_LABEL\}<\/span>/);
  assert.match(read('app/collab-groups-model.mjs'), /union: `\$\{UNION_WORD\} 묶음`/);
  // 고정 글자에 노조 낱말이 남지 않는다(주석 빼고).
  for (const file of ['app/profile-settings.js', 'app/collab-groups.js', 'app/collab-groups-model.mjs', 'app/report-settings.js', 'app/report-settings-model.mjs', 'app/report-calendar.mjs']) {
    const code = read(file).replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ [^'"`\n]*$/gm, '');
    assert.doesNotMatch(code, /'노조명|"노조명|>노조명|노조 묶음 만들기|주간 보고 일정 캘린더/, file);
  }
});

test("앱 전체 '주간 보고': WORK ON 기본 '주간 정리', 명진(바탕 nojo)은 문장 안에서도 그대로", () => {
  const mine = applyCustomWords(withWordBaseSync(girok, 'nojo'), OPERATOR);
  for (const text of ['주간 보고', '주간 보고 쓰기 전에 조직별 이번 주를 훑을 때', "주간 보고 '사업' 칸"]) {
    assert.match(say(girok, text), /주간 정리/, text);
    assert.equal(say(mine, text), text, text);
  }
  assert.equal(say(mine, '주간 보고', 'weekly'), '주간 보고');
});

// S67-62: 바탕 낱말 묶음 — 기본은 빌드 얼굴(WORK ON) 낱말, 서버 허용 표 'nojo_words'인 사람은 노동조합+ 낱말 전체가 바탕(그 위에 고친 이름).
test('바탕 낱말 묶음: 서버 기능 목록에서만 정하고, 단어표만 바꾼다', async () => {
  const { WORD_BASE_FEATURES, wordBaseOf, withWordBase } = await import('../app/brand/custom-words-model.mjs');
  assert.deepEqual(WORD_BASE_FEATURES, { nojo_words: 'nojo' });
  for (const bad of [null, undefined, 'nojo_words', {}, [], ['calls', 'telegram'], [1]]) assert.equal(wordBaseOf(bad), null, String(bad));
  assert.equal(wordBaseOf(['calls', 'nojo_words']), 'nojo');
  assert.equal(withWordBase(girok, null), girok);
  assert.equal(withWordBase(girok, 'nope'), girok);
  assert.equal(withWordBase(nojo, 'nojo'), nojo, '같은 단어표면 얼굴 그대로');
  const based = withWordBase(girok, 'nojo');
  assert.equal(based.words, nojo.words);
  for (const key of ['id', 'name', 'shortName', 'icon', 'themeColor', 'menu', 'views']) assert.equal(based[key], girok[key], `${key}는 빌드 얼굴 그대로`);
  assert.ok(Object.isFrozen(based));
});

test('기록+ 빌드 + 바탕 nojo + 명진 15칸 = 노동조합+ 화면 글자(JS word() 고정 글자 전부)', () => {
  const based = applyCustomWords(withWordBaseSync(girok, 'nojo'), OPERATOR);
  assert.equal(based.words, nojo.words, '고친 이름이 모두 기본 이름과 같아 단어표가 nojo 그대로');
  // #2828 '남은 위험 1·2'의 예와 함께, app/의 word() 고정 글자를 모두 nojo와 견준다.
  const samples = ['조직 선택', '관련 조직', '조직 명칭', '+ 사업장 추가', '쟁의 단계', '+ 사업 만들기', '담당 조직', '투쟁 사업장', '우리 쪽 주장과 부딪히는 대목', '조합원을 찾기'];
  for (const text of samples) assert.equal(say(based, text), say(nojo, text), text);
  const literals = wordLiterals();
  assert.ok(literals.length > 200, `word() 글자 ${literals.length}개`);
  for (const [text, slot] of literals) assert.equal(say(based, text, slot), say(nojo, text, slot), text);
  // 바탕 없는 기록+(테스터)는 노조 단어가 바뀐다(대조).
  assert.notEqual(say(applyCustomWords(girok, OPERATOR), '조직 선택'), '조직 선택');
});

test('S67-71 메뉴 이름 칸: 메뉴 항목과 이어진 칸은 사업 관리·조직 관리 둘뿐이고, 그 메뉴 글자와 기본 이름이 같다', async () => {
  const {slotOfMenu} = await import('../app/brand/custom-words-model.mjs');
  const menuSlots = SLOTS.filter(slot => slot.menu);
  assert.deepEqual(menuSlots.map(slot => [slot.menu, slot.id]), [['meetings', 'menu_biz'], ['team', 'menu_org']]);
  assert.equal(slotOfMenu('meetings')?.id, 'menu_biz');
  assert.equal(slotOfMenu('team')?.id, 'menu_org');
  for (const id of ['home', 'note', 'calendar', 'library', '', undefined]) assert.equal(slotOfMenu(id), null, String(id));
  const menu = read('app/menu-model.mjs');
  assert.match(menu, /id: 'meetings', label: word\('사업 관리'\)/);
  assert.match(menu, /id: 'team', label: word\('조직 관리'\)/);
  for (const slot of menuSlots) assert.equal(slot.keys[0], slot.menu === 'meetings' ? '사업 관리' : '조직 관리');
});
