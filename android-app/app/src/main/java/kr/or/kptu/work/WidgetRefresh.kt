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
 * FIX-위젯: 갱신 작업 한 번의 계획(읽을 주소)과 받은 답으로 그릴 것 만들기. 안드로이드 API를 쓰지 않아 JVM 시험 대상이다.
 * 내용 만들기는 울타리 안에서 해서, 답이 이상해도 '불러오지 못했어요'로 끝난다.
 * S68-13(11/22 사용자): 위젯 세션을 쓰는 위젯은 '이번 주'(보이는 주 일정) 하나. '지금'·'아스날' 위젯은 지웠다.
 * S68-12: weeks = 이번 주 위젯들이 지금 보이는 주(이번 주 0에서 앞뒤 몇 주). 이번 주(0)는 늘 읽고,
 * 옮긴 주는 같은 일정 주소(google-calendar action=events)를 범위만 바꿔 주마다 한 번씩 더 읽는다(새 주소 없음).
 */
class WidgetRefresh(val nowMs: Long, weeks: Set<Int> = setOf(0)) {
    sealed class Paint<out T> {
        data class Shown<T>(val content: T) : Paint<T>()
        object SignedOut : Paint<Nothing>()
        object Failed : Paint<Nothing>()
    }

    /** 위젯에 그릴 것. */
    data class Result(
        val week: Paint<WidgetWeek.Content>,
        /** S68-02: 서버 기능 목록에 nojo_words가 있나(모르면 null). 앱 사진 폴더 이름 고르기에 쓰려고 기기 설정에 둔다(AppFolders). */
        val nojoWords: Boolean? = null,
        /** S68-12: 주(shift)마다 그릴 것. 0은 week와 같다. */
        val weeks: Map<Int, Paint<WidgetWeek.Content>> = emptyMap(),
    )

    /** 읽을 주(shift): 0을 먼저, 그다음 작은 것부터. 범위 밖은 끝으로 맞춘다. */
    val shifts: List<Int> = (listOf(0) + weeks.map(WidgetWeek::clamp).sorted()).distinct()

    /** 주마다 일정 주소(같은 주소 모양, 범위만 다름). */
    val weekCals: Map<Int, String> = shifts.associateWith { s -> WidgetWeek.range(nowMs, shift = s).let { (a, b) -> WidgetRules.calendarUrl(a, b) } }
    val weekCal: String = weekCals.getValue(0)

    /**
     * 위젯 세션으로 한 번에 읽을 주소(겹치는 주소는 한 번). APP-위젯날짜고르기: 고른 날 기한 할 일을 위해 할 일 주소도 함께.
     * S68-02: 내 서버 기능 목록(바탕 낱말 nojo_words인지)도 한 번.
     */
    val urls: List<String> = LinkedHashSet<String>().apply {
        addAll(weekCals.values)
        add(WidgetRules.TASKS)
        add(WidgetRules.FEATURES)
    }.toList()

    /** 받은 답(readList 결과) → 그릴 것. 내용 만들기는 시험에서 바꿔 끼울 수 있다. */
    fun result(
        outcome: WidgetSession.Outcome<List<WidgetSession.Reply>>,
        weekContent: (WidgetSession.Reply, WidgetSession.Reply, Long, Int) -> WidgetWeek.Content = { cal, tasks, t, shift ->
            WidgetWeek.content(cal.status, cal.body, t, tasksStatus = tasks.status, tasks = tasks.body, shift = shift)
        },
    ): Result {
        val replies = when (outcome) {
            is WidgetSession.Outcome.Ok -> outcome.value
            is WidgetSession.Outcome.SignedOut -> return Result(Paint.SignedOut, weeks = shifts.associateWith { Paint.SignedOut })
            is WidgetSession.Outcome.Failed -> return Result(Paint.Failed, weeks = shifts.associateWith { Paint.Failed })
        }
        val got = if (replies.size == urls.size) urls.zip(replies).toMap() else emptyMap()
        val nojo = got[WidgetRules.FEATURES]?.let { AppFolderRules.nojoWordsOf(it.status, it.body) }
        // 주마다 울타리를 따로 둔다(옮긴 주 하나가 이상해도 이번 주는 그린다).
        val weekPaints: Map<Int, Paint<WidgetWeek.Content>> = weekCals.mapValues { (s, url) ->
            paint { weekContent(got.getValue(url), got.getValue(WidgetRules.TASKS), nowMs, s) }
        }
        return Result(weekPaints.getValue(0), nojo, weekPaints)
    }

    private fun <T> paint(block: () -> T?): Paint<T> = WidgetGuard.get(block)?.let { Paint.Shown(it) } ?: Paint.Failed

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
