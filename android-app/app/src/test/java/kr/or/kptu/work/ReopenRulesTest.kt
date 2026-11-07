package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** APP-다시열림: 다시 연 까닭 기록(종류·시각만, 앱 메모리)과 화면 안 이동 주소 고르기. */
class ReopenRulesTest {
    @Test
    fun createKindSeparatesStartRestoreRecreate() {
        assertEquals("start", ReopenRules.createKind(hasSavedState = false, freshProcess = true))
        assertEquals("start", ReopenRules.createKind(hasSavedState = false, freshProcess = false))
        assertEquals("restore", ReopenRules.createKind(hasSavedState = true, freshProcess = true))
        assertEquals("recreate", ReopenRules.createKind(hasSavedState = true, freshProcess = false))
    }

    @Test
    fun logKeepsKindAndTimeOnly() {
        val log = ReopenRules.Log(max = 3)
        log.expect("push", 1_000)
        assertEquals("push", log.started(2_000, loginPage = false))
        assertEquals("web", log.started(3_000, loginPage = false))
        assertEquals("login", log.started(4_000, loginPage = true))
        log.expect("pull", 5_000)
        assertEquals("web", log.started(5_000 + ReopenRules.MARK_WINDOW_MS + 1, loginPage = false))
        log.expect("nope", 6_000)
        assertEquals("web", log.started(6_001, loginPage = false))
        val entries = log.snapshot()
        assertEquals(3, entries.size)
        assertEquals(listOf("login", "web", "web"), entries.map { it.kind })
        assertEquals("reopen:list:login@4000,web@15001,web@6001", ReopenRules.listMessage(entries))
    }

    @Test
    fun webMarksOnlyKnownKinds() {
        assertEquals("pull", ReopenRules.webMark("reopen:mark:pull"))
        assertEquals("session", ReopenRules.webMark("reopen:mark:session"))
        assertNull(ReopenRules.webMark("reopen:mark:start"))
        assertNull(ReopenRules.webMark("reopen:mark:"))
        assertNull(ReopenRules.webMark("reopen:list"))
        assertNull(ReopenRules.webMark(null))
    }

    @Test
    fun inPlaceQueryOnlyForWeb2AppAddress() {
        assertEquals("", ShellRules.inPlaceQuery("https://bokdoong.com/work/app/"))
        assertEquals("?view=calendar", ShellRules.inPlaceQuery("https://bokdoong.com/work/app/?view=calendar"))
        assertEquals("?view=basket&pane=note", ShellRules.inPlaceQuery("https://bokdoong.com/work/app/index.html?view=basket&pane=note"))
        assertEquals("", ShellRules.inPlaceQuery(PushRules.openUrl("/work/app/")))
        assertNull(ShellRules.inPlaceQuery("https://bokdoong.com/work/app/login/"))
        assertNull(ShellRules.inPlaceQuery("https://bokdoong.com/work/app/?view=a#x"))
        assertNull(ShellRules.inPlaceQuery("https://bokdoong.com/work/app/?view=a'b"))
        assertNull(ShellRules.inPlaceQuery("https://bokdoong.com/work/app/?view=%27);alert(1)//"))
        assertNull(ShellRules.inPlaceQuery("https://bokdoong.com/work/app/other.html?view=a"))
        assertNull(ShellRules.inPlaceQuery("https://bokdoong.com/p/abc"))
        assertNull(ShellRules.inPlaceQuery("https://evil.example/work/app/"))
        assertNull(ShellRules.inPlaceQuery(null))
    }

    @Test
    fun activityOpensInPlaceBeforeReloadingAndRecordsWhy() {
        val src = File("src/main/java/kr/or/kptu/work/MainActivity.kt").readText()
        assertTrue(src.contains("openInPlace(PushRules.openUrl(intent.getStringExtra(PushRules.EXTRA_OPEN)), \"push\")"))
        assertTrue(src.contains("openInPlace(data!!, \"link\")"))
        assertTrue(src.contains("if (value != \"true\") load(url, kind)"))
        assertTrue(src.contains("if (ShellRules.isInternalApp(url)) ReopenBook.log.started(System.currentTimeMillis(), ShellRules.isLoginPage(url))"))
        assertTrue(src.contains("ReopenBook.engineGone = true\n                    recreate()"))
        assertTrue(src.contains("else if (data.startsWith(\"reopen:\")) onReopenMessage(data, reply)"))
        // 질의 글은 따옴표 없는 좁은 모양만 스크립트에 넣는다.
        assertTrue(src.contains("webView.evaluateJavascript(NAV_SCRIPT.replace(\"%Q%\", query))"))
        // 기록은 기기에 저장하지 않는다.
        val rules = File("src/main/java/kr/or/kptu/work/ReopenRules.kt").readText()
        assertTrue(!rules.contains("SharedPreferences") && !rules.contains("openFileOutput"))
    }

    @Test
    fun mainActivityKeepsWebAcrossFoldAndDarkModeChanges() {
        // S52-35: 폴드 접기·펴기·다크 모드 자동 전환으로 화면(Activity)을 다시 만들면 웹2를 처음부터 다시 연다. 이 설정들은 앱이 직접 받는다.
        val manifest = File("src/main/AndroidManifest.xml").readText()
        val block = manifest.substring(manifest.indexOf("android:name=\".MainActivity\""))
        val changes = Regex("android:configChanges=\"([^\"]*)\"").find(block)!!.groupValues[1].split("|").toSet()
        for (need in listOf("orientation", "screenSize", "screenLayout", "smallestScreenSize", "density", "uiMode", "colorMode", "keyboardHidden")) {
            assertTrue("configChanges에 $need 없음", need in changes)
        }
        // 받은 설정 바뀜에서 앱 바탕색을 다시 칠하고, 웹 화면은 다시 열지 않는다.
        val main = File("src/main/java/kr/or/kptu/work/MainActivity.kt").readText()
        val start = main.indexOf("override fun onConfigurationChanged")
        assertTrue(start > 0)
        val body = main.substring(start, main.indexOf("override fun onSaveInstanceState", start))
        assertTrue(body.contains("R.color.web_bg") && body.contains("syncBarColor()"))
        assertTrue(!body.contains("loadUrl") && !body.contains("reload") && !body.contains("recreate"))
    }
}
