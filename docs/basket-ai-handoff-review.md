# BASKET-AI맡기기 검토·완료 보고

> 2026-10-22 #926: Drive 사본은 건수 한 줄만 싣는다. 아래 원문·지시문 형식은 폐기. 10번의 “Drive 사본 차이”는 당시 비교 기록이다. 이 PR의 복사 글·붙여넣기 흐름(`basket-ai-handoff.js`, “분류 결과 입력”)은 유지된다.

1. **세션**: Codex 웹·클라우드. 로컬 파일·정적 HTTP·합성 API만 사용.
2. **시작·최종 SHA / branch / PR**: 실제 fetch 시작 `e0705ab30497b0bfc93a78b38882ff926906cc92`(#489). `codex/basket-ai-handoff`, [PR #490](https://github.com/mj880616/work/pull/490), 구현 SHA `6bbc57fa9b322b89b9b98549eb33a2f22cf70fab`. 최종 SHA는 PR 본문과 마지막 검증 댓글에 기록한다(이 문서 자체가 커밋에 포함되므로 자기 SHA를 고정하지 않음).
3. **원인(사실)**: 기존 화면에는 외부 AI에게 줄 글을 통째로 복사하는 기능이 없었고, 파서는 답 전체의 설명을 허용하지 않았다. 화면은 기술 용어·파서 위치·서버 상세 오류를 직접 표시했다. 폰 Drive 부분 복사는 사용자 보고이며 이 세션에서 실기기 재현하지 않았다.
4. **변경 파일**: `basket-ai-handoff.js` 복사 대상·글·조회·클립보드 대체 / `basket-classification.js` 공용 답 형식·답 전체 추출·화면 오류 사전 / `basket-classification-ui.js` 안전 표시 / `basket.js` 버튼·목록 표시. 기존 `parseClassification` 검사 규칙·`basket-data.js` 상태 판단은 유지. 로더→index 및 버전 기대 테스트·smoke 고정 버전 동시 변경. 테스트·원장·합성 예시·8장 캡처 추가.
5. **실행한 테스트**: Node 516/516. 기존 엄격 파서+새 handoff 15/15 포함. 최종 Chromium은 분류·복사 14/14 + 인접 바구니·catalog 51/51 + 캐시 고정 3/3 = 68항목 통과. 긴 메모의 앞·뒤와 마지막 목적지를 실제 네이티브 클립보드에서도 검증. 최초 브라우저 48/52 통과·4실패: 상세 오류를 기대하던 기존 3개, 세션 이벤트에 session을 빠뜨려 로그인 이동 후 테스트 전역값을 잃은 신규 1개. 기존 실패로 돌리지 않았으며 정확한 일상어 기대값과 session 포함 이벤트로 수정. 강화한 기존 세션 검사 1개에서는 runtime.context.set이 다른 사용자 값을 거부한다는 사실도 드러나, 실제 context.clear로 비공개 초안 제거를 검사하도록 바로잡았고 최종 14개 모두 통과. 원문 유지·실패 후 상태·재시도·권한·RPC 검사는 보존. 검토 지적(낮은 catalog 버전·이전 작업의 busy 해제·추가 tilde 블록)도 보완. 새 busy/블록 검사는 수정 전 실패·수정 후 통과.
6. **CI**: PR의 자동 검사 결과는 최종 검증 댓글에 실제 head SHA별로 기록. workflow 수동 실행·재실행·승인은 하지 않는다.
7. **DB·production 영향 / 권한·보안**: DB·migration·RPC·서버 응답·Edge·Drive 사본 변경 없음, 운영 접속·배포 없음. 적용 순서·DB 복구·정지 지점 해당 없음. 기존 owner RLS·로그인·현재 원문 시각 재검사·선택한 연결만 RPC 처리 유지. AI 외부 전송 없음. 사용자가 복사 후 직접 붙여넣음. 답 밖 글은 화면·파서에 전달하지 않음. 본문/AI 결과는 메모리만, 상세 오류를 콘솔에 쓰지 않음. 화면 문제가 있으면 PR 커밋을 되돌리는 별도 PR으로 복구 가능.
8. **사용자 확인 필요**: 커맨드센터가 PR을 검토하고 merge. merge 뒤 실제 폰에서 복사→ChatGPT/Claude 새 대화→답 붙여넣기→확인→원하는 항목 체크→연결하기 확인. 선택 변경 또는 추가 승인 필요 없음.
9. **남은 위험**: AI가 잘못 추천할 수 있으므로 확인·체크 후 연결. 폰의 클립보드 권한·사용자 제스처 정책에 따라 읽기 전용 대체 입력칸 사용. 실기기 확인은 이 세션 검증 범위 밖. 100건을 넘으면 최신 100건만 복사. 본문 최대치인 메모 100건의 전체 부탁 글은 클 수 있으나 잘라서 복사하지 않음; AI 답 입력은 기존 1MiB 상한 유지.
10. **범위 밖 / Drive 사본 차이** *(2026-10-22 #926: 사본의 바구니 절은 건수 한 줄로 바뀌어 아래 비교는 과거 기록)*: `supabase/functions/drive-summary/basket.mjs` 불변. 사본의 기존 “제안 출력 안내”는 JSON만 반환·5가지 kind를 안내하며 100건 초과 시 실패한다. 새 글은 짧은 사람 정리+복사 안내+코드 블록 하나, organization·project만 안내하며 최신 100건으로 제한한다. 사본의 안내에서 나온 울타리 없는 원시 JSON은 새 화면에서 복사용 블록 안내를 받는다. 내부 기존 파서는 원시 JSON을 계속 지원한다. Drive 기준의 미분류는 confirmed·suggested 연결을 모두 제외하므로 새 복사도 동일하다(요청의 “확정 연결 없음”보다 엄격한 기존 제안 제외). KST 오늘 자정−28일~현재, 양 끝 포함. 대체 입력칸·사용자가 붙인 원본 글에는 AI용 필드 이름이 들어갈 수 있으나 화면 라벨·자동 안내·오류에는 노출하지 않는다. 추가 범위 밖 문제 해당 없음.
11. **roadmap**: `docs/roadmap.md`에 BASKET-4a 뒤·4b 앞 BASKET-AI맡기기 진행중 행 및 이 PR 연결.
12. **merge 상태**: 미merge. 커맨드센터 검토·merge 대기.

## 복사 글·AI 답 전문(합성 데이터)

- [복사 글 전문](basket-ai-handoff-prompt-example.txt): 실제 `buildHandoff`로 생성한 전체 글. 원문·시각·첨부 링크·목적지 ID/이름 포함.
- [형식에 맞는 AI 답 전문](basket-ai-handoff-answer-example.txt): 사람 정리와 코드 블록. 원시 블록은 기존 파서, 답 전체는 새 추출+기존 파서로 왕복 확인.

## 바뀐 화면 문구

| 전 | 후 |
| --- | --- |
| 해당 없음 | AI에게 맡기기 |
| 해당 없음 | 복사했어요. ChatGPT나 Claude 새 대화에 붙여 넣으세요. |
| 해당 없음 | 길게 눌러 전체 선택 → 복사 |
| 해당 없음 | 맡길 메모가 없어요 |
| 분류안 붙여넣기 | AI 정리 결과 넣기 |
| AI 출력 | AI가 준 복사용 블록(답 전체를 넣어도 됨) |
| Claude·ChatGPT가 출력한 분류안을 여기에 붙여넣으세요. | ChatGPT나 Claude의 답을 여기에 붙여 넣으세요. |
| 미리보기 | 확인 |
| 선택한 목적지 확정 | 연결하기 |
| 확정 중… | 연결 중… |
| 새로 확정 N개 · 이미 있음 M개 | N개 연결했어요 · M개는 이미 연결돼 있어요 |
| 이미 확정 | 이미 연결됨 |
| 목록·상세: 확정 · 이름 | 연결됨 · 이름 |
| 분류 제안됨 | 정리 제안 있음 |
| 다음 단계에서 지원(4b) | 아직 지원하지 않는 항목 |
| 확정 기능 준비 중 | 연결 기능 준비 중 |
| 원문 바뀜: 다시 분류해 주세요. | 메모가 바뀌었어요. AI에게 다시 맡겨 주세요. |
| 메모 없음 또는 접근 불가 | 메모를 찾거나 열 수 없어요. |
| 메모가 다른 workspace에 있습니다. | 다른 업무 공간의 메모예요. |
| 보관된 메모입니다. | 보관된 메모예요. |
| AI 제외 메모입니다. | AI에게 맡기지 않기로 한 메모예요. |
| 목적지 없음 또는 접근 불가 | 연결할 곳을 찾거나 열 수 없어요. |
| 목적지가 다른 workspace에 있습니다. | 다른 업무 공간에 있는 곳이에요. |
| 현재 선택할 수 없는 목적지입니다. | 지금은 선택할 수 없는 곳이에요. |
| 목적지 형식을 확인해 주세요. | 연결할 곳을 다시 확인해 주세요. |
| 메모 ID와 시각을 확인해 주세요. | 메모 정보가 맞지 않아요. AI에게 다시 맡겨 주세요. |
| 접근 권한을 확인해 주세요. | 이 내용을 열거나 연결할 권한이 없어요. |
| 기존 제안 연결이 있습니다. 연결을 확인해 주세요. | 이미 제안된 연결이 있어요. 현재 연결을 확인해 주세요. |
| JSON·schema·UUID·날짜·중복 키 오류 + (행 n, 열 m) | 복사용 블록의 내용이 맞지 않아요. AI에게 같은 형식으로 다시 정리해 달라고 해 주세요. |
| 설명 글을 제외해 주세요. | AI 답에서 복사용 블록만 넣어 주세요 |
| UTF-8 1 MiB까지 붙여넣을 수 있습니다. | 글이 너무 길어요. 메모 100개 이내의 복사용 블록만 넣어 주세요. |
| 메모는 100개까지 허용합니다. | 메모는 100개까지 넣을 수 있어요. |
| 메모당 목적지는 20개까지 허용합니다. | 메모 하나에 연결할 곳은 20개까지예요. |
| 이유는 1~2,000자입니다. | 연결 이유는 1~2,000자로 써 주세요. |
| 문자열은 2,000자까지 허용합니다. | 한 항목의 글은 2,000자까지 넣을 수 있어요. |
| 중복 메모 ID | 같은 메모가 두 번 들어 있어요. AI에게 다시 정리해 달라고 해 주세요. |
| 확인·연결에서 서버 원문 오류 | 메모와 연결할 곳을 확인하지 못했어요. 다시 눌러 주세요. / 결과를 확인하지 못했어요. 다시 확인을 눌러 현재 연결을 확인해 주세요. |
| 목록·저장에서 서버 원문 오류 | 메모를 불러오지 못했어요. 다시 시도해 주세요. / 저장하지 못했어요. 다시 시도해 주세요. |

## 화면 캡처(합성 데이터·설치 Chromium)

| 화면 | 390px | 1280px |
| --- | --- | --- |
| 맡기기 복사 완료 | [보기](review/basket-ai-handoff/handoff-copied-390.png) | [보기](review/basket-ai-handoff/handoff-copied-1280.png) |
| 결과 넣기 | [보기](review/basket-ai-handoff/handoff-paste-390.png) | [보기](review/basket-ai-handoff/handoff-paste-1280.png) |
| 확인 오류 1건(원문 변경) | [보기](review/basket-ai-handoff/handoff-error-390.png) | [보기](review/basket-ai-handoff/handoff-error-1280.png) |
| 연결 후 | [보기](review/basket-ai-handoff/handoff-connected-390.png) | [보기](review/basket-ai-handoff/handoff-connected-1280.png) |

## 검증 명령·세부 결과

- Node: `node --test tests/*.test.mjs tests/security/*.test.mjs tests/domain/*.test.mjs scripts/*.test.mjs personal/arsenal-match-archive/*.test.mjs` → 516개 통과.
- 구문: `find app -maxdepth 1 -type f -name '*.js' -print0 | xargs -0 -n1 node --check` 통과.
- 로더 캐시: `node scripts/check-loader-cache.mjs --base origin/main` 통과, 운영 참조 401개. 새 파일의 기존 참조는 현재 catalog v2로 맞춤.
- smoke workflow의 정적 dependency graph·public/auth boundary 단계 원문을 로컬 bash로 실행하여 모두 통과. workflow를 실행한 것은 아님.
- `git diff --check` 통과.
- Chromium: `/usr/bin/chromium` 151.0.7922.173, Playwright 1.55.0. 모든 API는 합성 fixture로 가로채며 운영 API에 접속하지 않음.
- Chromium 기능 검사: 바구니·catalog 51개 + 분류·복사 14개, 총 65개 통과(최종 변경 기준). 분류 검사는 390/1280px·키보드/터치·실제 clipboard 전체 복사·권한 실패 대체·빈 대상·시각 변경·선택/RPC·세션/지연 응답·안전한 오류 표시를 포함. 새 복사/정상 연결 경로 콘솔 오류 0; 기존 함수 부재 회귀 2개만 의도한 404 브라우저 리소스 오류 각 1개를 그대로 검사.
- 버전 기대 검사: startup core preload·calendar hotfix·canonical task owner 3개 통과.
- 캐시 경로: classification v2 → classification UI v2 / handoff v1 → basket v7 → view-loader v119 → loader-v2 v352 → app v240 → index. basket-data v3·project-catalog v2·CSS 불변.
