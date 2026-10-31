# UI-전수디자인점검 조사 결과 (2026-10-29)

조사만 했다. 앱 코드는 바꾸지 않았다. 사진은 저장소 E2E 가짜 서버(`tests/app-e2e/helpers/filter-chip-fixture.mjs`)와 가짜 데이터(가상노조 A지부·가상 회의·가상 메모 등)로만 찍었고 운영 주소·로그인은 쓰지 않았다.

- `findings.json`: 항목 배열(id, screen, width, severity, problem, measured, fix, already, before, after, after_css). `measured`는 화면에서 잰 DOM 값, `after_css`는 고친 모습 예시를 찍을 때 주입한 CSS(시안용, 그대로 쓰는 코드 아님).
- `F**-before.png`·`F**-after.png`: 항목별 지금 모습·고친 모습 예시(폭 900px로 줄임).
- `screens/`: 폭 1920·1280·390에서 메뉴 화면 전체(`<화면>-<폭>.png`)와 주요 창(`dlg-*`), 화면별 잰 값(`metrics-*.json`, `dialogs-*.json`).
- `capture.spec.mjs.txt`·`findings-def.mjs.txt`: 찍은 스크립트 사본. `tests/app-e2e/`에 `.mjs`로 복사해 `AUDIT_FIND=all npx playwright test ...`로 다시 찍을 수 있다(CI에 넣지 않음).
