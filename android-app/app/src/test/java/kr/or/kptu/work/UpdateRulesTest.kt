package kr.or.kptu.work

import kr.or.kptu.work.RecordRules.Segment
import kr.or.kptu.work.RecordRules.Session
import kr.or.kptu.work.RecordRules.State
import kr.or.kptu.work.UpdateRules.Archive
import kr.or.kptu.work.UpdateRules.Go
import kr.or.kptu.work.UpdateRules.Phase
import kr.or.kptu.work.UpdateRules.Release
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

class UpdateRulesTest {
    private val base = "https://github.com/mj880616/work/releases/download/phone-app-v"
    private val sha = "8a6918ad868b95bbec9ed9e1fef8bd1305584e8cfa0125ebf586f89de89cec2a"
    private val rel = Release("0.3.9", base + "0.3.9/web2-phone-0.3.9.apk", 7_930_188, sha)

    private fun releaseJson(tag: String, url: String, size: Long = 7_930_188, draft: Boolean = false, pre: Boolean = false, digest: String = "sha256:$sha") =
        """{"tag_name":"$tag","draft":$draft,"prerelease":$pre,"assets":[{"name":"x.apk","size":$size,"digest":"$digest","browser_download_url":"$url"}]}"""

    // ── 허용 주소 ──

    @Test fun 릴리스_고르기_우리_저장소_phone_app_자산만() {
        val json = "[" + listOf(
            releaseJson("phone-app-v0.3.9", base + "0.3.9/web2-phone-0.3.9.apk"),
            releaseJson("phone-app-v0.4.0", "https://github.com/other/work/releases/download/phone-app-v0.4.0/web2-phone-0.4.0.apk"),
            releaseJson("phone-app-v0.5.0", base + "0.5.0/web2-phone-0.5.0.apk", draft = true),
            releaseJson("phone-app-v0.6.0", base + "0.6.0/web2-phone-0.6.0.apk", pre = true),
            releaseJson("basket-pc-v9.0.0", base + "9.0.0/web2-phone-9.0.0.apk"),
            releaseJson("phone-app-v0.3.7", base + "0.3.7/web2-phone-0.3.7.apk"),
        ).joinToString(",") + "]"
        val r = UpdateRules.pick(json, "0.3.8")
        assertEquals(rel, r)
        assertNull(UpdateRules.pick(json, "0.3.9"))
        assertNull(UpdateRules.pick("not json", "0.3.8"))
        // 크기가 없거나 0·너무 크면 고르지 않는다. digest가 이상하면 sha256 없이(크기·서명·버전으로) 본다.
        assertNull(UpdateRules.pick("[" + releaseJson("phone-app-v0.3.9", rel.url, size = 0) + "]", "0.3.8"))
        assertNull(UpdateRules.pick("[" + releaseJson("phone-app-v0.3.9", rel.url, size = UpdateRules.MAX_APK_BYTES + 1) + "]", "0.3.8"))
        assertNull(UpdateRules.pick("[" + releaseJson("phone-app-v0.3.9", rel.url, digest = "md5:abc") + "]", "0.3.8")!!.sha256)
    }

    @Test fun 넘김_대상_허용_목록() {
        assertTrue(UpdateRules.isAllowedRedirect("https://objects.githubusercontent.com/github-production-release-asset-1/abc?sig=x"))
        assertTrue(UpdateRules.isAllowedRedirect("https://release-assets.githubusercontent.com/a/b"))
        assertFalse(UpdateRules.isAllowedRedirect("http://objects.githubusercontent.com/a"))
        assertFalse(UpdateRules.isAllowedRedirect("https://objects.githubusercontent.com.evil.example/a"))
        assertFalse(UpdateRules.isAllowedRedirect("https://evil.example/objects.githubusercontent.com"))
        assertFalse(UpdateRules.isAllowedRedirect("https://x@objects.githubusercontent.com/a"))
        assertFalse(UpdateRules.isAllowedRedirect("https://objects.githubusercontent.com:8443/a"))
        assertFalse(UpdateRules.isAllowedRedirect("https://raw.githubusercontent.com/a"))
        assertFalse(UpdateRules.isAllowedRedirect(null))
    }

    @Test fun 넘김_다음_주소() {
        val cdn = "https://objects.githubusercontent.com/github-production-release-asset/1?x=1"
        assertEquals(cdn, UpdateRules.nextHop(rel.url, cdn, rel))
        assertEquals(rel.url, UpdateRules.nextHop(rel.url, rel.url, rel))
        assertNull(UpdateRules.nextHop(rel.url, "https://evil.example/a.apk", rel))
        assertNull(UpdateRules.nextHop(rel.url, "/mj880616/work/releases/download/phone-app-v0.3.9/other.apk", rel))
        assertNull(UpdateRules.nextHop(rel.url, "/other/x.apk", rel))
        assertNull(UpdateRules.nextHop(rel.url, null, rel))
        assertNull(UpdateRules.nextHop(cdn, "javascript:alert(1)", rel))
        assertTrue(UpdateRules.firstHopOk(rel))
        assertFalse(UpdateRules.firstHopOk(rel.copy(url = "https://evil.example/web2-phone-0.3.9.apk")))
        assertFalse(UpdateRules.firstHopOk(rel.copy(version = "0.4.0")))
    }

    // ── 크기·버전·서명 ──

    @Test fun 크기와_sha256() {
        assertTrue(UpdateRules.lengthOk(rel, -1))
        assertTrue(UpdateRules.lengthOk(rel, rel.size))
        assertFalse(UpdateRules.lengthOk(rel, rel.size + 1))
        assertFalse(UpdateRules.overflow(rel, rel.size))
        assertTrue(UpdateRules.overflow(rel, rel.size + 1))
        assertTrue(UpdateRules.fileOk(rel, rel.size, sha))
        assertTrue(UpdateRules.fileOk(rel, rel.size, sha.uppercase()))
        assertFalse(UpdateRules.fileOk(rel, rel.size - 1, sha))
        assertFalse(UpdateRules.fileOk(rel, rel.size, "0".repeat(64)))
        assertFalse(UpdateRules.fileOk(rel, rel.size, null))
        assertTrue(UpdateRules.fileOk(rel.copy(sha256 = null), rel.size, null))
        assertEquals(sha, UpdateRules.sha256Of("sha256:${sha.uppercase()}"))
        assertNull(UpdateRules.sha256Of("sha1:abc"))
    }

    @Test fun 받은_APK_앱ID_버전_확인() {
        val ok = Archive("kr.or.kptu.work", "0.3.9", 39)
        assertTrue(UpdateRules.archiveOk(ok, "0.3.9", "0.3.8", 38))
        assertTrue(UpdateRules.archiveOk(ok, null, "0.3.8", 38))
        assertFalse(UpdateRules.archiveOk(ok.copy(packageName = "kr.or.kptu.evil"), "0.3.9", "0.3.8", 38))
        assertFalse(UpdateRules.archiveOk(ok.copy(versionName = "0.4.0"), "0.3.9", "0.3.8", 38))
        assertFalse(UpdateRules.archiveOk(ok.copy(versionCode = 38), "0.3.9", "0.3.8", 38))
        assertFalse(UpdateRules.archiveOk(ok.copy(versionName = "0.3.8"), null, "0.3.8", 38))
        assertFalse(UpdateRules.archiveOk(null, "0.3.9", "0.3.8", 38))
        assertEquals("0.3.9", UpdateRules.versionFromFileName("web2-phone-0.3.9.apk"))
        assertNull(UpdateRules.versionFromFileName("web2-phone-0.3.9.apk.part"))
        assertNull(UpdateRules.versionFromFileName("other.apk"))
    }

    @Test fun 서명_비교() {
        val mine = listOf(sha)
        assertTrue(UpdateRules.sameSigner(mine, listOf(sha.uppercase())))
        assertFalse(UpdateRules.sameSigner(mine, listOf("1".repeat(64))))
        assertFalse(UpdateRules.sameSigner(mine, listOf(sha, "1".repeat(64))))
        assertFalse(UpdateRules.sameSigner(mine, emptyList()))
        assertFalse(UpdateRules.sameSigner(mine, null))
        assertFalse(UpdateRules.sameSigner(null, mine))
        assertFalse(UpdateRules.sameSigner(listOf("not-a-digest"), listOf("not-a-digest")))
    }

    // ── 언제 설치하나 ──

    private fun session(state: State) = Session(
        "11111111-2222-4333-8444-555555555555", "99999999-8888-4777-8666-555555555555", "2026-10-30T05:00:00.000Z", state, 900,
        listOf(Segment(no = 1, id = null, file = RecordRules.segmentFile("11111111-2222-4333-8444-555555555555", 1))),
    )

    @Test fun 녹음_중_조각_올리는_중에는_미룸() {
        assertTrue(UpdateRules.recordingBusy(session(State.RECORDING)))
        assertTrue(UpdateRules.recordingBusy(session(State.PAUSED)))
        assertTrue(UpdateRules.recordingBusy(session(State.STOPPED)))
        assertFalse(UpdateRules.recordingBusy(session(State.INTERRUPTED)))
        assertFalse(UpdateRules.recordingBusy(null))
        assertEquals(Go.WAIT_RECORDING, UpdateRules.decide(busy = true, canInstall = true, inForeground = false, userAsked = true))
    }

    @Test fun 설치_허용_화면_앞뒤() {
        assertEquals(Go.NEED_PERMISSION, UpdateRules.decide(busy = false, canInstall = false, inForeground = false, userAsked = true))
        assertEquals(Go.WAIT_BACKGROUND, UpdateRules.decide(busy = false, canInstall = true, inForeground = true, userAsked = false))
        assertEquals(Go.INSTALL, UpdateRules.decide(busy = false, canInstall = true, inForeground = true, userAsked = true))
        assertEquals(Go.INSTALL, UpdateRules.decide(busy = false, canInstall = true, inForeground = false, userAsked = false))
        assertFalse(UpdateRules.askNoUserAction(30))
        assertTrue(UpdateRules.askNoUserAction(31))
    }

    @Test fun 실패하면_브라우저_받기() {
        assertEquals("앱 새 버전 0.3.9" to "받기", UpdateRules.barText(Phase.FAILED, "0.3.9"))
        assertNull(UpdateRules.barText(Phase.IDLE, "0.3.9"))
        assertEquals("허용하기", UpdateRules.barText(Phase.NEED_PERMISSION, "0.3.9")!!.second)
        assertEquals("업데이트", UpdateRules.barText(Phase.CONFIRM, "0.3.9")!!.second)
        assertNull(UpdateRules.barText(Phase.WAIT_RECORDING, "0.3.9")!!.second)
        assertEquals("웹2 0.3.9 받는 중", UpdateRules.noteText(Phase.DOWNLOADING, "0.3.9"))
        assertEquals("웹2 0.3.9 설치 중", UpdateRules.noteText(Phase.INSTALLING, "0.3.9"))
        assertNull(UpdateRules.noteText(Phase.FAILED, "0.3.9"))
        // 화면: [받기]·그 밖의 상태는 브라우저로 APK 주소를 연다(예전 길).
        val main = File("src/main/java/kr/or/kptu/work/MainActivity.kt").readText()
        assertTrue(main.contains("else -> updateUrl?.let { openView(Uri.parse(it)) }"))
    }

    // ── 토큰 없음·매니페스트 ──

    @Test fun 업데이트는_토큰_로그인을_쓰지_않음() {
        val src = File("src/main/java/kr/or/kptu/work/AppUpdater.kt").readText() + File("src/main/java/kr/or/kptu/work/UpdateCheck.kt").readText()
        for (word in listOf("Authorization", "access_token", "refresh_token", "WidgetHub", "Log.")) assertFalse(word, src.contains(word))
        // 자동 넘김을 끄고 한 번씩 허용 목록으로 본다.
        assertTrue(src.contains(".followRedirects(false)"))
        assertTrue(src.contains("UpdateRules.nextHop("))
    }

    @Test fun 매니페스트_업데이트_받는_곳은_내보내지_않음() {
        val f = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        val root = f.newDocumentBuilder().parse(File("src/main/AndroidManifest.xml")).documentElement
        val ns = "http://schemas.android.com/apk/res/android"
        val list = root.getElementsByTagName("receiver")
        val r = (0 until list.length).map { list.item(it) as Element }.firstOrNull { it.getAttributeNS(ns, "name") == ".UpdateReceiver" }
        assertNotNull(r)
        assertEquals("false", r!!.getAttributeNS(ns, "exported"))
        val actions = r.getElementsByTagName("action")
        assertEquals(listOf("android.intent.action.MY_PACKAGE_REPLACED"), (0 until actions.length).map { (actions.item(it) as Element).getAttributeNS(ns, "name") })
    }
}
