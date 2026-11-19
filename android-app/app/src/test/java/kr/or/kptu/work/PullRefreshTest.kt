package kr.or.kptu.work

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** APP-당겨서새로고침: 앱 쪽 판정과 웹에 맡기는 길. */
class PullRefreshTest {
    @Test
    fun pullOnlyWhenWebSaidOnAtTopOfWeb2() {
        assertTrue(ShellRules.pullReady(true, 0, true))
        assertFalse("웹이 켜지 않음(포스트잇 판·창·칸 안 목록·글 쓰는 중)", ShellRules.pullReady(false, 0, true))
        assertFalse("웹 화면이 내려가 있음", ShellRules.pullReady(true, 12, true))
        assertFalse("웹2 화면이 아님", ShellRules.pullReady(true, 0, false))
    }

    @Test
    fun activityResetsEachTouchAndAsksWebBeforeReload() {
        val src = File("src/main/java/kr/or/kptu/work/MainActivity.kt").readText()
        // 손가락을 댈 때마다 끈다(앞 손가락의 pull:on이 남지 않게).
        assertTrue(src.contains("if (event.actionMasked == MotionEvent.ACTION_DOWN) pullOn = false"))
        // 다리 글은 pull:on·pull:off 둘만.
        assertTrue(src.contains("else if (data == \"pull:on\" || data == \"pull:off\") pullOn = data == \"pull:on\""))
        // 새로고침은 웹(저장 안 한 글 확인 → 같은 주소)에 맡기고, 'cancel'이면 다시 열지 않는다.
        assertTrue(src.contains("window.KPTUPullRefresh"))
        assertTrue(src.contains("if (value != \"\\\"reload\\\"\" && value != \"\\\"cancel\\\"\") {"))
        // APP-다시열림: 옛 화면을 앱이 다시 열 때도 까닭(pull)을 남기고, 당겨야 하는 거리를 늘려 저절로 걸리지 않게 한다.
        assertTrue(src.contains("ReopenBook.log.expect(\"pull\", System.currentTimeMillis())\n                    webView.reload()"))
        assertTrue(src.contains("refresher.setDistanceToTriggerSync((PULL_TRIGGER_DP * resources.displayMetrics.density).toInt())"))
    }

    @Test
    fun onlyMovesAreBlockedSoEachFingerStartsFresh() {
        // NOTE-폴더고른뒤새로고침: 대는 순간·떼는 순간은 웹이 끈 손가락이어도 막지 않는다(시작점·끝을 늘 새로 적음).
        assertFalse("대는 순간(앞 손가락 pull:off)", ShellRules.pullBlocked(false, false, 0, true))
        assertFalse("떼는 순간(이 손가락 pull:off)", ShellRules.pullBlocked(false, false, 0, true))
        assertFalse("웹2가 아닌 화면도 대고 떼는 순간은 받음", ShellRules.pullBlocked(false, true, 0, false))
        // 움직이는 순간은 그대로 웹 판정(pullReady)을 따른다.
        assertTrue("웹이 끈 손가락은 움직여도 당기기 없음", ShellRules.pullBlocked(true, false, 0, true))
        assertTrue("웹 화면이 내려가 있음", ShellRules.pullBlocked(true, true, 12, true))
        assertTrue("웹2 화면이 아님", ShellRules.pullBlocked(true, true, 0, false))
        assertFalse("맨 위에서 웹이 켠 손가락은 당기기", ShellRules.pullBlocked(true, true, 0, true))
    }

    @Test
    fun activityUsesMoveOnlyBlock() {
        val src = File("src/main/java/kr/or/kptu/work/MainActivity.kt").readText()
        assertTrue(src.contains("refresher = PullRefreshLayout(this)"))
        assertTrue(src.contains("ShellRules.pullBlocked(refresher.moving, pullOn, webView.scrollY, ShellRules.isInternalApp(webView.url))"))
        assertFalse("옛 방식(대는 순간까지 막음)이 남지 않음", src.contains("{ _, _ -> !ShellRules.pullReady("))
        val layout = File("src/main/java/kr/or/kptu/work/PullRefreshLayout.kt").readText()
        assertTrue(layout.contains("moving = ev.actionMasked == MotionEvent.ACTION_MOVE"))
    }
}
