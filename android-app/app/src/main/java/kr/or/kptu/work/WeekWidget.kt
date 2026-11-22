package kr.or.kptu.work

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDate

/**
 * 홈 화면 '웹2 이번 주' 위젯(4×2·4×1, APP-위젯다시 ③). '지금' 위젯과 같은 위젯 세션·같은 갱신 작업(WidgetWorker) 하나로 읽는다.
 * 아래 줄·4×1 요일 칸을 누르면 앱 달력의 그 날(MainActivity ACTION_DAY → 웹 ?view=calendar&day= 또는 다리 day:open:).
 * APP-위젯날짜고르기: 4×2 요일 칸을 누르면 앱을 열지 않고 아래 칸이 그 날 일정·기한 할 일로 바뀐다(ACTION_PICK).
 * 같은 날을 다시 누르거나 날이 바뀌면 주간 요약으로 돌아간다. [열기]만 앱 달력의 그 날을 연다.
 * 마지막에 그린 내용과 고른 날짜는 이 프로세스 메모리에만 둔다(폰에 저장하지 않음, 결정 W-D2).
 * APP-이번주위젯 S68-12: 늘 이번 주부터. 4×2 머리 줄 ‹ ›로 앞뒤 주(±WidgetWeek.MAX_SHIFT), 옮긴 주에서 머리 글자를 누르면 이번 주로.
 * 옮긴 주·고른 날은 위젯마다(appWidgetId) 메모리에만, 날이 바뀌면 이번 주·주간 요약으로 돌아간다. 4×1은 칸이 좁아 이번 주 고정.
 */
class WeekWidget : AppWidgetProvider() {
    sealed class State {
        object Loading : State()
        object SignedOut : State()
        object Failed : State()
        /** contents: 받은 주 내용(그 주 월요일이 열쇠). asked: 이번 갱신에서 읽으려 한 주(받지 못한 주는 '불러오지 못했어요'). */
        data class Shown(val contents: Map<LocalDate, WidgetWeek.Content>, val asked: Set<LocalDate> = contents.keys) : State()
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val signedIn = WidgetGuard.get { WidgetHub.session(context).signedIn() } == true
        show(context, if (!signedIn) State.SignedOut else cached() ?: State.Loading, manager, ids)
        if (signedIn) {
            WidgetJobs.schedule(context)
            WidgetJobs.refreshNow(context)
        }
    }

    override fun onEnabled(context: Context) {
        if (WidgetHub.session(context).signedIn()) WidgetJobs.schedule(context)
    }

    override fun onDisabled(context: Context) {
        if (!HomeWidgets.anyRefreshed(context)) WidgetJobs.cancel(context)
        last = emptyMap()
        seen.clear()
    }

    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        appWidgetIds.forEach { seen.remove(it) }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            if (WidgetHub.session(context).signedIn()) {
                show(context, cached() ?: State.Loading)
                WidgetJobs.refreshNow(context)
            } else {
                show(context, State.SignedOut)
            }
            return
        }
        if (intent.action == ACTION_PICK) {
            pick(context, widgetId(intent), WidgetWeek.parseDay(intent.getStringExtra(EXTRA_DAY)))
            return
        }
        if (intent.action == ACTION_SHIFT) {
            shift(context, widgetId(intent), intent.getIntExtra(EXTRA_DELTA, 0))
            return
        }
        super.onReceive(context, intent)
    }

    companion object {
        const val ACTION_REFRESH = "kr.or.kptu.work.widget.WEEK_REFRESH"
        /** 4×2 요일 칸 누름: 이 위젯 안에서 그 날 내용을 펼치거나 접는다(앱을 열지 않음). */
        const val ACTION_PICK = "kr.or.kptu.work.widget.WEEK_PICK"
        /** S68-12: 4×2 머리 줄 ‹(−1)·›(+1), 옮긴 주의 머리 글자(0 = 이번 주로). 앱을 열지 않음. */
        const val ACTION_SHIFT = "kr.or.kptu.work.widget.WEEK_SHIFT"
        private const val EXTRA_DELTA = "delta"
        /** 줄을 누르면 MainActivity가 받는 동작. 날짜는 EXTRA_DAY(yyyy-mm-dd, WidgetWeek.parseDay로만 읽음). */
        const val ACTION_DAY = "kr.or.kptu.work.action.WIDGET_DAY"
        const val EXTRA_DAY = "day"
        private val SMALL = SizeF(250f, 40f)
        private val LARGE = SizeF(250f, 110f)
        private val CELLS = intArrayOf(R.id.week_d0, R.id.week_d1, R.id.week_d2, R.id.week_d3, R.id.week_d4, R.id.week_d5, R.id.week_d6)
        private val WEEK = intArrayOf(R.id.week_w0, R.id.week_w1, R.id.week_w2, R.id.week_w3, R.id.week_w4, R.id.week_w5, R.id.week_w6)
        private val DATE = intArrayOf(R.id.week_n0, R.id.week_n1, R.id.week_n2, R.id.week_n3, R.id.week_n4, R.id.week_n5, R.id.week_n6)
        private val COUNT = intArrayOf(R.id.week_c0, R.id.week_c1, R.id.week_c2, R.id.week_c3, R.id.week_c4, R.id.week_c5, R.id.week_c6)
        /** APP-위젯먹색 S68-06: 4×2 요일 칸 첫 일정 줄(4×1 화면 틀에는 없다). */
        private val FIRST = intArrayOf(R.id.week_f0, R.id.week_f1, R.id.week_f2, R.id.week_f3, R.id.week_f4, R.id.week_f5, R.id.week_f6)

        private val ITEMS = intArrayOf(R.id.week_sel_i0, R.id.week_sel_i1, R.id.week_sel_i2)

        /** 마지막에 받은 주 내용(그 주 월요일이 열쇠). 메모리에만. */
        @Volatile private var last: Map<LocalDate, WidgetWeek.Content> = emptyMap()

        /** 위젯 하나가 지금 보는 것: 옮긴 주와 옮긴 날짜, 고른 날과 고른 날짜(서울). 메모리에만. */
        private data class Seen(val shift: Int = 0, val shiftOn: LocalDate? = null, val picked: LocalDate? = null, val pickedOn: LocalDate? = null)

        private val seen = java.util.concurrent.ConcurrentHashMap<Int, Seen>()
        @Volatile private var drawn: State? = null

        private fun widgetId(intent: Intent): Int = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)

        private fun cached(): State? = last.takeIf { it.isNotEmpty() }?.let { State.Shown(it) }

        /** 이 위젯이 지금 보일 주(날이 바뀌었으면 0). */
        private fun shiftOf(id: Int, now: Long): Int = seen[id]?.let { WidgetWeek.shiftNow(it.shift, it.shiftOn, now) } ?: 0

        /** 갱신 작업이 읽을 주: 이번 주(0) + 위젯들이 지금 옮겨 둔 주. */
        fun shifts(now: Long = System.currentTimeMillis()): Set<Int> = setOf(0) + seen.keys.map { shiftOf(it, now) }

        /** 요일 칸을 눌렀을 때: 내용이 있으면 그 위젯의 고르기를 바꾸고 다시 그린다(서버를 다시 읽지 않음). */
        private fun pick(context: Context, id: Int, day: LocalDate?) {
            if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
            val now = System.currentTimeMillis()
            val content = last[WidgetWeek.start(now, shift = shiftOf(id, now))]
            if (day != null && content != null) {
                val v = seen[id] ?: Seen()
                val current = WidgetWeek.active(v.picked, v.pickedOn, now, content.days)
                seen[id] = v.copy(picked = WidgetWeek.toggle(current, day), pickedOn = WidgetWeek.today(now))
            }
            // 마지막에 그린 상태 그대로(불러오지 못함 한 줄 등은 유지) 다시 그린다.
            show(context, drawn ?: return)
        }

        /** ‹ ›·머리 글자: 그 위젯의 주를 옮기고(0이면 이번 주로) 고른 날은 푼다. 받아 둔 주면 바로, 아니면 '불러오는 중' 뒤 읽기. */
        private fun shift(context: Context, id: Int, delta: Int) {
            if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
            val now = System.currentTimeMillis()
            val next = if (delta == 0) 0 else WidgetWeek.move(shiftOf(id, now), delta)
            seen[id] = Seen(shift = next, shiftOn = WidgetWeek.today(now))
            show(context, drawn ?: State.Loading)
        }

        fun hasWidgets(context: Context): Boolean =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, WeekWidget::class.java)).isNotEmpty()

        /** 갱신 결과(주마다) → 그릴 상태. 로그아웃이면 로그아웃, 받은 주가 하나도 없으면 실패. */
        fun state(weeks: Map<Int, WidgetRefresh.Paint<WidgetWeek.Content>>, nowMs: Long): State {
            if (weeks.values.any { it == WidgetRefresh.Paint.SignedOut }) return State.SignedOut
            val got = weeks.values.mapNotNull { (it as? WidgetRefresh.Paint.Shown)?.content }.associateBy { it.monday }
            if (got.isEmpty()) return State.Failed
            return State.Shown(got, weeks.keys.map { WidgetWeek.start(nowMs, shift = it) }.toSet())
        }

        fun show(context: Context, state: State) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, WeekWidget::class.java))
            if (ids.isNotEmpty()) show(context, state, manager, ids)
        }

        /** 그리다 실패하면(예외·초기화 실패) 빈칸 대신 '불러오지 못했어요' 한 줄만 그린다(FIX-위젯). */
        private fun show(context: Context, state: State, manager: AppWidgetManager, ids: IntArray) {
            if (WidgetGuard.run { draw(context, state, manager, ids) }) return
            WidgetGuard.run {
                val views = RemoteViews(context.packageName, R.layout.week_widget)
                note(views, "불러오지 못했어요 · ↻로 다시")
                views.setOnClickPendingIntent(R.id.week_refresh, refresh(context))
                manager.updateAppWidget(ids, views)
            }
        }

        private fun draw(context: Context, state: State, manager: AppWidgetManager, ids: IntArray) {
            drawn = state
            when (state) {
                is State.Shown -> last = state.contents
                State.SignedOut -> {
                    last = emptyMap()
                    seen.clear()
                }
                else -> Unit
            }
            val now = System.currentTimeMillis()
            var missing = false
            // 위젯마다 보는 주·고른 날이 달라 하나씩 그린다.
            for (id in ids) {
                val rv = HomeWidgets.sized(context, R.layout.week_widget_small, R.layout.week_widget, SMALL, LARGE) { v, small ->
                    if (paint(context, v, state, small, id, now)) missing = true
                }
                manager.updateAppWidget(id, rv)
            }
            // 옮긴 주를 아직 받지 않았으면 한 번 읽는다(이번 갱신에서 읽으려 했다가 못 받은 주는 다시 읽지 않음, ↻로).
            if (missing) WidgetJobs.refreshNow(context)
        }

        /** 돌려주는 값: 이 위젯이 보는 주를 아직 읽지 않았나(읽기 요청이 필요). */
        private fun paint(context: Context, views: RemoteViews, state: State, small: Boolean, id: Int, now: Long): Boolean {
            // 4×1은 ‹ ›가 들어갈 칸이 없어 늘 이번 주(S68-12).
            val shift = if (small) 0 else shiftOf(id, now)
            val monday = WidgetWeek.start(now, shift = shift)
            views.setOnClickPendingIntent(R.id.week_title, if (shift == 0) day(context, null, 0) else shiftIntent(context, id, 0))
            views.setOnClickPendingIntent(R.id.week_refresh, refresh(context))
            arrow(context, views, R.id.week_prev, id, shift, -1)
            arrow(context, views, R.id.week_next, id, shift, 1)
            views.setViewVisibility(R.id.week_note, View.GONE)
            views.setTextViewText(R.id.week_title, WidgetWeek.header(now, shift = shift))
            views.setTextViewText(R.id.week_total, "")
            val shown = when (state) {
                is State.Shown, State.Failed -> last[monday]
                else -> null
            }
            val unread = state is State.Shown && shown == null && monday !in state.asked
            val fallback = WidgetWeek.content(0, null, now, shift = shift)
            val v = seenOf(id)
            val sel = if (small || shown == null) null else WidgetWeek.active(v.picked, v.pickedOn, now, shown.days)
            if (sel == null && !small && v.picked != null) seen[id] = v.copy(picked = null)
            cells(context, views, shown ?: fallback, small, sel, id)
            val detail = sel?.let { shown?.details?.get(it) }
            if (detail != null) {
                lines(context, views, null)
                selected(context, views, detail)
            } else {
                views.setViewVisibility(R.id.week_sel, View.GONE)
                lines(context, views, shown)
            }
            when (state) {
                State.SignedOut -> {
                    views.setViewVisibility(R.id.week_refresh, View.GONE)
                    note(views, HomeWidgets.SIGNED_OUT_LINE)
                    views.setOnClickPendingIntent(R.id.week_note, HomeWidgets.login(context))
                }
                State.Loading -> {
                    views.setViewVisibility(R.id.week_refresh, View.VISIBLE)
                    note(views, "불러오는 중")
                }
                State.Failed -> {
                    views.setViewVisibility(R.id.week_refresh, View.VISIBLE)
                    note(views, "불러오지 못했어요 · ↻로 다시")
                }
                is State.Shown -> {
                    views.setViewVisibility(R.id.week_refresh, View.VISIBLE)
                    when {
                        shown != null -> {
                            views.setTextViewText(R.id.week_title, shown.title)
                            views.setTextViewText(R.id.week_total, "일정 " + shown.total)
                            shown.note?.let { note(views, it) }
                        }
                        unread -> note(views, "불러오는 중")
                        else -> note(views, "불러오지 못했어요 · ↻로 다시")
                    }
                }
            }
            return unread
        }

        private fun seenOf(id: Int): Seen = seen[id] ?: Seen()

        /** 머리 줄 ‹ ›(4×2만). 범위 끝이면 자리만 남기고 숨긴다(머리 글자가 흔들리지 않게). */
        private fun arrow(context: Context, views: RemoteViews, view: Int, id: Int, shift: Int, delta: Int) {
            val can = WidgetWeek.canMove(shift, delta)
            views.setViewVisibility(view, if (can) View.VISIBLE else View.INVISIBLE)
            if (can) views.setOnClickPendingIntent(view, shiftIntent(context, id, delta))
        }

        /**
         * 요일 칸 7개. 칸 숫자가 없으면 '·'. 모든 날 같은 바탕, 고른 날만 옅은 먹색 칸, 오늘은 먹색 바탕 + 밝은 글자(S68-06). 바탕은 모두 누를 때 물결.
         * 4×2는 숫자 아래 그날 첫 일정 제목 앞부분 한 줄(WidgetWeek.firstLine), 4×1은 지금처럼 수만.
         * 4×2는 누르면 위젯 안에서 그 날을 펼치고(ACTION_PICK), 4×1은 아래 칸이 없으니 지금처럼 앱 그 날.
         */
        private fun cells(context: Context, views: RemoteViews, c: WidgetWeek.Content, small: Boolean, sel: LocalDate?, id: Int) {
            val today = LocalDate.now(WidgetNow.ZONE)
            c.days.take(CELLS.size).forEachIndexed { i, d ->
                views.setTextViewText(WEEK[i], if (small) d.week + " " + d.date else d.week)
                views.setTextViewText(DATE[i], d.date.toString())
                views.setTextViewText(COUNT[i], if (d.count > 0) d.count.toString() else "·")
                // 모든 날 같은 건수 색. 고른 날은 옅은 먹색 칸, 오늘은 먹색 바탕 + 밝은 글자(S68-06).
                val kind = WidgetWeek.cell(d, today, sel)
                val onInk = kind == WidgetWeek.Cell.TODAY || kind == WidgetWeek.Cell.TODAY_PICKED
                val ink = context.getColor(R.color.widget_today_ink)
                views.setTextColor(COUNT[i], if (onInk) ink else context.getColor(if (d.count > 0) R.color.widget_todo_ink else R.color.widget_muted))
                views.setTextColor(WEEK[i], if (onInk) ink else context.getColor(R.color.widget_muted))
                views.setTextColor(DATE[i], if (onInk) ink else context.getColor(R.color.widget_ink))
                if (!small) {
                    val first = WidgetWeek.firstLine(d, small)
                    views.setViewVisibility(FIRST[i], if (first == null) View.GONE else View.VISIBLE)
                    views.setTextViewText(FIRST[i], first ?: "")
                    views.setTextColor(FIRST[i], if (onInk) ink else context.getColor(R.color.widget_muted))
                }
                val bg = when (kind) {
                    WidgetWeek.Cell.TODAY -> R.drawable.widget_day_today
                    WidgetWeek.Cell.TODAY_PICKED -> R.drawable.widget_day_today_pick
                    WidgetWeek.Cell.PICKED -> R.drawable.widget_day_pick
                    WidgetWeek.Cell.PLAIN -> R.drawable.widget_day_plain
                }
                views.setInt(CELLS[i], "setBackgroundResource", bg)
                views.setOnClickPendingIntent(CELLS[i], if (small) day(context, d.day, i + 1) else pickIntent(context, id, d.day, i))
            }
        }

        /** 4×2 아래 세 줄(가장 큰 일·보고일·몰린 날). 없으면 그 줄을 숨긴다. 4×1에는 이 칸이 없다(홈 화면이 건너뜀). */
        private fun lines(context: Context, views: RemoteViews, c: WidgetWeek.Content?) {
            pickRow(context, views, R.id.week_big, R.id.week_big_tag, R.id.week_big_text, c?.big, 8)
            pickRow(context, views, R.id.week_rep, R.id.week_rep_tag, R.id.week_rep_text, c?.report, 9)
            pickRow(context, views, R.id.week_busy, R.id.week_busy_tag, R.id.week_busy_text, c?.busy, 10)
        }

        /** 고른 날 아래 칸: 머리 줄 + [열기] + 줄 셋(넘치면 마지막 줄 '외 n'). */
        private fun selected(context: Context, views: RemoteViews, d: WidgetWeek.Detail) {
            views.setViewVisibility(R.id.week_sel, View.VISIBLE)
            views.setTextViewText(R.id.week_sel_title, WidgetWeek.detailHead(d))
            views.setOnClickPendingIntent(R.id.week_sel_open, day(context, d.day, 11))
            val rows = WidgetWeek.detailRows(d, ITEMS.size)
            ITEMS.forEachIndexed { i, id ->
                val text = rows.getOrNull(i)
                views.setViewVisibility(id, if (text == null) View.GONE else View.VISIBLE)
                views.setTextViewText(id, text ?: "")
            }
        }

        private fun pickRow(context: Context, views: RemoteViews, row: Int, tag: Int, text: Int, p: WidgetWeek.Pick?, slot: Int) {
            if (p == null) {
                views.setViewVisibility(row, View.GONE)
                return
            }
            views.setViewVisibility(row, View.VISIBLE)
            views.setTextViewText(tag, p.tag)
            views.setTextViewText(text, p.text)
            views.setOnClickPendingIntent(row, day(context, p.day, slot))
        }

        private fun note(views: RemoteViews, text: String) {
            views.setViewVisibility(R.id.week_note, View.VISIBLE)
            views.setTextViewText(R.id.week_note, text)
        }

        /**
         * 4×2 요일 칸 누름(이 위젯에만 가는 방송). 요청 번호 230~236은 다른 위젯과 겹치지 않는다.
         * S68-12: 위젯마다 다른 누름이 되도록 위젯 번호를 data 주소에 넣는다(요청 번호가 같아도 섞이지 않음, 앱 밖으로 나가지 않는 표시일 뿐).
         */
        private fun pickIntent(context: Context, id: Int, day: LocalDate, i: Int): PendingIntent {
            val intent = Intent(context, WeekWidget::class.java).setAction(ACTION_PICK).setData(Uri.parse("workon-widget://week/$id/pick/$i"))
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra(EXTRA_DAY, day.toString())
            return PendingIntent.getBroadcast(context, 230 + i, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        /** S68-12: 주 옮기기(−1·+1, 0 = 이번 주로). 요청 번호 237~239. */
        private fun shiftIntent(context: Context, id: Int, delta: Int): PendingIntent {
            val intent = Intent(context, WeekWidget::class.java).setAction(ACTION_SHIFT).setData(Uri.parse("workon-widget://week/$id/shift/$delta"))
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra(EXTRA_DELTA, delta)
            return PendingIntent.getBroadcast(context, 238 + delta, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        /** 그 날(없으면 달력 화면만). 요청 번호 200~211은 다른 위젯과 겹치지 않는다(211 = 고른 날 [열기]). */
        private fun day(context: Context, day: LocalDate?, slot: Int): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).setAction(ACTION_DAY).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            day?.let { intent.putExtra(EXTRA_DAY, it.toString()) }
            return PendingIntent.getActivity(context, 200 + slot, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        private fun refresh(context: Context): PendingIntent {
            val intent = Intent(context, WeekWidget::class.java).setAction(ACTION_REFRESH)
            return PendingIntent.getBroadcast(context, 22, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
    }
}
