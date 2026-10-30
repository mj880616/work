package kr.or.kptu.work

/**
 * FIX-위젯: 위젯 하나의 실패가 다른 위젯·갱신 작업을 막지 않게 하는 울타리. 안드로이드 API를 쓰지 않아 JVM 시험 대상이다.
 * 예외와 클래스 초기화 실패(ExceptionInInitializerError·NoClassDefFoundError = LinkageError)를 그 자리에서 멈춘다.
 * 0.3.5~0.3.7에서는 한 객체의 초기화 실패가 홈 화면 그리기·갱신 작업 전체를 끊어 위젯이 빈칸·'불러오는 중'에 멈췄다.
 * 내용(토큰·응답)은 남기지 않는다. 실패는 위젯의 '불러오지 못했어요' 한 줄로만 보인다.
 */
object WidgetGuard {
    /** 일 하나. 끝까지 했으면 true, 실패면 false. */
    fun run(block: () -> Unit): Boolean =
        try {
            block()
            true
        } catch (_: Exception) {
            false
        } catch (_: LinkageError) {
            false
        }

    /** 값 하나. 실패면 null. */
    fun <T> get(block: () -> T): T? =
        try {
            block()
        } catch (_: Exception) {
            null
        } catch (_: LinkageError) {
            null
        }

    /** 차례로 모두 한다(앞이 실패해도 뒤를 한다). 실패한 이름 목록. */
    fun each(jobs: List<Pair<String, () -> Unit>>): List<String> = jobs.filter { !run(it.second) }.map { it.first }
}

/**
 * FIX-위젯: 갱신 작업 한 번의 계획(읽을 주소)과 받은 답을 위젯마다 나누기. 안드로이드 API를 쓰지 않아 JVM 시험 대상이다.
 * 위젯마다 내용 만들기를 따로 울타리 안에서 해서, 한 위젯의 답이 이상해도 다른 위젯은 그린다.
 */
class WidgetRefresh(val today: Boolean, val week: Boolean, val tg: Boolean, val nowMs: Long) {
    sealed class Paint<out T> {
        data class Shown<T>(val content: T) : Paint<T>()
        object SignedOut : Paint<Nothing>()
        object Failed : Paint<Nothing>()
    }

    /** 위젯마다 그릴 것. 그 위젯이 없으면 null. */
    data class Result(
        val today: Paint<WidgetToday.Content>?,
        val week: Paint<WidgetWeek.Content>?,
        val tg: Paint<WidgetTelegram.Content>?,
    )

    val todayCal: String
    val weekCal: String
    val feedDays: String
    val feedItems: String

    init {
        val (from, to) = WidgetToday.range(nowMs)
        val (weekFrom, weekTo) = WidgetWeek.range(nowMs)
        val day = WidgetTelegram.today(nowMs)
        todayCal = WidgetRules.calendarUrl(from, to)
        weekCal = WidgetRules.calendarUrl(weekFrom, weekTo)
        feedDays = WidgetRules.feedDaysUrl(day.toString())
        feedItems = WidgetRules.feedItemsUrl(day.minusDays(1).toString())
    }

    /** 위젯 세션으로 한 번에 읽을 주소(겹치는 주소는 한 번). */
    val urls: List<String> = LinkedHashSet<String>().apply {
        if (today) addAll(listOf(todayCal, WidgetRules.TASKS, WidgetRules.CANDIDATES))
        if (week) add(weekCal)
        if (tg) addAll(listOf(WidgetRules.FEATURES, feedDays, feedItems, WidgetRules.TASKS, WidgetRules.CANDIDATES))
    }.toList()

    /** 받은 답(readList 결과) → 위젯마다 그릴 것. 내용 만들기는 시험에서 바꿔 끼울 수 있다. */
    fun result(
        outcome: WidgetSession.Outcome<List<WidgetSession.Reply>>,
        todayContent: (WidgetSession.Raw, Long) -> WidgetToday.Content = { raw, now -> WidgetToday.content(raw, now) },
        weekContent: (Int, Any?, Long) -> WidgetWeek.Content = { status, body, now -> WidgetWeek.content(status, body, now) },
        tgContent: (Map<String, WidgetSession.Reply>) -> WidgetTelegram.Content? = { got -> telegram(got) },
    ): Result {
        val replies = when (outcome) {
            is WidgetSession.Outcome.Ok -> outcome.value
            is WidgetSession.Outcome.SignedOut -> return everyone(Paint.SignedOut)
            is WidgetSession.Outcome.Failed -> return everyone(Paint.Failed)
        }
        val got = if (replies.size == urls.size) urls.zip(replies).toMap() else emptyMap()
        val todayPaint = if (!today) null else paint {
            val c = got.getValue(todayCal)
            val t = got.getValue(WidgetRules.TASKS)
            val k = got.getValue(WidgetRules.CANDIDATES)
            todayContent(WidgetSession.Raw(c.status, c.body, t.status, t.body, k.status, k.body), nowMs)
        }
        val weekPaint = if (!week) null else paint {
            val w = got.getValue(weekCal)
            weekContent(w.status, w.body, nowMs)
        }
        val tgPaint = if (!tg) null else paint { tgContent(got) }
        return Result(todayPaint, weekPaint, tgPaint)
    }

    private fun everyone(p: Paint<Nothing>): Result = Result(p.takeIf { today }, p.takeIf { week }, p.takeIf { tg })

    private fun <T> paint(block: () -> T?): Paint<T> = WidgetGuard.get(block)?.let { Paint.Shown(it) } ?: Paint.Failed

    private fun telegram(got: Map<String, WidgetSession.Reply>): WidgetTelegram.Content? {
        val k = got.getValue(WidgetRules.CANDIDATES)
        val t = got.getValue(WidgetRules.TASKS)
        val asks = when (k.status) {
            200 -> WidgetToday.counts(k.body, if (t.status == 200) t.body else null)?.asks
            404 -> 0
            else -> null
        }
        return WidgetTelegram.content(got.getValue(WidgetRules.FEATURES), got[feedDays], got[feedItems], asks)
    }

    companion object {
        /** 지금 한 번 갱신을 '급한 작업'(expedited)으로 낼지. 안드로이드 12(API 31)부터만: 그 아래는 앞쪽 알림이 있어야 해서 일반 작업. */
        const val EXPEDITE_FROM_SDK = 31

        fun expedite(sdk: Int): Boolean = sdk >= EXPEDITE_FROM_SDK

        /** 앱을 열 때 위젯을 새로 받을지(배터리: 마지막 갱신에서 이만큼 지났을 때만). */
        const val OPEN_REFRESH_AFTER_MS = 5 * 60 * 1000L

        fun dueOnOpen(nowMs: Long, lastRunMs: Long): Boolean =
            lastRunMs <= 0L || nowMs < lastRunMs || nowMs - lastRunMs >= OPEN_REFRESH_AFTER_MS
    }
}
