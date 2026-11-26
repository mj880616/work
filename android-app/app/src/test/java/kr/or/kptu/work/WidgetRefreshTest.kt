package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.ZoneId
import java.time.ZonedDateTime
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/**
 * FIX-위젯: 위젯이 빈칸·'불러오는 중'에 멈추던 문제(0.3.5~0.3.7).
 * 원인: WidgetToday의 정규식 (?U)가 안드로이드(ICU)에서 PatternSyntaxException → WidgetToday 초기화 실패 →
 * 그 객체를 쓰는 오늘·이번 주·텔레그램·아스날 그리기와 갱신 작업이 모두 예외로 끝남. JVM에서는 (?U)가 되어 시험이 못 잡았다.
 * S68-13(11/22 사용자): '지금'·'아스날' 위젯을 지워 위젯 세션을 쓰는 위젯은 '이번 주' 하나.
 */
class WidgetRefreshTest {
    private val src = File("src/main/java/kr/or/kptu/work")
    private val now = ZonedDateTime.of(2026, 10, 30, 19, 12, 0, 0, ZoneId.of("Asia/Seoul")).toInstant().toEpochMilli()

    private fun reply(status: Int, json: String?) = WidgetSession.Reply(status, MiniJson.parse(json))

    // 지금 서버 응답 모양(google-calendar normEvent·google-tasks overview·PostgREST 표)을 본뜬 가짜 값. 지금은 금 10/30 19:12(서울).
    private fun ev(id: String, title: String, start: String, end: String, allDay: Boolean) =
        """{"id":"$id","title":"$title","start":"$start","end":"$end","allDay":$allDay,"location":"","description":"","calendarId":"primary","colorId":null,"color":null,"htmlLink":"","organizationIds":[],"recurring":false,"mine":true,"source":"google"}"""
    private val e1 = ev("e1", "운영위 회의", "2026-10-30T10:00:00+09:00", "2026-10-30T11:00:00+09:00", false)
    private val e2 = ev("e2", "창립 기념일", "2026-10-30", "2026-10-31", true)
    private val e4 = ev("e4", "평가회의", "2026-10-30T20:30:00+09:00", "2026-10-30T21:30:00+09:00", false)
    private val e5 = ev("e5", "주말 당직", "2026-10-31", "2026-11-01", true)
    private val e3 = ev("e3", "교섭", "2026-10-25T14:00:00+09:00", "2026-10-25T16:00:00+09:00", false)
    // 서버가 timeMin~timeMax로 거른 답: '이번 주'는 일~다음 일(S69-위젯일요일).
    private val week = """{"events":[$e1,$e2,$e4,$e5,$e3],"colors":{},"eventColors":{}}"""
    private val tasks = """{"connected":true,"authorized":true,"needs_reconnect":false,"email":null,"tasks":[
        {"id":"t1","title":"보고서 보내기","notes":"","due":"2026-10-30T00:00:00.000Z","status":"needsAction","completed":null,"updated":null,"taskListId":"@default","taskListTitle":"내 할 일","position":null,"webViewLink":null,"source":"google-task"},
        {"id":"t2","title":"지난 일","notes":"","due":"2026-10-28T00:00:00.000Z","status":"needsAction","completed":null,"updated":null,"taskListId":"@default","taskListTitle":"내 할 일","position":null,"webViewLink":null,"source":"google-task"}
      ]}"""

    // S68-02: 서버 기능 목록(app_my_features). 기본은 사용자 화면(nojo_words)처럼.
    private var features = """["calls","nojo_words"]"""

    private fun serverReplies(plan: WidgetRefresh): List<WidgetSession.Reply> = plan.urls.map { url ->
        when (url) {
            plan.weekCal -> reply(200, week)
            WidgetRules.TASKS -> reply(200, tasks)
            WidgetRules.FEATURES -> reply(200, features)
            else -> throw AssertionError(url)
        }
    }

    @Test
    fun noJavaOnlyRegexFlagsInAppCode() {
        // 안드로이드 정규식(ICU)의 줄 안 표시는 i·m·s·x·w뿐. (?U)·(?u)·(?d)·UNICODE_CHARACTER_CLASS·CANON_EQ는 기기에서 예외.
        // CI는 scripts/check-icu-regex.py로 실제 ICU에도 만들어 본다.
        val inline = Regex("""\(\?([A-Za-z-]+)[:)]""")
        src.listFiles()!!.filter { it.name.endsWith(".kt") }.forEach { f ->
            val text = f.readText()
            assertFalse(f.name, text.contains("UNICODE_CHARACTER_CLASS") || text.contains("CANON_EQ"))
            inline.findAll(text).forEach { m ->
                assertTrue("${f.name}: ${m.value}", m.groupValues[1].all { it in "imsxw-" })
            }
        }
    }

    @Test
    fun weekFromServerShapes() {
        val plan = WidgetRefresh(nowMs = now)
        // 모두 허용 주소. 텔레그램 읽기·처리 전 후보 읽기는 없다(위젯 지움).
        // S68-02: 서버 기능 목록(app_my_features)은 보고일 이름·앱 사진 폴더 이름(nojo_words)에만 읽는다.
        assertEquals(plan.urls.toSet().size, plan.urls.size)
        assertEquals(3, plan.urls.size)
        plan.urls.forEach { assertTrue(it, WidgetRules.allowed("GET", it)) }
        assertFalse(plan.urls.any { it.contains("feed") || it.contains("app_todo_candidates") || it.contains("arsenal") })
        assertEquals(1, plan.urls.count { it == WidgetRules.FEATURES })
        val r = plan.result(WidgetSession.Outcome.Ok(serverReplies(plan)))

        val wk = (r.week as WidgetRefresh.Paint.Shown<WidgetWeek.Content>).content
        assertEquals("이번 주 10/25–10/31", wk.title)
        assertEquals(5, wk.total)
        assertEquals(listOf(1, 0, 0, 0, 0, 3, 1), wk.days.map { it.count })
        // APP-위젯날짜고르기: 금요일을 고르면 그 날 일정(종일 먼저·시각 순) 다음 기한 할 일. 지난 할 일(10/28)은 그 날에.
        val fri = wk.details.getValue(java.time.LocalDate.of(2026, 10, 30))
        assertEquals(3, fri.events)
        assertEquals(1, fri.tasks)
        assertEquals("10/30(금)", WidgetWeek.detailHead(fri))
        // S68-51: 줄임('외 n') 없이 전부. S69-07: 다가오는 일·보고일 줄 없음, 할 일은 머리 아래 따로.
        assertEquals(listOf("종일  창립 기념일", "10:00  운영위 회의", "20:30  평가회의", "할 일 1", "보고서 보내기"), WidgetWeek.dayRows(fri).map { it.text })
        assertEquals(WidgetWeek.Kind.TASK, WidgetWeek.dayRows(fri).last().kind)
        assertEquals(listOf("할 일 1", "지난 일"), WidgetWeek.dayRows(wk.details.getValue(java.time.LocalDate.of(2026, 10, 28))).map { it.text })
        assertEquals(listOf("일정·할 일 없음"), WidgetWeek.dayRows(wk.details.getValue(java.time.LocalDate.of(2026, 10, 27))).map { it.text })
    }

    @Test
    fun weekAloneReadsOnlyCalendarAndExistingTasksAddress() {
        // 일정 + 할 일 주소 + 서버 기능 목록(S68-02, 보고일 이름).
        val plan = WidgetRefresh(nowMs = now)
        assertEquals(listOf(plan.weekCal, WidgetRules.TASKS, WidgetRules.FEATURES), plan.urls)
        plan.urls.forEach { assertTrue(it, WidgetRules.allowed("GET", it)) }
        val wk = (plan.result(WidgetSession.Outcome.Ok(serverReplies(plan))).week as WidgetRefresh.Paint.Shown<WidgetWeek.Content>).content
        assertEquals(1, wk.details.getValue(java.time.LocalDate.of(2026, 10, 30)).tasks)
        // 할 일을 읽지 못해도 일정은 그린다(그 날 머리 줄에 '할 일 읽지 못함').
        val down = plan.result(WidgetSession.Outcome.Ok(listOf(reply(200, week), reply(500, null), reply(200, features))))
        val fri = (down.week as WidgetRefresh.Paint.Shown<WidgetWeek.Content>).content.details.getValue(java.time.LocalDate.of(2026, 10, 30))
        assertNull(fri.tasks)
        assertEquals("10/30(금)", WidgetWeek.detailHead(fri))
        assertEquals("할 일 읽지 못함", WidgetWeek.dayRows(fri).last().text)
    }

    @Test
    fun shiftedWeeksReadSameCalendarAddressWithOtherRange() {
        // S68-12: 위젯이 옮겨 둔 주(-1·+2)는 같은 일정 주소 모양을 범위만 바꿔 한 번씩 더 읽는다. 이번 주(0)는 늘 먼저.
        val plan = WidgetRefresh(nowMs = now, weeks = setOf(2, -1, 0, 2))
        assertEquals(listOf(0, -1, 2), plan.shifts)
        assertEquals(plan.weekCals.getValue(0), plan.weekCal)
        assertEquals(listOf(plan.weekCals.getValue(0), plan.weekCals.getValue(-1), plan.weekCals.getValue(2), WidgetRules.TASKS, WidgetRules.FEATURES), plan.urls)
        plan.urls.forEach { assertTrue(it, WidgetRules.allowed("GET", it)) }
        val (a, b) = WidgetWeek.range(now, shift = 2)
        assertEquals(WidgetRules.calendarUrl(a, b), plan.weekCals.getValue(2))
        // 범위 밖은 끝 주로.
        assertEquals(listOf(0, WidgetWeek.MAX_SHIFT), WidgetRefresh(now, setOf(40)).shifts)
        val replies = plan.urls.map { url ->
            when (url) {
                plan.weekCals.getValue(2) -> reply(500, null)
                WidgetRules.TASKS -> reply(200, tasks)
                WidgetRules.FEATURES -> reply(200, features)
                else -> reply(200, week)
            }
        }
        val r = plan.result(WidgetSession.Outcome.Ok(replies))
        assertEquals(r.week, r.weeks[0])
        val last = (r.weeks.getValue(-1) as WidgetRefresh.Paint.Shown<WidgetWeek.Content>).content
        assertEquals("지난주 10/18–10/24", last.title)
        assertEquals(java.time.LocalDate.of(2026, 10, 18), last.sunday)
        // 옮긴 주 하나가 이상해도 이번 주는 그린다(주마다 울타리).
        val bad = plan.result(WidgetSession.Outcome.Ok(replies), weekContent = { c, t, ms, s ->
            if (s == -1) throw IllegalStateException("x") else WidgetWeek.content(c.status, c.body, ms, tasksStatus = t.status, tasks = t.body, shift = s)
        })
        assertEquals(WidgetRefresh.Paint.Failed, bad.weeks[-1])
        assertTrue(bad.weeks[0] is WidgetRefresh.Paint.Shown)
        // 로그아웃·실패는 모든 주에.
        assertEquals(setOf(0, -1, 2), plan.result(WidgetSession.Outcome.SignedOut).weeks.keys)
    }

    @Test
    fun oneWidgetFailureDoesNotBlockOthers() {
        val plan = WidgetRefresh(nowMs = now)
        // 0.3.7의 실제 실패 모양(클래스 초기화 오류): 내용 만들기가 실패해도 예외가 밖으로 나가지 않고 '실패'로 그린다.
        val r = plan.result(
            WidgetSession.Outcome.Ok(serverReplies(plan)),
            weekContent = { _, _, _, _ -> throw ExceptionInInitializerError(IllegalArgumentException("regex")) },
        )
        assertEquals(WidgetRefresh.Paint.Failed, r.week)
        val r2 = plan.result(WidgetSession.Outcome.Ok(serverReplies(plan)), weekContent = { _, _, _, _ -> throw NoClassDefFoundError("x") })
        assertEquals(WidgetRefresh.Paint.Failed, r2.week)
        assertTrue(plan.result(WidgetSession.Outcome.Ok(serverReplies(plan))).week is WidgetRefresh.Paint.Shown)

        // 울타리: 앞이 실패해도 뒤를 한다.
        val done = ArrayList<String>()
        val failed = WidgetGuard.each(
            listOf<Pair<String, () -> Unit>>(
                "arsenal" to { throw ExceptionInInitializerError() },
                "now" to { done.add("now"); Unit },
                "x" to { throw IllegalStateException() },
                "week" to { done.add("week"); Unit },
            ),
        )
        assertEquals(listOf("arsenal", "x"), failed)
        assertEquals(listOf("now", "week"), done)
        assertNull(WidgetGuard.get<String> { throw NoClassDefFoundError("x") })
    }

    @Test
    fun signedOutAndFailedReachTheWidget() {
        val plan = WidgetRefresh(nowMs = now)
        val out = plan.result(WidgetSession.Outcome.SignedOut)
        assertEquals(WidgetRefresh.Paint.SignedOut, out.week)
        assertNull(out.nojoWords)
        val down = plan.result(WidgetSession.Outcome.Failed("network"))
        assertEquals(WidgetRefresh.Paint.Failed, down.week)
        // 답 수가 맞지 않으면 엉뚱한 칸에 그리지 않고 실패로.
        val short = plan.result(WidgetSession.Outcome.Ok(listOf(reply(200, "{}"))))
        assertEquals(WidgetRefresh.Paint.Failed, short.week)
    }

    @Test
    fun refreshNowIsExpeditedAndRunsOnOpenAndLogin() {
        assertTrue(WidgetRefresh.expedite(31))
        assertTrue(WidgetRefresh.expedite(36))
        assertFalse(WidgetRefresh.expedite(30))
        assertFalse(WidgetRefresh.expedite(29))
        // 앱을 열 때: 처음이거나 5분이 지났을 때만(배터리).
        assertTrue(WidgetRefresh.dueOnOpen(now, 0L))
        assertFalse(WidgetRefresh.dueOnOpen(now, now - 60_000))
        assertTrue(WidgetRefresh.dueOnOpen(now, now - WidgetRefresh.OPEN_REFRESH_AFTER_MS))
        assertTrue(WidgetRefresh.dueOnOpen(now, now + 60_000))

        val jobs = File(src, "HomeWidgets.kt").readText()
        assertTrue(jobs.contains("builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)"))
        assertTrue(jobs.contains("if (WidgetRefresh.expedite(Build.VERSION.SDK_INT))"))
        // 위젯 로그인 직후에는 도는 작업을 새로 바꾼다.
        assertTrue(jobs.contains("WidgetJobs.refreshNow(context, replace = true)"))
        // 갱신 작업은 울타리 안에서. S68-13: 지운 '지금'·'아스날' 위젯을 부르지 않는다.
        assertTrue(jobs.contains("WidgetGuard.run { refreshSigned(ctx, at) }"))
        for (gone in listOf("NowWidget", "ArsenalWidget", "WidgetArsenal")) assertFalse(gone, jobs.contains(gone))
        val main = File(src, "MainActivity.kt").readText()
        assertTrue(main.contains("WidgetGuard.run { WidgetJobs.refreshOnOpen(applicationContext) }"))
        // 놓을 때(onUpdate)도 바로 한 번.
        assertTrue(File(src, "WeekWidget.kt").readText().contains("WidgetJobs.refreshNow(context)"))
    }

    private val android = "http://schemas.android.com/apk/res/android"

    private fun view(path: String, id: String): Element {
        val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(File(path))
        val all = doc.getElementsByTagName("TextView")
        for (i in 0 until all.length) {
            val e = all.item(i) as Element
            if (e.getAttributeNS(android, "id") == "@+id/$id") return e
        }
        throw AssertionError("$path $id")
    }

    @Test
    fun initialLayoutsAreNeverBlank() {
        // 놓자마자·앱이 그리기 전에도 빈칸이 아니게: 머리와 '불러오는 중'이 기본으로 보인다.
        val cases = listOf(
            Triple("week_widget", "week_title" to "이번 주", "week_note"),
        )
        for ((layout, title, note) in cases) {
            val path = "src/main/res/layout/$layout.xml"
            assertEquals(layout, title.second, view(path, title.first).getAttributeNS(android, "text"))
            val n = view(path, note)
            assertEquals(layout, "불러오는 중", n.getAttributeNS(android, "text"))
            assertFalse(layout, n.getAttributeNS(android, "visibility") == "gone")
        }
        // 위젯 로그인이 없을 때의 한 줄. 지운 위젯 파일은 없다(S68-13: '지금'·'아스날'도).
        for (gone in listOf("TodayWidget.kt", "TelegramWidget.kt", "WidgetTelegram.kt", "NowWidget.kt", "ArsenalWidget.kt", "WidgetArsenal.kt")) {
            assertFalse(gone, File(src, gone).exists())
        }
        for (name in listOf("WeekWidget.kt")) {
            val text = File(src, name).readText()
            assertTrue(name, text.contains("HomeWidgets.SIGNED_OUT_LINE"))
            assertTrue(name, text.contains("WidgetGuard.run { draw(context, state, manager, ids) }") || text.contains("WidgetGuard.run { paint(context, state, manager, ids) }"))
        }
    }

    @Test
    fun nojoWordsFollowsServerFeatures() {
        // S68-02: 서버 기능 목록(nojo_words)은 앱 사진 폴더 이름에 쓴다. S69-07: 위젯 보고일 줄은 없앴다.
        val plan = WidgetRefresh(nowMs = now)
        fun label(featureReply: WidgetSession.Reply): Boolean? {
            val r = plan.result(WidgetSession.Outcome.Ok(listOf(reply(200, week), reply(200, tasks), featureReply)))
            assertTrue(r.week is WidgetRefresh.Paint.Shown)
            return r.nojoWords
        }
        assertEquals(false, label(reply(200, """["calls"]""")))
        assertEquals(false, label(reply(200, "[]")))
        assertEquals(true, label(reply(200, """["nojo_words"]""")))
        assertNull(label(reply(500, null)))
        assertNull(label(reply(200, """{"nojo_words":true}""")))
        // 기능 목록이 실패해도 일정 칸은 그린다.
        // 위젯은 기능 목록을 GET으로만, 다른 rpc 주소·POST는 허용 목록 밖.
        assertTrue(WidgetRules.allowed("GET", WidgetRules.FEATURES))
        assertFalse(WidgetRules.allowed("POST", WidgetRules.FEATURES))
        assertFalse(WidgetRules.allowed("GET", WidgetRules.SUPABASE + "/rest/v1/rpc/app_operator_feature_workspace"))
    }
}
