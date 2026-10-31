package kr.or.kptu.work

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDate

/**
 * 홈 화면 '웹2 이번 주' 위젯(4×2·4×1, APP-위젯다시 ③). '지금' 위젯과 같은 위젯 세션·같은 갱신 작업(WidgetWorker) 하나로 읽는다.
 * 요일 칸·아래 줄을 누르면 앱 달력의 그 날(MainActivity ACTION_DAY → 웹 ?view=calendar&day= 또는 다리 day:open:).
 * 마지막에 그린 내용은 이 프로세스 메모리에만 둔다(폰에 저장하지 않음, 결정 W-D2).
 */
class WeekWidget : AppWidgetProvider() {
    sealed class State {
        object Loading : State()
        object SignedOut : State()
        object Failed : State()
        data class Shown(val content: WidgetWeek.Content) : State()
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val signedIn = WidgetGuard.get { WidgetHub.session(context).signedIn() } == true
        show(context, if (!signedIn) State.SignedOut else last?.let { State.Shown(it) } ?: State.Loading, manager, ids)
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
        last = null
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            if (WidgetHub.session(context).signedIn()) {
                show(context, last?.let { State.Shown(it) } ?: State.Loading)
                WidgetJobs.refreshNow(context)
            } else {
                show(context, State.SignedOut)
            }
            return
        }
        super.onReceive(context, intent)
    }

    companion object {
        const val ACTION_REFRESH = "kr.or.kptu.work.widget.WEEK_REFRESH"
        /** 줄을 누르면 MainActivity가 받는 동작. 날짜는 EXTRA_DAY(yyyy-mm-dd, WidgetWeek.parseDay로만 읽음). */
        const val ACTION_DAY = "kr.or.kptu.work.action.WIDGET_DAY"
        const val EXTRA_DAY = "day"
        private val SMALL = SizeF(250f, 40f)
        private val LARGE = SizeF(250f, 110f)
        private val CELLS = intArrayOf(R.id.week_d0, R.id.week_d1, R.id.week_d2, R.id.week_d3, R.id.week_d4, R.id.week_d5, R.id.week_d6)
        private val WEEK = intArrayOf(R.id.week_w0, R.id.week_w1, R.id.week_w2, R.id.week_w3, R.id.week_w4, R.id.week_w5, R.id.week_w6)
        private val DATE = intArrayOf(R.id.week_n0, R.id.week_n1, R.id.week_n2, R.id.week_n3, R.id.week_n4, R.id.week_n5, R.id.week_n6)
        private val COUNT = intArrayOf(R.id.week_c0, R.id.week_c1, R.id.week_c2, R.id.week_c3, R.id.week_c4, R.id.week_c5, R.id.week_c6)

        @Volatile private var last: WidgetWeek.Content? = null

        fun hasWidgets(context: Context): Boolean =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, WeekWidget::class.java)).isNotEmpty()

        fun state(p: WidgetRefresh.Paint<WidgetWeek.Content>): State = when (p) {
            is WidgetRefresh.Paint.Shown -> State.Shown(p.content)
            WidgetRefresh.Paint.SignedOut -> State.SignedOut
            WidgetRefresh.Paint.Failed -> State.Failed
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
            when (state) {
                is State.Shown -> last = state.content
                State.SignedOut -> last = null
                else -> Unit
            }
            val views = HomeWidgets.sized(context, R.layout.week_widget_small, R.layout.week_widget, SMALL, LARGE) { v, small -> paint(context, v, state, small) }
            manager.updateAppWidget(ids, views)
        }

        private fun paint(context: Context, views: RemoteViews, state: State, small: Boolean) {
            val now = System.currentTimeMillis()
            views.setOnClickPendingIntent(R.id.week_title, day(context, null, 0))
            views.setOnClickPendingIntent(R.id.week_refresh, refresh(context))
            views.setViewVisibility(R.id.week_note, View.GONE)
            views.setTextViewText(R.id.week_title, WidgetWeek.header(now))
            views.setTextViewText(R.id.week_total, "")
            val shown = (state as? State.Shown)?.content ?: if (state == State.Failed) last else null
            val fallback = WidgetWeek.content(0, null, now)
            cells(context, views, shown ?: fallback, small)
            lines(context, views, shown)
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
                    views.setTextViewText(R.id.week_title, state.content.title)
                    views.setTextViewText(R.id.week_total, "일정 " + state.content.total)
                    state.content.note?.let { note(views, it) }
                }
            }
        }

        /** 요일 칸 7개. 칸 숫자가 없으면 '·'. 몰린 날·가장 큰 일 날은 옅은 색 바탕. */
        private fun cells(context: Context, views: RemoteViews, c: WidgetWeek.Content, small: Boolean) {
            c.days.take(CELLS.size).forEachIndexed { i, d ->
                views.setTextViewText(WEEK[i], if (small) d.week + " " + d.date else d.week)
                views.setTextViewText(DATE[i], d.date.toString())
                views.setTextViewText(COUNT[i], if (d.count > 0) d.count.toString() else "·")
                val ink = when {
                    d.count >= WidgetWeek.BUSY -> R.color.widget_req_ink
                    d.count > 0 -> R.color.widget_todo_ink
                    else -> R.color.widget_muted
                }
                views.setTextColor(COUNT[i], context.getColor(ink))
                val bg = when {
                    d.hot -> R.drawable.widget_day_hot
                    d.busy -> R.drawable.widget_day_busy
                    else -> R.drawable.widget_day_plain
                }
                views.setInt(CELLS[i], "setBackgroundResource", bg)
                views.setOnClickPendingIntent(CELLS[i], day(context, d.day, i + 1))
            }
        }

        /** 4×2 아래 세 줄(가장 큰 일·상집 보고일·몰린 날). 없으면 그 줄을 숨긴다. 4×1에는 이 칸이 없다(홈 화면이 건너뜀). */
        private fun lines(context: Context, views: RemoteViews, c: WidgetWeek.Content?) {
            pick(context, views, R.id.week_big, R.id.week_big_tag, R.id.week_big_text, c?.big, 8)
            pick(context, views, R.id.week_rep, R.id.week_rep_tag, R.id.week_rep_text, c?.report, 9)
            pick(context, views, R.id.week_busy, R.id.week_busy_tag, R.id.week_busy_text, c?.busy, 10)
        }

        private fun pick(context: Context, views: RemoteViews, row: Int, tag: Int, text: Int, p: WidgetWeek.Pick?, slot: Int) {
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

        /** 그 날(없으면 달력 화면만). 요청 번호 200~208은 다른 위젯과 겹치지 않는다. */
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
