package kr.or.kptu.work

import kr.or.kptu.work.WidgetLoginFlow.Event
import kr.or.kptu.work.WidgetLoginFlow.Step
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 위젯 로그인 자동 길(웹 화면 widget:mint)과 대체 길(구글 탭)의 단계(설계 docs/design/phone-widget-auth.md 12절). */
class WidgetLoginFlowTest {
    @Test
    fun signedInWebMintsWithoutGoogle() {
        var s = WidgetLoginFlow.next(Step.WAITING, Event.WEB_READY)
        assertEquals(Step.MINTING, s)
        s = WidgetLoginFlow.next(s, Event.HANDOFF)
        assertEquals(Step.IDLE, s)
    }

    @Test
    fun signedOutFailureOrTimeoutFallsBackToGoogle() {
        for (e in listOf(Event.WEB_SIGNED_OUT, Event.MINT_FAILED, Event.TIMEOUT)) {
            assertEquals(Step.FALLBACK, WidgetLoginFlow.next(Step.WAITING, e))
            assertEquals(Step.FALLBACK, WidgetLoginFlow.next(Step.MINTING, e))
        }
    }

    @Test
    fun handoffBeforeMintIsIgnoredAndIdleIgnoresEverything() {
        // 앱이 mint를 보내기 전에 온 봉인은 받지 않는다(MainActivity도 MINTING일 때만 consume).
        assertEquals(Step.WAITING, WidgetLoginFlow.next(Step.WAITING, Event.HANDOFF))
        for (e in Event.values()) assertEquals(Step.IDLE, WidgetLoginFlow.next(Step.IDLE, e))
        assertEquals(Step.MINTING, WidgetLoginFlow.next(Step.MINTING, Event.WEB_READY))
    }

    @Test
    fun loginPageIsOnlyWeb2Login() {
        assertTrue(ShellRules.isLoginPage("https://bokdoong.com/work/app/login/"))
        assertTrue(ShellRules.isLoginPage("https://bokdoong.com/work/app/login/?return=https%3A%2F%2Fbokdoong.com%2Fwork%2Fapp%2F"))
        assertTrue(ShellRules.isLoginPage("https://desk.bokdoong.com/work/app/login/"))
        assertFalse(ShellRules.isLoginPage("https://bokdoong.com/work/app/"))
        assertFalse(ShellRules.isLoginPage("https://bokdoong.com/work/app/loginx/"))
        assertFalse(ShellRules.isLoginPage("https://evil.example/work/app/login/"))
        assertFalse(ShellRules.isLoginPage("http://bokdoong.com/work/app/login/"))
        assertFalse(ShellRules.isLoginPage(null))
    }

    @Test
    fun loginMarkerSurvivesScreenRecreateOnlyWithinTenMinutes() {
        var clock = 1_000_000_000_000L
        val vault = object : WidgetVault {
            override fun exists() = false
            override fun read(): String? = null
            override fun write(value: String) = Unit
            override fun clear() = Unit
        }
        val http = object : WidgetHttp {
            override fun send(request: WidgetRequest): WidgetResponse = throw AssertionError("no request")
        }
        val first = WidgetSession(http, vault) { clock }
        assertEquals(0L, first.loginStartedAt())
        first.beginLogin()
        val since = first.loginStartedAt()
        assertEquals(clock, since)

        // 프로세스가 새로 떠서(메모리 부족) 화면 상태의 시각만 남은 경우
        clock += 60_000L
        val second = WidgetSession(http, vault) { clock }
        second.resumeLogin(since)
        assertTrue(second.loginPending())
        assertTrue(second.takeLogin())
        assertFalse(second.loginPending())

        // 10분이 지난 시각·미래 시각은 잇지 않는다
        val third = WidgetSession(http, vault) { clock }
        third.resumeLogin(clock - WidgetSession.LOGIN_WINDOW_MS - 1)
        assertFalse(third.loginPending())
        third.resumeLogin(clock + 60_000L)
        assertFalse(third.loginPending())
        assertEquals(0L, third.loginStartedAt())
    }
}
