package kr.or.kptu.work

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * WIDGET-여러개 ③: 홈 화면 '아스날' 위젯(2×1). 다음 경기(자료가 있으면)·지난 경기 결과 두 줄. 누르면 앱 아스날 화면.
 * 자료는 공개 정적 파일(WidgetRules.ARSENAL)이라 로그인 없이 읽고 토큰을 붙이지 않는다. 같은 갱신 작업 안에서 6시간에 한 번만 받는다.
 * 받은 자료는 이 프로세스 메모리에만 둔다(폰에 저장하지 않음).
 */
class ArsenalWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        draw(context, manager, ids)
        WidgetJobs.schedule(context)
        if (matches == null) WidgetJobs.refreshNow(context)
    }

    override fun onEnabled(context: Context) {
        WidgetJobs.schedule(context)
    }

    override fun onDisabled(context: Context) {
        if (!HomeWidgets.anyRefreshed(context)) WidgetJobs.cancel(context)
        matches = null
        fetchedAt = 0L
    }

    companion object {
        const val EVERY_MS = 6 * 60 * 60 * 1000L

        @Volatile private var matches: List<WidgetArsenal.Match>? = null
        @Volatile private var fetchedAt = 0L
        @Volatile private var failed = false

        fun hasWidgets(context: Context): Boolean =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, ArsenalWidget::class.java)).isNotEmpty()

        /** 같은 갱신 작업이 부른다. 6시간 안에 받은 자료가 있으면 받지 않고 다시 그리기만(날짜가 바뀌면 다음 경기가 바뀐다). */
        fun refresh(context: Context, session: WidgetSession, nowMs: Long) {
            if (matches == null || nowMs - fetchedAt >= EVERY_MS) {
                val r = session.readPublic(WidgetRules.ARSENAL)
                val parsed = if (r is WidgetSession.Outcome.Ok && r.value.status == 200) WidgetArsenal.parse(r.value.body as? String) else null
                if (parsed != null) {
                    matches = parsed
                    fetchedAt = nowMs
                    failed = false
                } else {
                    failed = matches == null
                }
            }
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, ArsenalWidget::class.java))
            if (ids.isNotEmpty()) draw(context, manager, ids)
        }

        private fun draw(context: Context, manager: AppWidgetManager, ids: IntArray) {
            val views = RemoteViews(context.packageName, R.layout.arsenal_widget)
            val today = WidgetTelegram.today(System.currentTimeMillis())
            val list = matches
            val c = when {
                list != null -> WidgetArsenal.content(list, today)
                failed -> WidgetArsenal.content(null, today)
                else -> WidgetArsenal.Content("아스날", "불러오는 중")
            }
            views.setTextViewText(R.id.ars_top, c.top)
            views.setTextViewText(R.id.ars_bottom, c.bottom)
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(ShellRules.HOME + "?view=arsenal"), context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            views.setOnClickPendingIntent(R.id.ars_root, PendingIntent.getActivity(context, 320, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            manager.updateAppWidget(ids, views)
        }
    }
}
