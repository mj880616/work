package kr.or.kptu.work

import android.app.Activity
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.text.InputType
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * APP-위젯빠른쓰기: 위젯 [업데이트]·[할 일]·[노트] 칸이 바로 여는 앱 자체 작은 입력 창(설계 docs/design/phone-widget-auth.md 13절).
 * 웹2(WebView)를 띄우지 않아 앱이 꺼져 있어도 곧바로 뜨고 자판이 올라온다. [저장]은 위젯 세션으로 서버에 바로 보내고 닫힌다.
 * - 위젯 로그인이 없으면 창을 열지 않고 지금의 웹2 쓰기 창으로 넘긴다. 저장 중 로그인이 풀리면 글을 창에 남기고 [크게 열기]를 안내한다.
 * - 실패하면 글을 창에 남기고 이유 한 줄. 글은 메모리(입력칸)에만 있고 폰에 저장하지 않는다(화면 회전 때만 입력칸 상태로 이어짐).
 * - [크게 열기]: 웹2 쓰기 창(조직·사업 고르기, 긴 글, 첨부). 글은 넘기지 않는다(주소에 글을 싣지 않음).
 * 내보내지 않는다(exported=false): 이 앱 위젯의 PendingIntent로만 열린다.
 */
class QuickWriteActivity : Activity() {
    private val createdAt = SystemClock.elapsedRealtime()
    private var kind: WidgetAction? = null
    private var input: EditText? = null
    private var status: TextView? = null
    private var save: Button? = null
    private var timed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val k = WidgetActions.writeKind(intent?.getStringExtra(WidgetActions.EXTRA_KIND))
        if (k == null) {
            finish()
            return
        }
        kind = k
        if (WidgetGuard.get { WidgetHub.session(applicationContext).signedIn() } != true) {
            openBig(k)
            return
        }
        setContentView(build(k))
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        window.setGravity(Gravity.BOTTOM)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        input?.requestFocus()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && !timed) {
            timed = true
            QuickWriteTiming.ready(kind, createdAt)
        }
    }

    private fun build(k: WidgetAction): View {
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(14), px(10), px(10), px(6))
        }
        root.addView(TextView(this).apply {
            text = k.label
            textSize = 12f
            alpha = 0.7f
        })
        val box = EditText(this).apply {
            id = ID_INPUT
            hint = QuickWriteRules.hint(k)
            textSize = 15f
            minLines = 2
            maxLines = 6
            gravity = Gravity.TOP or Gravity.START
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        }
        input = box
        root.addView(box, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val note = TextView(this).apply {
            textSize = 12f
            visibility = View.GONE
            setPadding(px(2), px(2), 0, 0)
        }
        status = note
        root.addView(note)
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }
        val big = Button(this, null, android.R.attr.borderlessButtonStyle).apply {
            text = "크게 열기"
            textSize = 13f
            minHeight = px(36)
            minimumHeight = px(36)
            setOnClickListener { openBig(k) }
        }
        val ok = Button(this, null, android.R.attr.borderlessButtonStyle).apply {
            text = "저장"
            textSize = 13f
            minHeight = px(36)
            minimumHeight = px(36)
            setOnClickListener { send(k) }
        }
        save = ok
        row.addView(big)
        row.addView(ok)
        root.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        return root
    }

    private fun show(reason: String) {
        status?.apply {
            text = reason
            visibility = View.VISIBLE
        }
    }

    private fun send(k: WidgetAction) {
        val text = input?.text?.toString().orEmpty()
        when (val c = QuickWriteRules.check(k, text)) {
            is QuickWriteRules.Check.Bad -> {
                show(c.reason)
                return
            }
            QuickWriteRules.Check.Ok -> Unit
        }
        save?.isEnabled = false
        show("저장하는 중")
        val app = applicationContext
        val started = SystemClock.elapsedRealtime()
        Thread {
            val r = WidgetGuard.get { WidgetHub.session(app).write(k, text) } ?: WidgetSession.Write.Failed(QuickWriteRules.NETWORK)
            QuickWriteTiming.saved(k, started, r)
            runOnUiThread { done(k, r) }
        }.start()
    }

    private fun done(k: WidgetAction, r: WidgetSession.Write) {
        if (isFinishing || isDestroyed) return
        save?.isEnabled = true
        when (r) {
            WidgetSession.Write.Saved -> {
                Toast.makeText(applicationContext, QuickWriteRules.saved(k), Toast.LENGTH_SHORT).show()
                // 위젯 숫자(챙길 것·할 일)를 바로 새로(배터리: 이미 기다리는 작업이 있으면 그대로).
                WidgetGuard.run { if (HomeWidgets.any(applicationContext)) WidgetJobs.refreshNow(applicationContext) }
                finish()
            }
            WidgetSession.Write.SignedOut -> {
                show(QuickWriteRules.SIGNED_OUT)
                WidgetGuard.run { NowWidget.signedInChanged(applicationContext, false) }
            }
            is WidgetSession.Write.Failed -> show(r.reason)
        }
    }

    private fun openBig(k: WidgetAction) {
        startActivity(WidgetIntents.intent(this, WidgetActions.bigTarget(k)))
        finish()
    }

    companion object {
        /** 입력칸 id(화면이 다시 만들어질 때 쓰던 글을 입력칸 상태로 잇는다. 폰 저장소에는 쓰지 않는다). */
        private const val ID_INPUT = 0x7f0b7001
    }
}

/**
 * 빠른 쓰기 시간 재기(요청함 [10/31 12:23] 1번). 글·토큰·응답은 남기지 않고 종류·밀리초·앱이 막 켜졌는지만 기기 로그(logcat, 태그 QuickWrite)에.
 * ready: 창이 만들어진 때 → 입력칸에 초점(자판이 올라오는 때). sinceStart: 앱 프로세스가 켜진 때부터(앱이 꺼져 있었으면 위젯을 누른 때와 거의 같다).
 */
object QuickWriteTiming {
    private const val TAG = "QuickWrite"

    fun ready(kind: WidgetAction?, createdAt: Long) {
        val now = SystemClock.elapsedRealtime()
        val sinceStart = now - Process.getStartElapsedRealtime()
        Log.i(TAG, "ready kind=" + (kind?.id ?: "-") + " ms=" + (now - createdAt) + " sinceProcessStart=" + sinceStart)
    }

    fun saved(kind: WidgetAction, started: Long, r: WidgetSession.Write) {
        val result = when (r) {
            WidgetSession.Write.Saved -> "saved"
            WidgetSession.Write.SignedOut -> "signed_out"
            is WidgetSession.Write.Failed -> "failed"
        }
        Log.i(TAG, "save kind=" + kind.id + " ms=" + (SystemClock.elapsedRealtime() - started) + " result=" + result)
    }
}
