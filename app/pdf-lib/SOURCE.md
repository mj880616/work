# PDF 글자 읽기 라이브러리 반입 기록

MEET-파일로만들기용. `node scripts/pdf/vendor-pdf.mjs`로 다시 만들 수 있다. 직접 고치지 않는다. 버전은 `scripts/pdf/pdf-pin.json` 한 곳에서 관리한다.

| 패키지 | 버전 | 라이선스 | npm sha512 | 파일 수 | 크기 |
| --- | --- | --- | --- | --- | --- |
| pdfjs-dist | 6.3.289 | Apache-2.0 | `sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==` | 28 | 1.92 MiB |

- 넣은 파일: 오래된 폰 브라우저도 쓰는 legacy 빌드(`pdf.min.mjs`·`pdf.worker.min.mjs`), `LICENSE`, 한국어 글자표(`cmaps/`의 Adobe-Korea1·KSC·UniKS와 그 `LICENSE`). 나머지(소스맵·뷰어·표준 글꼴·다른 언어 글자표)는 넣지 않는다.
- 불러오는 시점: 회의 [파일·글로 만들기]에서 PDF 결과 파일을 읽을 때만(`app/meeting-file-text.js`). 글자만 읽고 화면에 그리지 않는다.
