# 업무 현황 Windows 앱

Android 앱과 같은 `https://mj880616.github.io/work/app/`을 표시하는 Windows용 thin wrapper입니다.

## 동작

- Microsoft Edge WebView2로 앱을 표시합니다.
- 로그인 상태와 WebView 데이터는 `%LOCALAPPDATA%\KPTUWork\WebView2`에 유지됩니다.
- `mj880616.github.io` 밖의 링크와 `?external=1` 링크는 기본 브라우저에서 엽니다.
- Google 로그인은 기본 브라우저에서 진행하고 `kptuwork://auth`로 안전하게 앱에 로그인 정보를 넘깁니다.
- 첫 실행 시 현재 사용자 영역(HKCU)에 `kptuwork://` 프로토콜을 자동 등록하므로 관리자 권한이 필요하지 않습니다.
- 파일 업로드는 Windows 파일 선택기를 그대로 사용합니다.
- 한 번에 하나의 앱 창만 유지하고, 로그인 콜백으로 다시 실행되면 기존 창에 전달합니다.

## 빌드

```powershell
dotnet publish .\windows-app\KPTUWork.csproj -c Release -r win-x64 --self-contained true -o .\publish\KPTUWork
```

GitHub Actions의 `Build Windows app` 워크플로는 `KPTUWork-win-x64.zip`을 생성합니다.

## 실행 환경

- Windows 10/11 x64
- Microsoft Edge WebView2 Runtime

Windows 11과 최신 Edge가 설치된 대부분의 Windows 10 환경에는 WebView2 Runtime이 이미 설치되어 있습니다.
