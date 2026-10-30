package kr.or.kptu.work

import android.app.Activity
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** 앱 프로세스 안에 하나뿐인 위젯 세션(토큰은 메모리·Keystore 금고에만). */
object WidgetHub {
    @Volatile private var session: WidgetSession? = null

    fun session(context: Context): WidgetSession =
        session ?: synchronized(this) {
            session ?: WidgetSession(OkHttpWidgetHttp(), KeystoreVault(context.applicationContext)).also { session = it }
        }
}

/** 위젯 갱신 작업(설계 3절 5, 동시 갱신 막기). 같은 이름 작업은 KEEP, 토큰 갱신은 WidgetSession 잠금 하나. */
object WidgetJobs {
    private const val PERIODIC = "today-widget-periodic"
    private const val NOW = "today-widget-now"

    private fun constraints() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun schedule(context: Context) {
        val req = PeriodicWorkRequest.Builder(TodayWidgetWorker::class.java, 30, TimeUnit.MINUTES).setConstraints(constraints()).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    fun refreshNow(context: Context) {
        val req = OneTimeWorkRequest.Builder(TodayWidgetWorker::class.java).setConstraints(constraints()).build()
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP, req)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        WorkManager.getInstance(context).cancelUniqueWork(NOW)
    }
}

/**
 * 오늘·이번 주 위젯을 같은 갱신 작업 하나로(WIDGET-여러개 ②, 배터리). 위젯 세션 읽기(readList)도 한 번에 묶는다:
 * 오늘 위젯이 있으면 오늘 일정·할 일·처리 전 후보, 이번 주 위젯이 있으면 이번 주 일정.
 */
class TodayWidgetWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        val today = TodayWidget.hasWidgets(ctx)
        val week = WeekWidget.hasWidgets(ctx)
        if (!today && !week) {
            WidgetJobs.cancel(ctx)
            return Result.success()
        }
        val session = WidgetHub.session(ctx)
        if (!session.signedIn()) {
            HomeWidgets.showSignedOut(ctx)
            return Result.success()
        }
        val now = System.currentTimeMillis()
        val (from, to) = WidgetToday.range(now)
        val (weekFrom, weekTo) = WidgetWeek.range(now)
        val urls = ArrayList<String>()
        if (today) urls.addAll(listOf(WidgetRules.calendarUrl(from, to), WidgetRules.TASKS, WidgetRules.CANDIDATES))
        if (week) urls.add(WidgetRules.calendarUrl(weekFrom, weekTo))
        when (val r = session.readList(urls)) {
            is WidgetSession.Outcome.Ok -> {
                val got = r.value
                if (today) {
                    val raw = WidgetSession.Raw(got[0].status, got[0].body, got[1].status, got[1].body, got[2].status, got[2].body)
                    TodayWidget.show(ctx, TodayWidget.State.Shown(WidgetToday.content(raw, now)))
                }
                if (week) {
                    val w = got.last()
                    WeekWidget.show(ctx, WeekWidget.State.Shown(WidgetWeek.content(w.status, w.body, now)))
                }
            }
            is WidgetSession.Outcome.SignedOut -> HomeWidgets.showSignedOut(ctx)
            is WidgetSession.Outcome.Failed -> {
                if (today) TodayWidget.show(ctx, TodayWidget.State.Failed)
                if (week) WeekWidget.show(ctx, WeekWidget.State.Failed)
            }
        }
        return Result.success()
    }
}

/** 위젯 세션을 쓰는 위젯들(오늘·이번 주)을 함께 다루는 곳. 로그인·로그아웃 뒤 앱이 부른다. */
object HomeWidgets {
    fun any(context: Context): Boolean = TodayWidget.hasWidgets(context) || WeekWidget.hasWidgets(context)

    fun showSignedOut(context: Context) {
        TodayWidget.show(context, TodayWidget.State.SignedOut)
        WeekWidget.show(context, WeekWidget.State.SignedOut)
    }

    fun signedInChanged(context: Context, signedIn: Boolean) {
        if (!any(context)) return
        if (signedIn) {
            TodayWidget.show(context, TodayWidget.State.Loading)
            WeekWidget.show(context, WeekWidget.State.Loading)
            WidgetJobs.schedule(context)
            WidgetJobs.refreshNow(context)
        } else {
            WidgetJobs.cancel(context)
            showSignedOut(context)
        }
    }

    /** 위젯 [로그인] 줄(오늘·이번 주 같은 길). */
    fun login(context: Context): PendingIntent {
        val intent = Intent(context, WidgetLoginActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(context, 21, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}

/**
 * 홈 화면 '웹2 오늘' 위젯(설계 6절, D7). 홈 화면 전용, 잠금 화면에는 놓지 않는다(결정 W-D4).
 * 읽기 두 가지(오늘 일정·할 일)만 위젯 세션으로 한다. [바구니]·줄 누르기는 앱을 열 뿐 서버 요청이 없다.
 * 마지막에 그린 내용은 이 프로세스 메모리에만 둔다(폰에 저장하지 않음, 결정 W-D2).
 */
class TodayWidget : AppWidgetProvider() {
    sealed class State {
        object Loading : State()
        object SignedOut : State()
        object Failed : State()
        data class Shown(val content: WidgetToday.Content) : State()
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val session = WidgetHub.session(context)
        show(context, if (!session.signedIn()) State.SignedOut else last?.let { State.Shown(it) } ?: State.Loading, manager, ids)
        if (session.signedIn()) {
            WidgetJobs.schedule(context)
            WidgetJobs.refreshNow(context)
        }
    }

    override fun onEnabled(context: Context) {
        if (WidgetHub.session(context).signedIn()) WidgetJobs.schedule(context)
    }

    override fun onDisabled(context: Context) {
        if (!HomeWidgets.any(context)) WidgetJobs.cancel(context)
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
        const val ACTION_REFRESH = "kr.or.kptu.work.widget.REFRESH"
        private val ROWS = intArrayOf(R.id.widget_row0, R.id.widget_row1, R.id.widget_row2, R.id.widget_row3, R.id.widget_row4, R.id.widget_row5, R.id.widget_row6, R.id.widget_row7)

        @Volatile private var last: WidgetToday.Content? = null

        fun hasWidgets(context: Context): Boolean =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, TodayWidget::class.java)).isNotEmpty()

        /** 로그인·로그아웃 뒤 앱이 부른다(이번 주 위젯도 함께). */
        fun signedInChanged(context: Context, signedIn: Boolean) {
            if (!signedIn) last = null
            HomeWidgets.signedInChanged(context, signedIn)
        }

        fun show(context: Context, state: State) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TodayWidget::class.java))
            if (ids.isNotEmpty()) show(context, state, manager, ids)
        }

        private fun show(context: Context, state: State, manager: AppWidgetManager, ids: IntArray) {
            when (state) {
                is State.Shown -> last = state.content
                State.SignedOut -> last = null
                else -> Unit
            }
            val views = RemoteViews(context.packageName, R.layout.today_widget)
            val now = System.currentTimeMillis()
            views.setOnClickPendingIntent(R.id.widget_title, openApp(context, null, 10))
            views.setOnClickPendingIntent(R.id.widget_basket, openApp(context, "basket", 11))
            views.setOnClickPendingIntent(R.id.widget_refresh, refresh(context))
            ROWS.forEach { views.setViewVisibility(it, View.GONE) }
            views.setViewVisibility(R.id.widget_note, View.GONE)
            views.setViewVisibility(R.id.widget_counts, View.GONE)
            when (state) {
                State.SignedOut -> {
                    views.setTextViewText(R.id.widget_title, WidgetToday.header(now))
                    views.setViewVisibility(R.id.widget_refresh, View.GONE)
                    views.setViewVisibility(ROWS[0], View.VISIBLE)
                    views.setTextViewText(ROWS[0], "위젯 로그인 — 누르면 구글 로그인")
                    views.setOnClickPendingIntent(ROWS[0], HomeWidgets.login(context))
                }
                State.Loading -> {
                    views.setTextViewText(R.id.widget_title, WidgetToday.header(now))
                    views.setViewVisibility(R.id.widget_refresh, View.VISIBLE)
                    note(views, "불러오는 중")
                }
                State.Failed -> {
                    val shown = last
                    views.setViewVisibility(R.id.widget_refresh, View.VISIBLE)
                    if (shown != null) {
                        rows(context, views, shown)
                        counts(context, views, shown)
                    } else {
                        views.setTextViewText(R.id.widget_title, WidgetToday.header(now))
                    }
                    note(views, "불러오지 못했어요 · ↻로 다시")
                }
                is State.Shown -> {
                    views.setViewVisibility(R.id.widget_refresh, View.VISIBLE)
                    rows(context, views, state.content)
                    counts(context, views, state.content)
                    state.content.note?.let { note(views, it) }
                }
            }
            manager.updateAppWidget(ids, views)
        }

        private fun note(views: RemoteViews, text: String) {
            views.setViewVisibility(R.id.widget_note, View.VISIBLE)
            views.setTextViewText(R.id.widget_note, text)
        }

        /** 맨 아래 '챙길 것 n · 나한테 온 요청 n'(건수만). 누르면 정리함. */
        private fun counts(context: Context, views: RemoteViews, content: WidgetToday.Content) {
            val line = content.counts ?: return
            views.setViewVisibility(R.id.widget_counts, View.VISIBLE)
            views.setTextViewText(R.id.widget_counts, line)
            views.setOnClickPendingIntent(R.id.widget_counts, openApp(context, "basket", 14))
        }

        private fun rows(context: Context, views: RemoteViews, content: WidgetToday.Content) {
            views.setTextViewText(R.id.widget_title, content.title)
            content.rows.take(ROWS.size).forEachIndexed { i, row ->
                val id = ROWS[i]
                views.setViewVisibility(id, View.VISIBLE)
                views.setTextViewText(id, if (row.time.isEmpty()) row.title else row.time + "  " + row.title)
                val view = if (row.target == WidgetToday.Target.CALENDAR) "calendar" else "tasks"
                views.setOnClickPendingIntent(id, openApp(context, view, if (view == "calendar") 12 else 13))
            }
        }

        private fun openApp(context: Context, view: String?, code: Int): PendingIntent {
            val url = if (view == null) ShellRules.HOME else ShellRules.HOME + "?view=" + view
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url), context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        private fun refresh(context: Context): PendingIntent {
            val intent = Intent(context, TodayWidget::class.java).setAction(ACTION_REFRESH)
            return PendingIntent.getBroadcast(context, 20, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
    }
}

/**
 * 위젯 [로그인] 줄이 여는 내보내지 않은(exported=false) 화면. 이 앱 안에서만 열 수 있다.
 * 메모리에 '위젯용 로그인' 표시(10분·한 번)를 세우고 웹2 화면을 위젯 로그인 동작으로 연다. 화면은 그리지 않고 바로 닫는다.
 */
class WidgetLoginActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WidgetHub.session(this).beginLogin()
        startActivity(Intent(this, MainActivity::class.java).setAction(WidgetRules.ACTION_WIDGET_LOGIN))
        finish()
    }
}
