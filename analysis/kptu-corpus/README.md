# KPTU 성명·보도자료·취재요청 코퍼스 분석

기준일: 2026-09-18

## 핵심 결과

- 2023~2026 게시물 메타데이터: 2,011건
- 분석 표본: 180건
- 검증 심층독해: 48건
- 사용자 2024 작성자료 8건 비교
- 2026 9/14 사용자 담당 취재요청↔보도자료 추가 비교
- 실제 기사 반영 비교
- 장르별 실무 템플릿 및 아카이브 무결성 규칙 작성

## 먼저 읽을 파일

1. findings-v1.md — 전체 1차 분석
2. evolution-2024-2026.md — 2024→2026 제작 방식 변화
3. media-uptake-v1.md — 원문→기사 반영
4. practical-guide-v1.md — 실무 작성 시스템
5. reference-examples-v1.md — 기능별 참고 사례
6. archive-integrity-v1.md — 아카이브 원문 무결성 규칙

## 바로 쓰는 템플릿

- templates/00-event-factsheet.md — 사건 원본정보
- templates/01-press-request.md — 취재요청
- templates/02-press-release.md — 행사 후 기사형 보도자료
- templates/03-statement.md — 성명
- templates/04-preflight-checklist.md — 배포 전 3분 QA

## 데이터

### 전체 메타
metadata-2023-2026.json

총 2,011건.

주요 장르:
- 보도자료 662
- 취재요청 618
- 성명 524

### 180건 표본
selected-180.json

- 보도자료 60
- 취재요청 60
- 성명 60
- 각 연도 45
- 우선분야 108

### 추출 본문
text/

장르×연도 12개 JSON.

### 추출 품질
extraction-summary.json

180/180 추출 완료.
- HWP 직접 137
- HTML fallback 43
- 저텍스트 11

### 검증
validation-summary.json

- 작성부서 불일치 5
- 제목-본문 겹침이 매우 낮은 의심자료 27

의심자료는 원본 오류와 추출 실패가 섞여 있으므로 자동 폐기하지 않고 원본확인 대상으로 사용.

### 심층독해
deep-sample-valid-48.json
deep-valid/

검증조건을 통과한 48건.

### 구조특성
feature-summary.json

장르·연도별 길이, 문장수, 숫자·인용·요구·근거 표현 등의 보조 지표.

### 사용자 자료 ↔ KPTU 매칭
user-archive-matches.json

Drive 원본과 공개 게시물 후보를 연결한 결과.

## 수집·분석 스크립트

- scripts/kptu_corpus_collect.py — 전체 메타데이터 수집
- scripts/kptu_corpus_select.py — 180건 층화 표본
- scripts/kptu_corpus_extract.py — HWP/HTML 본문 추출
- scripts/kptu_validate_corpus.py — 제목·작성부서·본문 일치도 검증
- scripts/kptu_build_valid_deep_sample.py — 심층독해 48건 선정
- scripts/kptu_corpus_features.py — 정량 보조지표
- scripts/kptu_match_user_archive.py — 사용자 원본↔KPTU 게시물 매칭

## 현재까지 가장 중요한 결론

### 글쓰기
1. 강점은 핵심 숫자와 현장사례를 구조적 문제로 연결하는 능력.
2. 취재요청은 '행사 설명'보다 기자의 취재판단을 돕는 문서여야 함.
3. 보도자료는 취재요청의 확장판이 아니라 행사 후 새 사실로 다시 써야 함.
4. 성명은 사건→판단→근거→요구의 논증구조가 가장 안정적.
5. 판정·사망·질병 등은 확인 사실과 조직 평가를 반드시 분리.

### 제작
1. 2024년에는 본문+발언문+자료를 한 HWP에 묶는 경향이 강했음.
2. 2026년 9/14에는 메인 기사형 본문과 source pack을 분리하는 구조로 개선.
3. HWP를 유일한 원본으로 두기보다 사건 단위의 구조화 텍스트/Web1을 원본 레이어로 둘 가치가 큼.
4. KPTU 첨부 오류가 실제 확인됐으므로 아카이브는 내용 무결성 검증이 필요.

## 다음 확장 과제

- 작성자가 명확히 확인되는 2025~2026 사용자 자료 추가 확보
- 기사클리핑 확대
- Web1 성명·보도자료 아카이브에 verification 상태 도입
- 새 사건에서 템플릿을 실제 사용해 작성→기사화 결과 반복 측정
