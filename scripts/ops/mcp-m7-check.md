# MCP-Claude읽기 M-7 켜기 전 시험 절차 (CC 전용, 브라우저 JS)

설계: `docs/design/mcp-claude-read.md` 9절 M-7 · 13절(첫 결과) · 14.4(늘린 시험표). 이 절차는 CC가 운영에서 한다(작업 세션은 하지 않음, AGENTS §6).

## 지키는 것

- **열쇠 값은 어디에도 내지 않는다.** 화면·콘솔·채팅·PR·문서에 위임 열쇠(access token)·새로고침 열쇠·이메일·사용자 ID를 쓰지 않는다. 결과는 **시험 번호·HTTP 상태 코드·통과 여부**만 본다(응답 본문은 읽지 않는다. 예외: ⑦의 오류 코드 글자 하나만).
- 시험용 계정 변경은 **값 없는 요청만** 보낸다: `PUT /user`는 `{"data":{}}`·`{"email":""}`·`{"password":""}`, `POST /factors`는 `{}`(인증 수단 종류 없음 → 만들어지지 않음), 신원 연결은 공급자 없이 + 넘겨주기(redirect) 따라가지 않음.
- `POST /reauthenticate`는 지금 판에서 명진 메일로 확인 번호를 **실제로 보낸다**. 그래서 `GET /user`가 403일 때(= Supabase 수정이 들어온 판)만 보낸다. 그 전에는 "건너뜀"으로 표시하고 실패로 센다.
- 스위치(설정 행 `enabled`)는 **꺼진 채로** 한다. 켜지 않는다.
- 하나라도 실패하면 **OAuth 서버를 다시 끄고 멈춘다**(9절 M-7 규칙). M-8로 가지 않는다.

## 준비

1. Supabase Auth에 수정([supabase/auth#2898](https://github.com/supabase/auth/pull/2898))이 들어온 것을 릴리스·변경 기록으로 확인한다(14.4 4번).
2. `mcp-read`가 userinfo로 열쇠를 확인하는 판(S70-56)으로 운영에 배포돼 있는지 확인한다(`docs/web2-env6b-edge-source.md` 5절 47행).
3. 대시보드에서 OAuth 서버를 켠다(4.5 순서). 켜기 전·후 화면 캡처.
4. 13절 첫 시험 때와 같은 방법으로 위임 열쇠를 받는다(동의 화면 [허락]). 받은 열쇠는 브라우저 콘솔 변수에만 둔다(아래 `T`). 콘솔에 값을 찍지 않는다.

## 실행 (브라우저 개발자 도구 콘솔에 붙여 넣기)

`BASE`는 프로젝트 주소, `ANON`은 공개(anon) 키, `T`는 위임 열쇠. 세 값은 붙여 넣기 전에 콘솔 변수로 따로 넣고, 아래 코드에는 쓰지 않는다.

```js
// 사용: await m7Check({ base: BASE, anon: ANON, token: T })
// 출력: 시험 번호·상태 코드·통과 여부만. 열쇠·응답 본문은 출력하지 않는다.
async function m7Check({ base, anon, token }) {
  const h = (extra = {}) => ({ apikey: anon, Authorization: `Bearer ${token}`, ...extra });
  const json = { 'Content-Type': 'application/json' };
  const call = async (path, init = {}) => {
    try {
      const res = await fetch(base + path, { redirect: 'manual', ...init, headers: h(init.headers) });
      return res;
    } catch (e) {
      return { status: 0, ok: false, type: 'error', json: async () => null, text: async () => '' };
    }
  };
  const rows = [];
  const add = (id, name, status, pass) => rows.push({ id, name, status, pass: pass ? '통과' : '실패' });
  const is403 = (s) => s === 403;

  // ① REST 표 직접 읽기 → 403 (L1)
  let r = await call('/rest/v1/app_pages?select=id&limit=1');
  add('①', 'REST 표 GET', r.status, is403(r.status));
  // ② app_mcp_* 밖 RPC(읽기 전용 함수) → 403 (L1)
  r = await call('/rest/v1/rpc/app_my_features', { method: 'POST', headers: json, body: '{}' });
  add('②', 'app_mcp_* 밖 RPC', r.status, is403(r.status));
  // ③ Storage 버킷 목록 → 거절 또는 빈 목록 (L2)
  r = await call('/storage/v1/bucket');
  let empty = false;
  if (r.status === 200) { const b = await r.json().catch(() => null); empty = Array.isArray(b) && b.length === 0; }
  add('③', 'Storage 버킷 목록', r.status, (r.status >= 400 && r.status < 500) || empty);
  // ④ Edge 함수(서버 키 쓰는 함수) → 401 (L3)
  r = await call('/functions/v1/library-files', { method: 'POST', headers: json, body: '{}' });
  add('④', 'Edge 함수 library-files', r.status, r.status === 401);
  // ⑤ 계정 기능 — 모두 403이어야 통과 (14.4)
  r = await call('/auth/v1/user', { method: 'PUT', headers: json, body: '{"data":{}}' });
  add('⑤-1', 'PUT /user data', r.status, is403(r.status));
  r = await call('/auth/v1/user');
  const userBlocked = is403(r.status);
  add('⑤-2', 'GET /user', r.status, userBlocked);
  r = await call('/auth/v1/user', { method: 'PUT', headers: json, body: '{"email":""}' });
  add('⑤-3', 'PUT /user email(빈 값)', r.status, is403(r.status));
  r = await call('/auth/v1/user', { method: 'PUT', headers: json, body: '{"password":""}' });
  add('⑤-4', 'PUT /user password(빈 값)', r.status, is403(r.status));
  r = await call('/auth/v1/factors', { method: 'POST', headers: json, body: '{}' });
  add('⑤-5', 'POST /factors(종류 없음)', r.status, is403(r.status));
  r = await call('/auth/v1/user/identities/authorize');
  add('⑤-6', 'GET /user/identities/authorize', r.status, is403(r.status));
  if (userBlocked) {
    r = await call('/auth/v1/reauthenticate', { method: 'POST', headers: json, body: '{}' });
    add('⑤-7', 'POST /reauthenticate', r.status, is403(r.status));
  } else {
    add('⑤-7', 'POST /reauthenticate(건너뜀: GET /user가 열려 있어 메일 발송 위험)', '-', false);
  }
  // ⑥ 읽생기 표 → 403 (L1)
  r = await call('/rest/v1/rtw_notes?select=id&limit=1');
  add('⑥', '읽생기 표 GET', r.status, is403(r.status));
  // ⑦ 허용 RPC, 스위치 꺼짐 → 403 DISCONNECTED (문지기)
  r = await call('/rest/v1/rpc/app_mcp_google_where', { method: 'POST', headers: json, body: '{}' });
  const p = r.status === 403 ? await r.json().catch(() => null) : null;
  const code = p && typeof p.message === 'string' && /^DISCONNECTED\b/.test(p.message) ? 'DISCONNECTED' : '';
  add('⑦', '허용 RPC(스위치 꺼짐)', `${r.status} ${code}`.trim(), r.status === 403 && code === 'DISCONNECTED');
  // ⑧ userinfo → 200 (mcp-read 열쇠 확인 길, S70-56)
  r = await call('/auth/v1/oauth/userinfo');
  add('⑧', 'GET /oauth/userinfo', r.status, r.status === 200);
  // ⑨ mcp-read 입구 ping → 200 (스위치가 꺼져도 ping은 DB를 부르지 않음)
  r = await call('/functions/v1/mcp-read', { method: 'POST', headers: json, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
  add('⑨', 'mcp-read ping', r.status, r.status === 200);

  console.table(rows);
  const failed = rows.filter((x) => x.pass !== '통과').map((x) => x.id);
  console.log(failed.length ? `실패: ${failed.join(', ')} → OAuth 서버 끄고 멈춤` : '모두 통과 → M-8 진행 가능');
  return { pass: failed.length === 0, failed };
}
```

## 판정·기록

- 모두 통과 → 설계 13절 아래에 새 결과 표(날짜·조건·시험 번호·상태 코드·판정)를 더하고 M-8로 간다.
- 하나라도 실패 → 대시보드에서 OAuth 서버를 끄고, 결과 표만 기록한 뒤 멈춘다. ⑤-7 "건너뜀"도 실패다.
- 끝나면 콘솔 변수 `T`를 지우고(`T = undefined`) 탭을 닫는다. 받은 위임 열쇠는 OAuth 서버를 끄면 무효로 본다(13절).
