package kr.or.kptu.work

import java.net.URI

/**
 * 앱 스스로 업데이트(APP-스스로업데이트, 명진 결정 A안)의 판단 규칙. 안드로이드 API를 쓰지 않아 JVM 단위 시험으로 확인한다.
 * - 받을 주소: 이 저장소 공개 릴리스 phone-app-v<버전>의 .apk(ShellRules.isTrustedApk)와, 그 주소가 넘기는(302) GitHub 파일 저장 호스트만.
 * - 받은 파일: 크기·sha256(릴리스 정보에 있으면)·앱 ID·버전 이름·버전 번호가 릴리스와 맞고, 서명이 지금 앱 서명과 같아야 설치한다.
 * - 녹음 중·조각 올리는 중에는 설치하지 않는다(설치하면 앱이 닫힌다). 끝난 뒤로 미룬다.
 * - 하나라도 어긋나면 앱 안 설치를 멈추고 예전처럼 [받기](브라우저)로 돌아간다.
 * 토큰·로그인은 쓰지 않는다.
 */
object UpdateRules {
    const val RELEASES_URL = "https://api.github.com/repos/mj880616/work/releases?per_page=50"
    const val PACKAGE = "kr.or.kptu.work"
    /** 받을 APK 크기 상한(지금 판은 8MB 안팎). */
    const val MAX_APK_BYTES = 64L * 1024 * 1024
    const val MAX_REDIRECTS = 5
    /** 앱이 뒤로 간 뒤 이만큼(분) 다시 열지 않으면 그때 설치한다. */
    const val BACKGROUND_DELAY_MIN = 10L

    /** github.com 릴리스 받기 주소가 넘기는 곳(GitHub 릴리스 파일 저장소). 그 밖의 곳으로 넘기면 받지 않는다. */
    val REDIRECT_HOSTS: Set<String> = setOf("objects.githubusercontent.com", "release-assets.githubusercontent.com")

    private val SHA256 = Regex("^[0-9a-f]{64}$")

    data class Release(val version: String, val url: String, val size: Long, val sha256: String?)

    // ── 릴리스 고르기 ──

    /** 공개 릴리스 목록(JSON 글)에서 지금보다 새 판 중 가장 새 것. 초안·미리보기·주소·크기가 이상한 자산은 뺀다. */
    fun pick(json: String?, current: String): Release? {
        val list = MiniJson.list(MiniJson.parse(json)) ?: return null
        var best: Release? = null
        for (item in list) {
            val release = MiniJson.obj(item) ?: continue
            if (release["draft"] == true || release["prerelease"] == true) continue
            val version = ShellRules.versionFromTag(MiniJson.str(release["tag_name"])) ?: continue
            if (!ShellRules.isNewer(version, current)) continue
            if (best != null && !ShellRules.isNewer(version, best.version)) continue
            val assets = MiniJson.list(release["assets"]) ?: continue
            for (a in assets) {
                val asset = MiniJson.obj(a) ?: continue
                val url = MiniJson.str(asset["browser_download_url"])
                if (!ShellRules.isTrustedApk(url, version)) continue
                val size = MiniJson.num(asset["size"])?.toLong() ?: continue
                if (!sizeAllowed(size)) continue
                best = Release(version, url!!, size, sha256Of(MiniJson.str(asset["digest"])))
                break
            }
        }
        return best
    }

    fun sizeAllowed(size: Long): Boolean = size in 1..MAX_APK_BYTES

    /** 릴리스 자산의 digest("sha256:<64자>")에서 hex만. 다른 모양이면 null(그때는 크기·서명·버전으로만 확인). */
    fun sha256Of(digest: String?): String? {
        if (digest == null || !digest.startsWith("sha256:")) return null
        val hex = digest.substring(7).lowercase()
        return if (SHA256.matches(hex)) hex else null
    }

    // ── 받기 주소·넘김 ──

    /** 넘김(302) 뒤 주소: https, 허용 호스트, 기본 포트, 사용자 정보 없음. */
    fun isAllowedRedirect(url: String?): Boolean {
        val u = parse(url) ?: return false
        return u.scheme == "https" && u.rawUserInfo == null && (u.port == -1 || u.port == 443) && u.host?.lowercase() in REDIRECT_HOSTS
    }

    /**
     * 받기 첫 주소 또는 넘김 다음 주소를 허용할지. 첫 주소는 릴리스 자산 주소 그대로여야 하고,
     * 넘김 Location(상대 주소면 지금 주소 기준으로 풀기)은 같은 릴리스 주소이거나 허용 호스트여야 한다. 허용하면 다음에 부를 절대 주소.
     */
    fun nextHop(current: String, location: String?, release: Release): String? {
        if (location.isNullOrBlank()) return null
        val resolved = try {
            URI(current).resolve(location.trim()).toString()
        } catch (_: Exception) {
            return null
        }
        return when {
            resolved == release.url -> resolved
            isAllowedRedirect(resolved) -> resolved
            else -> null
        }
    }

    fun firstHopOk(release: Release): Boolean = ShellRules.isTrustedApk(release.url, release.version) && sizeAllowed(release.size)

    /** 응답 머리글의 길이가 있으면 릴리스 크기와 같아야 한다(-1 = 모름). */
    fun lengthOk(release: Release, contentLength: Long): Boolean = contentLength < 0 || contentLength == release.size

    /** 받는 동안 릴리스 크기를 넘으면 바로 멈춘다. */
    fun overflow(release: Release, received: Long): Boolean = received > release.size

    /** 다 받은 파일: 크기가 같고, 릴리스에 sha256이 있으면 그것도 같아야 한다. */
    fun fileOk(release: Release, size: Long, sha256Hex: String?): Boolean {
        if (size != release.size) return false
        val want = release.sha256 ?: return true
        return sha256Hex != null && sha256Hex.lowercase() == want
    }

    // ── 받은 APK 확인 ──

    data class Archive(val packageName: String?, val versionName: String?, val versionCode: Long)

    /**
     * 받은 APK가 이 앱의 새 판인지: 앱 ID 같음, 버전 이름이 지금보다 새 판(릴리스 버전을 알면 그것과 같음), 버전 번호가 지금보다 큼.
     * expectedVersion = null은 앱을 다시 연 뒤 이미 확인해 둔 파일을 다시 볼 때(릴리스 정보 없이 파일만 본다).
     */
    fun archiveOk(archive: Archive?, expectedVersion: String?, currentName: String, currentCode: Long): Boolean {
        if (archive == null || archive.packageName != PACKAGE) return false
        val name = archive.versionName ?: return false
        if (expectedVersion != null && name != expectedVersion) return false
        return ShellRules.isNewer(name, currentName) && archive.versionCode > currentCode
    }

    /** 앱 전용 공간에 남은 확인된 파일 이름에서 버전(web2-phone-<버전>.apk). 다른 이름이면 null. */
    fun versionFromFileName(name: String?): String? {
        if (name == null || !name.startsWith("web2-phone-") || !name.endsWith(".apk")) return null
        val v = name.substring("web2-phone-".length, name.length - ".apk".length)
        return if (ShellRules.parseVersion(v) != null) v else null
    }

    /**
     * 서명 비교: 지금 앱과 받은 APK의 서명 인증서 SHA-256 목록이 둘 다 비어 있지 않고 같은 묶음이어야 한다.
     * (키 바꾸기는 쓰지 않는다. 서명을 읽지 못하면 다른 것으로 본다.)
     */
    fun sameSigner(current: Collection<String>?, candidate: Collection<String>?): Boolean {
        if (current.isNullOrEmpty() || candidate.isNullOrEmpty()) return false
        val a = current.map { it.lowercase() }.toSet()
        val b = candidate.map { it.lowercase() }.toSet()
        return a.all { SHA256.matches(it) } && a == b
    }

    // ── 언제 설치하나 ──

    /** 녹음 중·일시정지·[멈추고 정리] 뒤 조각 올리는 중이면 설치를 미룬다. 앱이 죽어 남은 녹음(INTERRUPTED)은 앱 전용 공간에 남아 업데이트 뒤에도 이어서 정리된다. */
    fun recordingBusy(session: RecordRules.Session?): Boolean = when (session?.state) {
        RecordRules.State.RECORDING, RecordRules.State.PAUSED, RecordRules.State.STOPPED -> true
        RecordRules.State.INTERRUPTED, null -> false
    }

    enum class Go {
        /** 녹음·조각 올리기가 끝나면 다시 본다. */
        WAIT_RECORDING,
        /** '이 앱에서 설치 허용'이 꺼져 있다: 안내 줄 [허용하기]. */
        NEED_PERMISSION,
        /**
         * 화면을 쓰는 중(또는 뒤로 간 지 BACKGROUND_DELAY_MIN분 안): [지금 업데이트]를 누르거나, 앱이 뒤에 그만큼 머문 뒤 설치.
         * 로그인 탭·파일 고르기·카메라처럼 잠깐 뒤로 가는 사이에 앱이 닫히지 않게 한다.
         */
        WAIT_BACKGROUND,
        INSTALL,
    }

    fun decide(busy: Boolean, canInstall: Boolean, inForeground: Boolean, userAsked: Boolean): Go = when {
        busy -> Go.WAIT_RECORDING
        !canInstall -> Go.NEED_PERMISSION
        inForeground && !userAsked -> Go.WAIT_BACKGROUND
        else -> Go.INSTALL
    }

    /** 안드로이드 12(API 31)+에서만 '확인 없이 업데이트'를 청한다. 시스템이 받지 않으면 확인 한 번(알림 [업데이트]). */
    fun askNoUserAction(sdk: Int): Boolean = sdk >= 31

    // ── 상태 줄 ──

    enum class Phase { IDLE, FOUND, DOWNLOADING, READY, NEED_PERMISSION, WAIT_RECORDING, INSTALLING, CONFIRM, FAILED }

    /** 앱 위쪽 안내 줄 글과 단추 이름(없으면 null). FAILED는 예전처럼 브라우저 [받기]. */
    fun barText(phase: Phase, version: String): Pair<String, String?>? = when (phase) {
        Phase.IDLE -> null
        Phase.FOUND, Phase.DOWNLOADING -> "앱 새 버전 $version 받는 중" to null
        Phase.READY -> "앱 새 버전 $version 준비됨 · 앱을 닫아 두면 업데이트" to "지금 업데이트"
        Phase.NEED_PERMISSION -> "앱 새 버전 $version · 처음 한 번 설치 허용 필요" to "허용하기"
        Phase.WAIT_RECORDING -> "앱 새 버전 $version · 녹음이 끝나면 업데이트" to null
        Phase.INSTALLING -> "앱 새 버전 $version 설치 중" to null
        Phase.CONFIRM -> "앱 새 버전 $version · 한 번 눌러 설치" to "업데이트"
        Phase.FAILED -> "앱 새 버전 $version" to "받기"
    }

    /** 알림줄 한 줄(받는 중·설치 중만). */
    fun noteText(phase: Phase, version: String): String? = when (phase) {
        Phase.FOUND, Phase.DOWNLOADING -> "웹2 $version 받는 중"
        Phase.INSTALLING -> "웹2 $version 설치 중"
        Phase.CONFIRM -> "웹2 $version 업데이트 준비됨 · 눌러서 설치"
        else -> null
    }

    /** 받은 파일 이름(앱 전용 공간 noBackupFilesDir/update/ 안). */
    fun apkFileName(version: String): String = "web2-phone-$version.apk"

    private fun parse(url: String?): URI? = try {
        if (url == null) null else URI(url)
    } catch (_: Exception) {
        null
    }
}
