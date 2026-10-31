package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException

class WidgetAuthTest {
    private val user = "11111111-2222-4333-8444-555555555555"

    private class MemoryVault : WidgetVault {
        var value: String? = null
        var failWrite = false
        val writes = ArrayList<String>()
        override fun exists() = value != null
        override fun read() = value
        override fun write(value: String) {
            if (failWrite) throw IllegalStateException("disk")
            writes.add(value)
            this.value = value
        }
        override fun clear() { value = null }
    }

    /** 가짜 HTTP: 보낸 요청을 기록하고, 주소별로 정한 답을 돌려준다. */
    private class FakeHttp(val vault: MemoryVault) : WidgetHttp {
        val sent = ArrayList<WidgetRequest>()
        val answers = ArrayDeque<(WidgetRequest) -> WidgetResponse>()
        /** 응답을 만들 때 금고 상태를 기록(새 토큰을 먼저 저장했는지 확인용). */
        val vaultAtSend = ArrayList<String?>()
        override fun send(request: WidgetRequest): WidgetResponse {
            sent.add(request)
            vaultAtSend.add(vault.value)
            val a = answers.removeFirstOrNull() ?: throw AssertionError("unexpected " + request.method + " " + request.url)
            return a(request)
        }
    }

    private var clock = 1_000_000_000_000L
    private val vault = MemoryVault()
    private val http = FakeHttp(vault)
    private val session = WidgetSession(http, vault) { clock }

    private fun sessionJson(access: String, refresh: String, id: String = user) =
        """{"access_token":"$access","refresh_token":"$refresh","expires_in":3600,"user":{"id":"$id"}}"""

    private fun ok(body: String) = { _: WidgetRequest -> WidgetResponse(200, body) }
    private fun status(code: Int) = { _: WidgetRequest -> WidgetResponse(code, "{\"error\":\"x\"}") }
    private val handoff = "abcDEF0123456789_-abcDEF0123456789"

    private fun signIn() {
        http.answers.add(ok("""{"session":${sessionJson("a1", "r1")}}"""))
        assertTrue(session.consume(handoff) is WidgetSession.Outcome.Ok)
    }

    @Test
    fun loginMarkerIsMemoryOnlyOnceAndTenMinutes() {
        assertFalse(session.loginPending())
        assertFalse(session.takeLogin())
        session.beginLogin()
        assertTrue(session.loginPending())
        assertTrue(session.takeLogin())
        assertFalse(session.takeLogin())
        session.beginLogin()
        clock += WidgetSession.LOGIN_WINDOW_MS + 1
        assertFalse(session.takeLogin())
    }

    @Test
    fun consumeSendsOriginAndStoresOnlyRefreshToken() {
        signIn()
        val req = http.sent.single()
        assertEquals("POST", req.method)
        assertEquals("https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/auth-handoff", req.url)
        assertEquals("https://bokdoong.com", req.headers["Origin"])
        assertEquals("{\"action\":\"consume\",\"token\":\"$handoff\"}", req.body)
        assertEquals("v1\n$user\nr1", vault.value)
        assertFalse(vault.value!!.contains("a1"))
        // 접근 토큰은 메모리: 다시 요청하지 않는다.
        assertEquals(WidgetSession.Outcome.Ok("a1"), session.accessToken())
        assertEquals(1, http.sent.size)
    }

    @Test
    fun consumeFailuresDoNotStore() {
        assertTrue(session.consume("short") is WidgetSession.Outcome.Failed)
        assertTrue(session.consume("bad value with spaces and more text") is WidgetSession.Outcome.Failed)
        assertTrue(http.sent.isEmpty())
        http.answers.add(status(401))
        assertTrue(session.consume(handoff) is WidgetSession.Outcome.Failed)
        http.answers.add(ok("""{"session":${sessionJson("a1", "r1", "not-a-uuid")}}"""))
        assertTrue(session.consume(handoff) is WidgetSession.Outcome.Failed)
        http.answers.add { throw IOException("down") }
        assertTrue(session.consume(handoff) is WidgetSession.Outcome.Failed)
        assertNull(vault.value)
        vault.failWrite = true
        http.answers.add(ok("""{"session":${sessionJson("a1", "r1")}}"""))
        assertTrue(session.consume(handoff) is WidgetSession.Outcome.Failed)
        assertNull(vault.value)
        assertEquals(WidgetSession.Outcome.SignedOut, session.accessToken())
    }

    @Test
    fun refreshSavesNewTokenBeforeUsingIt() {
        signIn()
        clock += 3600_000L
        http.answers.add(ok(sessionJson("a2", "r2")))
        assertEquals(WidgetSession.Outcome.Ok("a2"), session.accessToken())
        val req = http.sent.last()
        assertEquals("https://xmlkxfjeagycwttklxjw.supabase.co/auth/v1/token?grant_type=refresh_token", req.url)
        assertEquals(WidgetRules.PUBLIC_KEY, req.headers["apikey"])
        assertNull(req.headers["Origin"])
        assertEquals("{\"refresh_token\":\"r1\"}", req.body)
        assertEquals("v1\n$user\nr2", vault.value)
        // 다음 요청(읽기) 때 금고에는 이미 새 토큰이 있다.
        http.answers.add(ok("{\"events\":[]}"))
        http.answers.add(ok("{\"tasks\":[]}"))
        val (a, b) = WidgetNow.range(clock)
        assertTrue(session.readToday(a, b) is WidgetSession.Outcome.Ok)
        assertEquals("v1\n$user\nr2", http.vaultAtSend.last())
    }

    @Test
    fun refreshFailureKinds() {
        signIn()
        clock += 3600_000L
        // 네트워크·서버 일시 오류: 토큰을 지우지 않는다.
        http.answers.add { throw IOException("down") }
        assertTrue(session.accessToken() is WidgetSession.Outcome.Failed)
        http.answers.add(status(503))
        assertTrue(session.accessToken() is WidgetSession.Outcome.Failed)
        http.answers.add(status(429))
        assertTrue(session.accessToken() is WidgetSession.Outcome.Failed)
        assertEquals("v1\n$user\nr1", vault.value)
        // 다른 사용자 세션이 오면 끊는다.
        http.answers.add(ok(sessionJson("a2", "r2", "99999999-2222-4333-8444-555555555555")))
        assertEquals(WidgetSession.Outcome.SignedOut, session.accessToken())
        assertNull(vault.value)
    }

    @Test
    fun invalidGrantSignsOut() {
        for (code in listOf(400, 401, 403)) {
            vault.value = null
            signIn()
            clock += 3600_000L
            http.answers.add(status(code))
            assertEquals(WidgetSession.Outcome.SignedOut, session.accessToken())
            assertNull(vault.value)
            assertFalse(session.signedIn())
        }
    }

    @Test
    fun saveFailureAfterRefreshSignsOut() {
        signIn()
        clock += 3600_000L
        vault.failWrite = true
        http.answers.add(ok(sessionJson("a2", "r2")))
        assertEquals(WidgetSession.Outcome.SignedOut, session.accessToken())
        assertNull(vault.value)
    }

    @Test
    fun readTodayUsesWidgetTokenAndRetriesOnceOn401() {
        signIn()
        val (a, b) = WidgetNow.range(clock)
        http.answers.add(status(401))
        http.answers.add(ok("{\"tasks\":[]}"))
        http.answers.add(ok(sessionJson("a2", "r2")))
        http.answers.add(ok("{\"events\":[]}"))
        http.answers.add(ok("{\"tasks\":[]}"))
        val r = session.readToday(a, b)
        assertTrue(r is WidgetSession.Outcome.Ok)
        val gets = http.sent.filter { it.method == "GET" }
        assertEquals("Bearer a1", gets[0].headers["Authorization"])
        assertEquals("Bearer a2", gets[2].headers["Authorization"])
        assertTrue(gets.all { it.headers["apikey"] == WidgetRules.PUBLIC_KEY && it.headers["Origin"] == null })
        // 두 번째도 401이면 실패로 두고 토큰은 지우지 않는다.
        http.answers.add(status(401))
        http.answers.add(status(401))
        http.answers.add(ok(sessionJson("a3", "r3")))
        http.answers.add(status(401))
        http.answers.add(status(401))
        assertTrue(session.readToday(a, b) is WidgetSession.Outcome.Failed)
        assertEquals("v1\n$user\nr3", vault.value)
    }

    @Test
    fun readTodayWithoutLoginSendsNothing() {
        val (a, b) = WidgetNow.range(clock)
        assertEquals(WidgetSession.Outcome.SignedOut, session.readToday(a, b))
        assertTrue(http.sent.isEmpty())
        vault.value = "garbage"
        assertEquals(WidgetSession.Outcome.SignedOut, session.readToday(a, b))
        assertNull(vault.value)
        assertTrue(http.sent.isEmpty())
    }

    @Test
    fun logoutEndsOnlyThisSessionAndClearsVault() {
        signIn()
        session.beginLogin()
        http.answers.add(ok("{}"))
        session.logout()
        val req = http.sent.last()
        assertEquals("https://xmlkxfjeagycwttklxjw.supabase.co/auth/v1/logout?scope=local", req.url)
        assertEquals("Bearer a1", req.headers["Authorization"])
        assertNull(vault.value)
        assertFalse(session.loginPending())
        assertEquals(WidgetSession.Outcome.SignedOut, session.accessToken())
        // 서버가 실패해도 폰의 열쇠는 지운다.
        signIn()
        http.answers.add { throw IOException("down") }
        session.logout()
        assertNull(vault.value)
    }

    @Test
    fun requestAddressListIsFixed() {
        signIn()
        clock += 3600_000L
        http.answers.add(ok(sessionJson("a2", "r2")))
        http.answers.add(ok("{\"events\":[]}"))
        http.answers.add(ok("{\"tasks\":[]}"))
        val (a, b) = WidgetNow.range(clock)
        session.readToday(a, b)
        http.answers.add(ok("{}"))
        session.logout()
        val base = "https://xmlkxfjeagycwttklxjw.supabase.co"
        val seen = http.sent.map { it.method + " " + it.url.substringBefore("&timeMin=") }.toSet()
        assertEquals(
            setOf(
                "POST $base/functions/v1/auth-handoff",
                "POST $base/auth/v1/token?grant_type=refresh_token",
                "GET $base/functions/v1/google-calendar?action=events",
                "GET $base/functions/v1/google-tasks?action=overview",
                "POST $base/auth/v1/logout?scope=local",
            ),
            seen,
        )
        assertTrue(http.sent.all { WidgetRules.allowed(it.method, it.url) })
    }

    @Test
    fun allowedRejectsEverythingElse() {
        val base = "https://xmlkxfjeagycwttklxjw.supabase.co"
        assertFalse(WidgetRules.allowed("GET", WidgetRules.HANDOFF))
        assertFalse(WidgetRules.allowed("POST", WidgetRules.TASKS))
        assertFalse(WidgetRules.allowed("POST", "$base/functions/v1/google-tasks"))
        assertFalse(WidgetRules.allowed("GET", "$base/rest/v1/app_notes"))
        assertFalse(WidgetRules.allowed("POST", "$base/auth/v1/logout"))
        assertFalse(WidgetRules.allowed("POST", "$base/auth/v1/logout?scope=global"))
        assertFalse(WidgetRules.allowed("GET", WidgetRules.TASKS + "&pending_scope=all"))
        assertFalse(WidgetRules.allowed("DELETE", WidgetRules.TASKS))
        assertFalse(WidgetRules.allowed("GET", WidgetRules.CALENDAR_PREFIX + "x&timeMax=y"))
        assertFalse(WidgetRules.allowed("GET", WidgetRules.calendarUrl("2026-10-27T15:00:00Z", "2026-10-28T15:00:00Z") + "&action=create-event"))
        assertTrue(WidgetRules.allowed("GET", WidgetRules.calendarUrl("2026-10-27T15:00:00Z", "2026-10-28T15:00:00Z")))
    }

    @Test
    fun loginUrlIsTheSameAsStepOne() {
        assertEquals(
            "https://xmlkxfjeagycwttklxjw.supabase.co/auth/v1/authorize?provider=google&redirect_to=" +
                "https%3A%2F%2Fbokdoong.com%2Fwork%2Fapp%2Fnative-callback.html%3Fnative%3Dandroid",
            WidgetRules.LOGIN_URL,
        )
    }

    @Test
    fun widgetSourcesDoNotLog() {
        // 토큰·응답 본문을 로그에 쓰지 않는다(설계 8절). 위젯 파일에는 로그 호출 자체가 없다.
        val dir = File("src/main/java/kr/or/kptu/work")
        val files = listOf("WidgetAuth.kt", "WidgetHttp.kt", "WidgetNow.kt", "NowWidget.kt", "WidgetWeek.kt", "WeekWidget.kt", "QuickWriteRules.kt", "WidgetArsenal.kt", "ArsenalWidget.kt", "WidgetRefresh.kt", "KeystoreVault.kt", "MiniJson.kt", "MainActivity.kt")
        for (name in files) {
            val text = File(dir, name).readText()
            for (bad in listOf("Log.", "println(", "printStackTrace", "HttpLoggingInterceptor")) {
                assertFalse("$name: $bad", text.contains(bad))
            }
        }
    }
}
