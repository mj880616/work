package kr.or.kptu.work

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * WIDGET-여러개 ②: '웹2 이번 주' 위젯(4×2)에 그릴 줄. 안드로이드 API를 쓰지 않아 JVM 시험 대상이다.
 * 범위: 이번 주 월요일 0시 ~ 다음 월요일 0시(서울). 읽기는 오늘 위젯과 같은 google-calendar action=events(허용 주소 그대로).
 * 보이는 줄은 오늘부터 일요일까지(지난 날은 뺌). 줄을 누르면 앱 달력의 그 날(웹 ?view=calendar&day=).
 * 만든 줄은 폰에 저장하지 않는다(결정 W-D2).
 */
object WidgetWeek {
    const val MAX_ROWS = 8
    private val HHMM = DateTimeFormatter.ofPattern("HH:mm")
    private val DAYS = arrayOf("월", "화", "수", "목", "금", "토", "일")
    private val DAY = Regex("^\\d{4}-\\d{2}-\\d{2}$")

    data class Row(val day: LocalDate, val text: String)

    data class Content(val title: String, val rows: List<Row>, val note: String?)

    private fun monday(nowMs: Long, zone: ZoneId): LocalDate {
        val d = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        return d.minusDays((d.dayOfWeek.value - DayOfWeek.MONDAY.value).toLong())
    }

    /** 이번 주 월요일 0시와 다음 월요일 0시(서울)를 UTC 글(…Z)로. */
    fun range(nowMs: Long, zone: ZoneId = WidgetToday.ZONE): Pair<String, String> {
        val m = monday(nowMs, zone)
        return m.atStartOfDay(zone).toInstant().toString() to m.plusDays(7).atStartOfDay(zone).toInstant().toString()
    }

    fun header(nowMs: Long, zone: ZoneId = WidgetToday.ZONE): String {
        val m = monday(nowMs, zone)
        val e = m.plusDays(6)
        return "이번 주 ${m.monthValue}.${m.dayOfMonth}~${e.monthValue}.${e.dayOfMonth}"
    }

    fun dayLabel(d: LocalDate): String = "${DAYS[d.dayOfWeek.value - 1]} ${d.dayOfMonth}"

    /** 앱 달력의 그 날을 여는 주소(웹이 읽고 주소에서 지운다). */
    fun dayUrl(day: LocalDate): String = ShellRules.HOME + "?view=calendar&day=" + day

    /** 웹2가 이미 떠 있을 때 다리로 보내는 글. */
    fun dayMessage(day: LocalDate): String = "day:open:$day"

    /** 밖에서 받은 날짜 글은 yyyy-mm-dd 모양의 실제 날짜만. */
    fun parseDay(value: String?): LocalDate? {
        if (value == null || !DAY.matches(value)) return null
        return try {
            LocalDate.parse(value)
        } catch (_: Exception) {
            null
        }
    }

    /** google-calendar action=events 응답 → 오늘~일요일 줄. 날짜순, 같은 날은 종일 먼저, 그다음 시각 순. */
    fun rows(body: Any?, nowMs: Long, zone: ZoneId = WidgetToday.ZONE): List<Row> {
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        val end = monday(nowMs, zone).plusDays(7)
        val list = MiniJson.list(MiniJson.obj(body)?.get("events")) ?: return emptyList()
        data class E(val day: LocalDate, val allDay: Boolean, val at: Long, val label: String, val title: String)
        val out = ArrayList<E>()
        for (item in list) {
            val e = MiniJson.obj(item) ?: continue
            val start = MiniJson.str(e["start"]) ?: continue
            val title = WidgetToday.cleanTitle(MiniJson.str(e["title"]))
            if (e["allDay"] == true) {
                val first = parse(start) ?: continue
                // 구글 종일 일정의 끝은 끝난 다음 날(제외). 지난 날 시작해 오늘도 이어지면 오늘에 둔다.
                val after = MiniJson.str(e["end"])?.let(::parse)
                if (first.isBefore(today) && (after == null || !after.isAfter(today))) continue
                val d = if (first.isBefore(today)) today else first
                if (!d.isBefore(end)) continue
                out.add(E(d, true, d.toEpochDay(), "종일", title))
            } else {
                val t = time(start) ?: continue
                val local = t.atZoneSameInstant(zone)
                var d = local.toLocalDate()
                var label = local.format(HHMM)
                if (d.isBefore(today)) {
                    // 지난 날 시작해 오늘까지 이어지는 일정만 '계속'으로 오늘에 둔다.
                    val until = MiniJson.str(e["end"])?.let(::time)
                    if (until == null || !until.toInstant().isAfter(today.atStartOfDay(zone).toInstant())) continue
                    d = today
                    label = "계속"
                }
                if (!d.isBefore(end)) continue
                out.add(E(d, false, t.toInstant().toEpochMilli(), label, title))
            }
        }
        out.sortWith(compareBy<E>({ it.day }, { !it.allDay }, { it.at }))
        return out.map { Row(it.day, dayLabel(it.day) + "  " + it.label + "  " + it.title) }
    }

    fun content(status: Int, body: Any?, nowMs: Long, zone: ZoneId = WidgetToday.ZONE): Content {
        if (status != 200) return Content(header(nowMs, zone), emptyList(), "일정 연결을 확인해 주세요")
        val all = rows(body, nowMs, zone)
        val warn = MiniJson.obj(body)?.get("warning") != null
        val shown = if (all.size <= MAX_ROWS) all else all.take(MAX_ROWS - 1) + Row(all[MAX_ROWS - 1].day, "일정 ${all.size - (MAX_ROWS - 1)}개 더")
        val note = when {
            all.isEmpty() && warn -> "일정을 읽지 못했어요"
            all.isEmpty() -> "이번 주 남은 일정이 없어요"
            else -> null
        }
        return Content(header(nowMs, zone), shown, note)
    }

    private fun parse(value: String): LocalDate? =
        try {
            LocalDate.parse(value.take(10))
        } catch (_: Exception) {
            null
        }

    private fun time(value: String): OffsetDateTime? =
        try {
            OffsetDateTime.parse(value)
        } catch (_: Exception) {
            null
        }
}
