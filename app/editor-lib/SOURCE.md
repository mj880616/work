# 편집기 라이브러리 반입 기록

ED-통합편집기용(설계 `docs/design/unified-editor.md` 2.2). `node scripts/editor/vendor-editor.mjs`로 다시 만들 수 있다. 직접 고치지 않는다.
버전은 `scripts/editor/editor-pin.json` 한 곳에서 관리한다. 패키지 하나라도 바꾸면 pin의 `bundle.version`을 올려 폴더 이름(=주소)을 바꾼다
(판 번호 폴더 안쪽은 빌드가 `?v=`를 붙이지 않으므로 같은 주소에 다른 내용을 두지 않는다).

| 패키지 | 버전 | 라이선스 | npm sha512 |
| --- | --- | --- | --- |
| prosemirror-model | 1.25.12 | MIT | `sha512-Ue2gTmXMa7EhpLNhC7J+h4+ykD8ha12K6rrZFFKKJHBForfIStw5gJ6Zrf1mqqAa9NmpmEB4wp9bKmA4eUVjWg==` |
| prosemirror-state | 1.4.4 | MIT | `sha512-6jiYHH2CIGbCfnxdHbXZ12gySFY/fz/ulZE333G6bPqIZ4F+TXo9ifiR86nAHpWnfoNjOb3o5ESi7J8Uz1jXHw==` |
| prosemirror-view | 1.42.6 | MIT | `sha512-3g25f6hKV2bBxo3puH3EcYWmmVNSH0iWmNsMVT7sugDSpA025jgpOLarcDWr39SdzPjYMaiYtRdNtXialPSjEQ==` |
| prosemirror-transform | 1.12.2 | MIT | `sha512-PE/aY0HEY4zczvmqrilgkUK/WautF0chvMqkmM/iN5/aPHvwrCWaQZjS6CIZp+K84YrvPFqrL+YArrfJX8xX7g==` |
| prosemirror-commands | 1.7.2 | MIT | `sha512-q6Q6szxqdu9Xd6EcdKsqXghu5nQdZTpB4Q9yd04WRc7/jt763e/rT60Owh0L1GYY+T46o5rD+9lEN36dZS43tw==` |
| prosemirror-history | 1.5.1 | MIT | `sha512-onlwnqKvgtFg6srZOmDOAhlAy1FIHQpOExORybX0S+DvJepE5tPALrB9iGet/2sqqqrelSnB10OoiOJqAvu2DA==` |
| prosemirror-keymap | 1.2.3 | MIT | `sha512-4HucRlpiLd1IPQQXNqeo81BGtkY8Ai5smHhKW9jjPKRc2wQIxksg7Hl1tTI2IfT2B/LgX6bfYvXxEpJl7aKYKw==` |
| prosemirror-tables | 1.8.5 | MIT | `sha512-V/0cDCsHKHe/tfWkeCmthNUcEp1IVO3p6vwN8XtwE9PZQLAZJigbw3QoraAdfJPir4NKJtNvOB8oYGKRl+t0Dw==` |
| prosemirror-gapcursor | 1.4.1 | MIT | `sha512-pMdYaEnjNMSwl11yjEGtgTmLkR08m/Vl+Jj443167p9eB3HVQKhYCc4gmHVDsLPODfZfjr/MmirsdyZziXbQKw==` |
| prosemirror-schema-list | 1.5.1 | MIT | `sha512-927lFx/uwyQaGwJxLWCZRkjXG0p48KpMj6ueoYiu4JX05GGuGcgzAy62dfiV8eFZftgyBUvLx76RsMe20fJl+Q==` |
| orderedmap | 2.1.1 | MIT | `sha512-TvAWxi0nDe1j/rtMcWcIj94+Ffe6n7zhow33h40SKxmsmozs6dz/e+EajymfoFcHd7sxNn8yHM8839uixMOV6g==` |
| rope-sequence | 1.3.4 | MIT | `sha512-UT5EDe2cu2E/6O4igUr5PSFs23nvvukicWHx6GnOPlHAiiYbzNuCRQCuiUdHJQcqKalLKlrYJnjY0ySGsXNQXQ==` |
| w3c-keyname | 2.2.8 | MIT | `sha512-dpojBhNsCNN7T82Tm7k26A6G9ML3NkhDsnw9n/eoxSRlVBB4CEtIQ/KTCLI2Fwf3ataSXRhYFkQi3SlnFwPvPQ==` |

- 묶기: esbuild 0.28.2(고정)로 `scripts/editor/entry.mjs`를 한 파일 ESM(`pm-ed1-1.1.0/prosemirror.min.mjs`, 247.5 KiB)로 묶었다. 각 패키지 라이선스 전문은 같은 폴더 `LICENSE`.
- 불러오는 시점: 새 편집기를 열 때만(`app/ed-editor.js`). 읽기 화면(Web1 공유 페이지 포함)은 이 묶음을 받지 않는다(`app/ed-render.mjs`).
