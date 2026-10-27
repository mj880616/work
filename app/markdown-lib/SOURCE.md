# 마크다운 표시 라이브러리 반입 기록

MD-표시용. `node scripts/markdown/vendor-markdown.mjs`로 다시 만들 수 있다. 직접 고치지 않는다. 버전은 `scripts/markdown/md-pin.json` 한 곳에서 관리한다.

| 패키지 | 버전 | 라이선스 | npm sha512 | 파일 수 | 크기 |
| --- | --- | --- | --- | --- | --- |
| markdown-it | 15.0.2 | MIT | `sha512-q4IGxMv56jCqT4OCRCADBoDP3LO4MhmTXjFbphHPXs4g3j9Xg5RDnxqN8IF/3vIWEU+VCnUq+7JUg/cfy2E6Qw==` | 2 | 0.13 MiB |
| dompurify | 3.4.16 | (MPL-2.0 OR Apache-2.0) | `sha512-sqo+pNp3qRhCIpbgRi1y8Tgk27Bo2Ry7w0dC1NBeNTdZChWjz9Xb/KOoZbRP/R6pQZ80Qw8YhXw13hWWBbMRnQ==` | 3 | 0.11 MiB |
| mermaid | 11.17.2 | MIT | `sha512-V6K3C8EBdEsPFZXSKMJe6ppQOENxuHARr9GvHX4hh47lAbhMRD9qf4oEK7LoaRQxULMa80/qt5gHO73aCleBBg==` | 2 | 3.41 MiB |
| katex | 0.18.10 | MIT | `sha512-/B6p9eY9DX7aHBfpkHdpirDTZ5QH9xTwL9y837PWuzuv41O5jFdqNQwVQEQsimY0/iVNkwBY4+4hMfhQ7d4Dbw==` | 23 | 0.53 MiB |

- 넣은 파일: 브라우저에서 쓰는 빌드 파일 1개(KaTeX는 CSS와 woff2 글꼴 포함)와 각 패키지의 `LICENSE`. 나머지(소스맵·타입·다른 형식 글꼴)는 넣지 않는다.
- 총 30개 · 4.18 MiB (`SHA256SUMS` 참고, 이 기록 제외).
- 불러오는 시점: markdown-it·DOMPurify는 바구니 메모 읽기 화면을 열 때, Mermaid는 도식이 있는 글, KaTeX는 수식이 있는 글을 열 때만(`app/markdown-view.js`).
