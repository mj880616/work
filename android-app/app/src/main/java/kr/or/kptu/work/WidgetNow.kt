package kr.or.kptu.work

import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId

/**
 * 위젯이 함께 쓰는 일정 읽기(서울 시간대·제목 다듬기·google-calendar events 응답 → 일정 목록). '이번 주' 위젯(WidgetWeek)이 쓴다.
 * 안드로이드 API를 쓰지 않아 JVM 시험 대상이다. 만든 내용은 폰에 저장하지 않는다(결정 W-D2).
 * S68-13(11/22 사용자): '지금' 위젯을 지우면서 그 위젯만 쓰던 것(다음 일정·남은 시간·요청·챙길 것·오늘 기한 줄)을 뺐다.
 */
object WidgetNow {
    val ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    private const val MAX_TITLE = 80

    fun cleanTitle(value: String?): String {
        val t = (value ?: "").replace(Regex("[\\u0000-\\u001f\\u007f\\u2028\\u2029]+"), " ").trim()
        val cut = t.codePoints().limit(MAX_TITLE.toLong()).toArray().let { String(it, 0, it.size) }.trim()
        return cut.ifEmpty { "(제목 없음)" }
    }

    /** 일정 하나(서울 기준 날짜). 종일 일정은 startMs·endMs가 그 날 0시·끝난 다음 날 0시. */
    data class Ev(val allDay: Boolean, val startMs: Long, val endMs: Long, val day: LocalDate, val title: String)

    /** google-calendar action=events 응답 → 일정 목록(시작 순, 같은 날은 종일 먼저). 모양이 다른 줄은 뺀다. */
    fun events(body: Any?, zone: ZoneId = ZONE): List<Ev> {
        val list = MiniJson.list(MiniJson.obj(body)?.get("events")) ?: return emptyList()
        val out = ArrayList<Ev>()
        for (item in list) {
            val e = MiniJson.obj(item) ?: continue
            val start = MiniJson.str(e["start"]) ?: continue
            val title = cleanTitle(MiniJson.str(e["title"]))
            if (e["allDay"] == true) {
                val d = date(start) ?: continue
                val after = MiniJson.str(e["end"])?.let(::date)?.takeIf { it.isAfter(d) } ?: d.plusDays(1)
                out.add(Ev(true, d.atStartOfDay(zone).toInstant().toEpochMilli(), after.atStartOfDay(zone).toInstant().toEpochMilli(), d, title))
            } else {
                val t = time(start) ?: continue
                val s = t.toInstant().toEpochMilli()
                val end = MiniJson.str(e["end"])?.let(::time)?.toInstant()?.toEpochMilli()?.takeIf { it >= s } ?: s
                out.add(Ev(false, s, end, t.atZoneSameInstant(zone).toLocalDate(), title))
            }
        }
        out.sortWith(compareBy<Ev>({ it.day }, { !it.allDay }, { it.startMs }))
        return out
    }

    private fun date(value: String): LocalDate? =
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
