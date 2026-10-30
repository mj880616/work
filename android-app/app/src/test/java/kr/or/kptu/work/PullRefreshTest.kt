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
        assertTrue(src.contains("if (value != \"\\\"reload\\\"\" && value != \"\\\"cancel\\\"\") webView.reload()"))
    }
}
