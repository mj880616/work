# rhwp 0.8.7 반입 기록

HWP-편집기 1단계 시험판용. `scripts/hwp-lab/build-rhwp-studio.sh`로 다시 만들 수 있다. 직접 고치지 않는다.

| 항목 | 값 |
| --- | --- |
| 편집기 본체 `studio/` | github.com/edwardkim/rhwp 태그 `v0.8.7` (커밋 `1a76570e833917d15817415a53c09ad61ab3203f`)의 `rhwp-studio`를 `RHWP_DISABLE_EXTERNAL_WEBFONTS=1 RHWP_WITHOUT_HWPCTRL=1 vite build --base=./`로 빌드 |
| WASM 엔진 | npm `@rhwp/core@0.8.7` (`sha512-qgNpY9aclCvy9D7cPnpuplu42kUFZCCPhdjAS5HBso4Z4XeHG3uchYdUleQBoas/zEuwfJ7H4/ulepqdL/LXDA==`) |
| 임베드 SDK `sdk/` | npm `@rhwp/editor@0.8.7` (`sha512-+765+dsh45HHb0o1fzGJyS8JBsGUtnX9oN/0a+9xGERztPEzkemdiGsVpje+awy/Cn033/KDK2LyiaFhWfAr/g==`) |
| 라이선스 | `LICENSE`(MIT), `THIRD_PARTY_LICENSES.md`, 글꼴 `studio/fonts/FONTS.md`·`studio/fonts/*OFL*` |
| 뺀 파일 | PWA 서비스워커·설치 정보·아이콘, 예제 문서(`samples/`), 중복 엔진 사본 |
| 넣은 것 | `studio/index.html`·`print.html`에 외부 주소 차단 CSP, `index.html` 맨 앞에 `../../studio-guard.js`(기기 저장 차단)·`../../studio-styles.js`(노조 양식 스타일 단축키·버튼)·`../../studio-convert.js`(노조 서식으로 만들기), 편집기 번들에 엔진 클래스를 칸막이 안에 내놓는 한 줄(`scripts/hwp-lab/expose-engine.mjs`) |
| 파일 수·총 크기(이 기록 제외) | 55개 · 43.2 MiB (`SHA256SUMS` 참고) |
