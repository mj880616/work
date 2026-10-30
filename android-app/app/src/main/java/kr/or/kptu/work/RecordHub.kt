package kr.or.kptu.work

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.util.Base64
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.security.SecureRandom

/**
 * 폰 녹음의 한 곳 상태(프로세스 하나에 하나). 녹음기(RecorderService)·웹 다리(MainActivity)·조각 가로채기(__rec)가 함께 본다.
 * 상태가 바뀌면 상태 파일(RecordStore)에 바로 쓰고, 다 올린 구간 파일은 지운다. 바뀐 상태는 웹 화면에 'rec:state:'로 알린다.
 * 소리·토큰은 로그에 쓰지 않는다.
 */
object RecordHub {
    const val ACTION_OPEN = "kr.or.kptu.work.action.REC_OPEN"
    /** 녹음 시작 인텐트(홈 위젯 [녹음] 칸이 쓸 자리, 위젯 여러 개 작업과 줄 세우기). RecordActionActivity(내보내지 않음)만 받는다. */
    const val ACTION_START = "kr.or.kptu.work.action.REC_START"
    /** 알림줄 [멈추고 정리]. */
    const val ACTION_STOP = "kr.or.kptu.work.action.REC_STOP"
    private const val WANT_START_MS = 120_000L

    private var store: RecordStore? = null
    private var session: RecordRules.Session? = null
    private var wantStartAt = 0L
    private val issued = HashMap<String, Pair<Int, Int>>()
    private val random = SecureRandom()

    /** 웹 화면에 알리기(UI 스레드에서 부른다). MainActivity가 붙이고 뗀다. */
    @Volatile var listener: ((String) -> Unit)? = null

    /** 녹음 상태가 바뀌거나 녹음을 지운 뒤 부른다(앱 업데이트가 녹음 끝을 기다릴 때, AppUpdater.poke). */
    @Volatile var changed: (() -> Unit)? = null

    @Synchronized
    fun init(context: Context) {
        if (store != null) return
        val s = RecordStore(File(context.applicationContext.noBackupFilesDir, "rec"))
        store = s
        // 새 프로세스에는 녹음기가 없다: 읽은 녹음은 '끝나지 않은 녹음'으로 돌린다(남은 바이트를 마지막 조각으로).
        val loaded = try {
            s.load()
        } catch (_: Exception) {
            null
        }
        session = loaded?.let { RecordRules.recover(it) { seg -> s.length(seg) } }
        if (loaded == null) s.clear() else s.save(session)
        s.sweep(session)
    }

    fun store(): RecordStore = store ?: error("RecordHub.init 먼저")

    @Synchronized fun session(): RecordRules.Session? = session

    @Synchronized
    fun active(): Boolean = session?.state.let { it == RecordRules.State.RECORDING || it == RecordRules.State.PAUSED }

    /** 웹이 rec_start를 마친 뒤 새 녹음을 연다. 앞 녹음이 남아 있으면(정리·버리기 전) 열지 않는다. */
    @Synchronized
    fun begin(m: RecordRules.Message.Begin): Boolean {
        if (session != null) return false
        val seg = RecordRules.Segment(no = m.segmentNo, id = m.recordingId, file = RecordRules.segmentFile(m.sessionId, m.segmentNo))
        session = RecordRules.Session(m.sessionId, m.workspaceId, m.startedAt, RecordRules.State.RECORDING, m.limitSeconds, listOf(seg))
        store().file(seg.file).delete()
        store().save(session)
        return true
    }

    /** 상태를 바꾸고 저장·정리한 뒤 웹에 알린다. */
    fun update(push: Boolean = true, change: (RecordRules.Session) -> RecordRules.Session) {
        synchronized(this) {
            val s = session ?: return
            session = change(s)
            store().save(session)
            store().sweep(session)
        }
        if (push) pushState()
        changed?.invoke()
    }

    /** 저장하지 않는 시계 갱신(1초마다). 저장은 조각을 자를 때 한다. */
    @Synchronized
    fun touch(recordedMs: Long) {
        val s = session ?: return
        val cur = s.current ?: return
        session = s.copy(segments = s.segments.dropLast(1) + cur.copy(recordedMs = maxOf(cur.recordedMs, recordedMs)))
    }

    fun clear() {
        synchronized(this) {
            session = null
            issued.clear()
            store().clear()
        }
        pushState()
        changed?.invoke()
    }

    /** 녹음기를 열지 못함: 녹음을 지우고 웹에 알린다(서버 구간은 조각 없이 남고 다음 rec_start가 닫는다). */
    fun failStart() {
        synchronized(this) {
            session = null
            issued.clear()
            store().clear()
        }
        listener?.invoke("rec:error:start")
        pushState()
    }

    @Synchronized
    fun wantStart(on: Boolean) {
        wantStartAt = if (on) SystemClock.elapsedRealtime() else 0L
    }

    @Synchronized
    private fun wantsStart(): Boolean = wantStartAt > 0L && SystemClock.elapsedRealtime() - wantStartAt < WANT_START_MS

    fun stateMessage(): String = synchronized(this) { "rec:state:" + RecordRules.stateJson(session, wantsStart()) }

    fun pushState() {
        listener?.invoke(stateMessage())
    }

    /** 다음 할 일. 조각이면 한 번 쓰는 번호를 붙인다(웹이 __rec/<번호>로 받음). */
    @Synchronized
    fun next(): String {
        val s = session
        val step = s?.let { RecordRules.nextStep(it.segments) }
        var token: String? = null
        issued.clear()
        if (s != null && step is RecordRules.Step.Send) {
            token = newToken()
            issued[token] = s.segments[step.index].no to step.piece.seq
        }
        return "rec:next:" + RecordRules.nextJson(s, token)
    }

    /** 실패를 받아 기다릴 시간을 돌려준다. */
    fun failed(m: RecordRules.Message.Failed): Long {
        var wait = 0L
        update(push = false) { s ->
            val first = s.segments.firstOrNull { it.no == m.no }?.pieces?.firstOrNull()
            if (first != null && first.seq != m.seq) return@update s
            val n = RecordRules.failed(s, m.no, m.outcome)
            if (m.outcome == RecordRules.Outcome.RETRY) wait = RecordRules.retryDelay(n.fails)
            n
        }
        return wait
    }

    /** WebView 요청 가로채기. __rec 주소가 아니면 null. 발급한 번호의 지금 첫 조각만 준다. 서버로 나가지 않는다. */
    fun serve(url: String?, method: String?): WebResourceResponse? {
        val token = RecordRules.pieceRequest(url) ?: return null
        val bytes = synchronized(this) {
            val (no, seq) = issued[token] ?: return notFound()
            if (!"GET".equals(method, ignoreCase = true)) return notFound()
            val seg = session?.segments?.firstOrNull { it.no == no } ?: return notFound()
            val piece = seg.pieces.firstOrNull()?.takeIf { it.seq == seq } ?: return notFound()
            try {
                store().read(seg, piece)
            } catch (_: Exception) {
                null
            }
        } ?: return notFound()
        val headers = mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff")
        return WebResourceResponse(RecordRules.MIME, null, 200, "OK", headers, ByteArrayInputStream(bytes))
    }

    private fun notFound(): WebResourceResponse =
        WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))

    private fun newToken(): String {
        val bytes = ByteArray(18)
        random.nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }
}

/**
 * 알림줄 [멈추고 정리]·녹음 시작 인텐트를 받는 화면(내보내지 않아 다른 앱은 열 수 없다). 그리지 않고 웹2 화면을 앞으로 부른 뒤 닫는다.
 * 알림 동작은 화면을 바로 여는 것이어야 한다(안드로이드 12+ 알림 trampoline 제한) — 이 화면이 녹음기에 멈춤을 보내고 웹2를 연다.
 */
class RecordActionActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        RecordHub.init(this)
        when (intent?.action) {
            RecordHub.ACTION_STOP -> if (RecordHub.active()) startService(RecorderService.intent(this, RecorderService.ACTION_STOP).putExtra(RecorderService.EXTRA_AUTO, true))
            RecordHub.ACTION_START -> if (!RecordHub.active()) RecordHub.wantStart(true)
        }
        startActivity(Intent(this, MainActivity::class.java).setAction(RecordHub.ACTION_OPEN).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }
}
