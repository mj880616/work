# BASKET-클립아이콘 검증

📱 Codex 웹·클라우드. 시작 시 원격 `origin/main`을 새로 fetch했고 실제 시작 SHA는 `8bb8d717cb388ac6c99d810e70783284c974ffe1`(#482 merge)다. 작업 브랜치는 `codex/basket-clip-icon`이며 [PR #483](https://github.com/mj880616/work/pull/483)을 연결 GitHub 도구로 생성했다. PR·CI·merge 상태는 [원장](../../roadmap.md)과 PR에서 추적한다.

홈 바구니는 입력칸 안 왼쪽의 📎 버튼과 오른쪽의 기존 “추가” 버튼을 한 줄로 표시한다. 📎는 44×44px의 네이티브 버튼이며 접근 이름은 “파일 첨부”다. 키보드 Tab·Enter·Space와 터치로 같은 파일 선택기를 연다. 입력칸은 46px 높이와 왼쪽 46px 안쪽 여백으로 버튼 및 선택 개수 배지와 글자가 겹치지 않게 했다. 새 아이콘 이미지 파일 없이 기존 텍스트 이모지 방식을 쓴다.

별도 “파일 추가” 줄과 미선택 한도 안내를 없앴다. 한도는 선택 목록 위 작은 한 줄 또는 기존 초과 오류로만 표시한다. “바구니 전체 보기”는 입력 줄 바로 아래이며 미선택 목록/옵션은 레이아웃 공간을 차지하지 않는다. 할 일·업데이트 모드에서는 첨부 버튼을 숨기고 기존 옵션·링크 순서를 유지한다.

상세는 `rows=12`의 여러 줄 메모 편집기이므로 📎를 본문 왼쪽 위에 겹치게 놓으면 첫 줄과 편집 공간을 침범한다. 사용자 지시의 상세 예외에 따라 메모 아래 도구줄 왼쪽에 배치했다. 홈과 동일한 `mountBasketPicker` 및 바구니 전용 CSS를 사용한다. 상세도 전체 첨부 성공 후 선택 목록·배지·한도를 비우며, 저장된 첨부 링크·note_id·미저장 본문은 보존한다.

PC 파일 드롭은 홈 카드 전체와 상세 편집 영역(입력칸 포함)에서 받는다. 파일 드래그 동안에만 점선 outline과 “파일을 놓아 첨부” 표시가 나타나며, 떠나기·drop·dragend·비활성화에서 제거한다. 텍스트 드래그는 가로채지 않는다. 순차 전송·사전 검증·중간 실패·결과 불명 시 차단·완료 파일 재전송 방지·세션 변경 보호는 기존 경로를 사용한다. 자료실·회의의 업로드 선택기/CSS/서버 함수는 수정하지 않았다.

## 높이 측정

설치된 Chromium `151.0.7922.173`, 390×1000 / 1280×1000 viewport, 동일한 모의 로그인·홈 데이터와 미선택 상태다. 실제 `getBoundingClientRect()`로 측정했다. Playwright 전용 Chromium 다운로드는 환경 정책으로 차단되어 `/usr/bin/chromium`을 사용했다. 운영 서비스에 접속하지 않았다.

| 항목 | 390px 전→후 | 1280px 전→후 |
| --- | --- | --- |
| 홈 바구니 카드 높이 | **204→158px, 46px(22.55%) 감소** | **228→158px, 70px(30.70%) 감소** |
| 입력 줄 아래→전체 보기 링크 위 | **56→4px** | **80→4px** |
| 📎 터치/키보드 버튼 | 기존 별도 줄 | **44×44px** |

측정 원문: [전 390](before-390.json) · [후 390](after-390.json) · [전 1280](before-1280.json) · [후 1280](after-1280.json).

## 전후 캡처

| 화면 | 390px 전 | 390px 후 | 1280px 전 | 1280px 후 |
| --- | --- | --- | --- | --- |
| 홈 미선택 | [전](before-home-390.png) | [후](after-home-390.png) | [전](before-home-1280.png) | [후](after-home-1280.png) |
| 메모 상세 미선택 | [전](before-detail-390.png) | [후](after-detail-390.png) | [전](before-detail-1280.png) | [후](after-detail-1280.png) |
| 홈 선택 목록·배지 | 해당 없음 | [선택 후](after-home-selected-390.png) | 해당 없음 | [선택 후](after-home-selected-1280.png) |
| 상세 선택 목록·배지 | 해당 없음 | [선택 후](after-detail-selected-390.png) | 해당 없음 | [선택 후](after-detail-selected-1280.png) |
| 파일 드래그 중 | 해당 없음 | 해당 없음 | 해당 없음 | [홈](after-home-dragging-1280.png) · [상세](after-detail-dragging-1280.png) |

## 검증

- 변경 전 기존 바구니 35/35 및 Node 464/464 통과. 전후 캡처 검사는 별도 2개를 실행했다.
- 신규 390/1280px 검사는 “파일 첨부” 버튼이 없는 이유로 RED를 확인한 뒤 구현했다. 홈 높이는 기존 204px보다 최소 44px 작다는 기준(160px 이하)으로 확인한다. 입력 wrapper는 flex로 만들어 textarea 아래 inline baseline 여백을 제거했다.
- 신규 검사는 Tab→Space/Enter로 파일 선택, 390px 📎 터치→선택, 목록의 이름·크기·대기·취소, 배지 1→3→2, 한도 위치, 저장 후 비움, 상세 미저장 원문 보존, 1280px 입력칸/카드 드롭·드래그 중에만 점선 표시·일반 텍스트 드래그 비가로채기, 다른 홈 모드에서 파일 드롭 무시, 가로 넘침 없음 및 정상 콘솔 오류 0을 검증한다.
- 최종 관련 Chromium 검사: **135/135 통과**. 바구니 37개(기존 35개 유지 + 신규 2개), 홈 빠른 입력·자료실 전송·자료실/회의 회귀·캐시 기대 spec을 함께 확인했다. 1440px 시각 사례는 실행에서 제외하고 화면 검증은 390/1280px로 제한했다.
- Node `node --test tests/*.test.mjs tests/security/*.test.mjs tests/domain/*.test.mjs scripts/*.test.mjs`: **464/464 통과**.
- JS 구문, 정적 smoke의 의존성·화면·권한 불변식, 로컬 정적 HTTP 검사, 캐시 그래프 **395참조**, `git diff --check` 통과. `.github/workflows/app-smoke-check.yml`의 정적 검사 명령만 로컬에서 실행했으며 GitHub workflow 수동 실행·승인은 하지 않았다.
- 별도 읽기 전용 코드 리뷰: 수정 필요 지적 없음. 외부 OS 파일 드래그는 Playwright `DataTransfer` 이벤트로 검증했으며 실제 폰 파일 선택기·OS 드래그는 실기기 확인 항목이다.

### 기존 테스트 변경 목록

기존 테스트를 삭제하거나 약화하지 않았다.

| 파일 | 변경 이유·내용 |
| --- | --- |
| `basket.spec.mjs` | 상세 `.library-dropzone` 선택자를 접근 이름 “파일 첨부”의 네이티브 button으로 교체. 기존 저장·오류·순차 전송 검사는 그대로 유지. |
| `basket-home-compact.spec.mjs` | label/mobile text 선택자를 📎 button으로 교체. 상시 한도→미선택 숨김/선택 후 문구 검사, 평소 점선→파일 드래그 중 카드 점선 검사, 모바일 버튼·한도 같은 줄 정렬→버튼 가로·세로 44px 검사. 입력→링크 상한 60/96px를 8px로 강화. 캡처 경로를 이번 작업 폴더 아래로 변경해 #482 증거 덮어쓰기를 방지. |
| `calendar-hotfix.spec.mjs` | index의 app/loader 고정 캐시 버전 기대값만 갱신. |
| `startup-performance.spec.mjs` | app/loader/view-loader 고정 캐시 버전 기대값만 갱신. |
| `task-layout-groups.spec.mjs` | app/loader 고정 캐시 버전 기대값만 갱신. |
| `basket-clip-icon.spec.mjs` | 신규 동작·배치·카드 높이·선택 초기화·터치·키보드·드롭 검사 2개 추가. |

캐시: basket-upload **v3** → basket **v4** / home-quick **v7** → home-read **v15**; basket-picker CSS **v2** / basket CSS **v3** / home-read CSS **v12** → view-loader **v116** → loader-v2 **v349** → app **v237** → index modulepreload/script. 버전 기대 spec 및 app-smoke-check.yml의 고정 view-loader 버전도 함께 갱신했다.

DB·RLS·Edge·서버 함수·Cloudflare 변경과 운영 접속은 없다. 화면 변경 복구는 이 PR revert 후 AGENTS 캐시 규칙 적용이다. 사용자는 merge 후 폰에서 홈/상세 📎 선택·목록·배지·저장 후 비움과 실패 시 보존을 확인한다. merge는 커맨드센터 담당이다.
