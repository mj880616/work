#!/usr/bin/env bash
# PERF-첫로딩 P1: 측정 기준선 한 벌(docs/design/first-load.md 7절). 같은 조건을 ROUNDS번(기본 3) 따로 띄워 재고 요약표를 만든다.
# 앞준비: (cd scripts && npm ci), @playwright/test 설치, 빌드 결과를 serve-built.mjs로 띄움(아래 ORIGIN).
# 사용법: ORIGIN=http://127.0.0.1:8125 OUT=/tmp/perf bash scripts/perf/run-baseline.sh
# 측정 하나가 실패해도 나머지를 계속 재고, 요약은 모인 줄로 만든다(이 스크립트는 0으로 끝난다).
set -uo pipefail
ORIGIN="${ORIGIN:-http://127.0.0.1:8125}"
OUT="${OUT:-/tmp/perf-baseline}"
ROUNDS="${ROUNDS:-3}"
INNER="${INNER:-3}" # 한 회차 안에서 재는 횟수(가운데 값을 회차 값으로 쓴다)
LOAD_PROFILES="${LOAD_PROFILES:-local,phone,phone-warm}"
SWITCH_PROFILES="${SWITCH_PROFILES:-local,phone}"
mkdir -p "$OUT"
: > "$OUT/perf.jsonl"
export WEB2_TEST_ORIGIN="$ORIGIN" APP_E2E_ORIGIN="$ORIGIN"
for round in $(seq 1 "$ROUNDS"); do
  echo "== round $round/$ROUNDS"
  PERF_ROUND="$round" PERF_RUNS="$INNER" PERF_PROFILES="$LOAD_PROFILES" \
    npx playwright test scripts/perf/first-load.spec.mjs --workers=1 --reporter=line > "$OUT/load-$round.log" 2>&1 \
    || echo "round $round first-load: 실패(기록은 $OUT/load-$round.log)"
  PERF_ROUND="$round" PERF_RUNS="$INNER" PERF_PROFILES="$SWITCH_PROFILES" \
    npx playwright test scripts/perf/tab-switch.spec.mjs --workers=1 --reporter=line > "$OUT/switch-$round.log" 2>&1 \
    || echo "round $round tab-switch: 실패(기록은 $OUT/switch-$round.log)"
  # line 보고기는 줄 앞에 커서 이동 글자(ESC[1A ESC[2K)를 붙여 덮어 쓴다 → 걷어 낸 뒤 줄 머리로 고른다(안 걷으면 측정 줄 일부가 빠짐).
  cat "$OUT/load-$round.log" "$OUT/switch-$round.log" | sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' | grep -E '^(PERF|PERF_SHELL|PERF_SWITCH) \{' >> "$OUT/perf.jsonl" || true
done
# 자료 요청 종류별 수(회차 1, 첫 측정, 경로 이름만). 요청 합치기 전후 비교용(S48-59).
sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$OUT/load-1.log" | grep '^PERF_DATA ' || true
# 화면 바꾸기 때 클릭 뒤 새로 받은 JS 파일 이름(회차 1, 첫 측정). 회귀 원인 찾기용.
sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$OUT/switch-1.log" | grep '^PERF_SWITCH_FILES ' || true
# 화면 바꾸기 시험이 끝난 모양(통과·실패 줄, 오류 첫 줄). 표에 화면 바꾸기 칸이 빠졌을 때 까닭을 본다.
sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$OUT/switch-1.log" | grep -E '(passed|failed|flaky|Error|Timeout)' | head -n 12 || true
node scripts/perf/summarize.mjs "$OUT/perf.jsonl" > "$OUT/summary.md"
cat "$OUT/summary.md"
exit 0
