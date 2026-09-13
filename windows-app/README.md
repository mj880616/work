# 업무 현황 Windows 앱 (보관용)

Windows 전용 wrapper 개발은 중단했습니다. 현재 기준의 정식 PC 사용 환경은 모바일 앱과 같은 프론트엔드·같은 Supabase 데이터를 사용하는 반응형 웹 `https://mj880616.github.io/work/app/` 입니다.

이 폴더는 기존 Windows x64 WebView2 thin wrapper 소스를 보관하기 위한 용도입니다. 자동 빌드는 중단했고, 필요할 때만 GitHub Actions의 `Build Windows app (legacy/manual)`을 수동 실행할 수 있습니다.

## 기존 동작

- Microsoft Edge WebView2로 앱을 표시합니다.
- 로그인 상태와 WebView 데이터는 `%LOCALAPPDATA%\KPTUWork\WebView2`에 유지됩니다.
- `mj880616.github.io` 밖의 링크와 `?external=1` 링크는 기본 브라우저에서 엽니다.
- 파일 업로드는 Windows 파일 선택기를 사용합니다.

## 수동 빌드

```powershell
dotnet publish .\windows-app\KPTUWork.csproj -c Release -r win-x64 --self-contained true -o .\publish\KPTUWork
```

새 PC 기능은 이 wrapper가 아니라 `/app/` 반응형 웹에 구현합니다.
