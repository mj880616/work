package kr.or.kptu.work

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * 폰 [녹음] 앞쪽 서비스(foregroundServiceType=microphone). 화면이 꺼지거나 다른 앱을 써도 녹음을 이어 간다.
 * - MediaRecorder가 OGG/Opus 32kbps로 구간 파일 하나(앱 전용 공간)에 계속 쓴다. 1분마다 새로 쓰인 바이트를 조각으로 자른다(RecordRules.cut).
 * - 구간 길이(서버 기준 59분, 옛 서버면 15분)를 넘으면 녹음기를 새로 열어 다음 구간 파일로 넘어간다.
 * - 알림줄: '녹음 중 12:34'(시계는 알림이 센다) + [일시정지]/[이어 녹음] + [멈추고 정리].
 * - 조각 올리기는 웹 화면이 한다(웹2 로그인 세션). 이 서비스는 네트워크를 쓰지 않는다. 소리·토큰을 로그에 쓰지 않는다.
 */
class RecorderService : Service() {
    private var recorder: MediaRecorder? = null
    /** 지금 구간에서 runSince 전까지 녹음한 시간. */
    private var segBefore = 0L
    /** 녹음이 돌기 시작한 시각(elapsedRealtime), 일시정지면 0. */
    private var runSince = 0L
    private val ui = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            onTick()
            if (recorder != null) ui.postDelayed(this, TICK_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        RecordHub.init(this)
        when (intent?.action) {
            ACTION_START -> start()
            ACTION_TOGGLE -> if (runSince > 0L) pause() else resume()
            ACTION_PAUSE -> pause()
            ACTION_RESUME -> resume()
            ACTION_ROLL -> roll()
            ACTION_STOP -> stop(auto = intent.getBooleanExtra(EXTRA_AUTO, false), discard = intent.getBooleanExtra(EXTRA_DISCARD, false))
            else -> if (recorder == null) stopSelf()
        }
        // 시스템이 서비스를 죽였다가 다시 만들어도 녹음을 저절로 다시 켜지 않는다(남은 것은 '이어서 정리').
        return START_NOT_STICKY
    }

    private fun start() {
        val s = RecordHub.session()
        // startForegroundService로 불렸으므로 어떤 경우든 먼저 앞쪽 서비스로 올린다(안 하면 앱이 죽는다).
        goForeground(s)
        if (recorder != null) return
        val seg = s?.current
        if (s == null || seg == null || s.state != RecordRules.State.RECORDING || !open(seg)) {
            RecordHub.failStart()
            quit()
            return
        }
        RecordHub.pushState()
        ui.removeCallbacks(tick)
        ui.postDelayed(tick, TICK_MS)
    }

    private fun open(seg: RecordRules.Segment): Boolean {
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()
        return try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.OGG)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.OPUS)
            r.setAudioChannels(1)
            r.setAudioSamplingRate(48_000)
            r.setAudioEncodingBitRate(RecordRules.AUDIO_BITS)
            r.setOutputFile(RecordHub.store().file(seg.file))
            r.prepare()
            r.start()
            recorder = r
            segBefore = 0L
            runSince = SystemClock.elapsedRealtime()
            true
        } catch (_: Exception) {
            // 마이크를 다른 앱이 쓰는 중 등. 원인 글은 남기지 않는다.
            try {
                r.release()
            } catch (_: Exception) {
            }
            false
        }
    }

    private fun segMs(): Long = segBefore + if (runSince > 0L) SystemClock.elapsedRealtime() - runSince else 0L

    private fun onTick() {
        val s = RecordHub.session() ?: return
        val seg = s.current ?: return
        if (recorder == null || runSince == 0L) return
        val ms = segMs()
        when {
            RecordRules.shouldRoll(ms, s.segmentLimit) -> roll()
            RecordRules.shouldCut(seg, ms) -> {
                val len = RecordHub.store().length(seg)
                RecordHub.update { cur -> cur.copy(segments = cur.segments.dropLast(1) + RecordRules.cut(cur.current!!, len, ms)) }
            }
            else -> RecordHub.touch(ms)
        }
    }

    private fun pause() {
        val r = recorder ?: return
        if (runSince == 0L) return
        try {
            r.pause()
        } catch (_: Exception) {
            return
        }
        segBefore = segMs()
        runSince = 0L
        val ms = segBefore
        RecordHub.update { s -> s.copy(state = RecordRules.State.PAUSED, segments = s.segments.dropLast(1) + s.current!!.copy(recordedMs = ms)) }
        notifyNow()
    }

    private fun resume() {
        val r = recorder ?: return
        if (runSince > 0L) return
        try {
            r.resume()
        } catch (_: Exception) {
            return
        }
        runSince = SystemClock.elapsedRealtime()
        RecordHub.update { s -> s.copy(state = RecordRules.State.RECORDING) }
        notifyNow()
    }

    /** 다음 구간으로: 지금 녹음기를 닫아 마지막 조각을 자르고, 새 파일로 새 녹음기를 연다(웹이 rec_start로 서버 구간을 연다). */
    private fun roll() {
        if (recorder == null) return
        val wasPaused = runSince == 0L
        val ms = segMs()
        close()
        val s = RecordHub.session() ?: return quit()
        val old = s.current ?: return quit()
        val len = RecordHub.store().length(old)
        val next = RecordRules.Segment(no = old.no + 1, id = null, file = RecordRules.segmentFile(s.sessionId, old.no + 1))
        RecordHub.store().file(next.file).delete()
        RecordHub.update { cur ->
            cur.copy(
                state = RecordRules.State.RECORDING,
                baseMs = cur.baseMs + ms,
                segments = cur.segments.dropLast(1) + RecordRules.end(cur.current!!, len, ms) + next,
            )
        }
        if (!open(next)) {
            // 새 녹음기를 못 열면 여기까지를 정리할 수 있게 멈춘다.
            RecordHub.update { cur -> cur.copy(state = RecordRules.State.STOPPED, segments = cur.segments.dropLast(1) + cur.current!!.copy(ended = true)) }
            quit()
            return
        }
        if (wasPaused) pause()
        notifyNow()
    }

    private fun stop(auto: Boolean, discard: Boolean) {
        if (recorder == null) {
            if (RecordHub.session()?.let { it.state == RecordRules.State.RECORDING || it.state == RecordRules.State.PAUSED } == true) {
                RecordHub.update { s -> RecordRules.recover(s) { RecordHub.store().length(it) }.copy(state = RecordRules.State.STOPPED, autoFinish = auto, discard = discard) }
            }
            quit()
            return
        }
        val ms = segMs()
        close()
        val s = RecordHub.session()
        if (s?.current != null) {
            val len = RecordHub.store().length(s.current!!)
            RecordHub.update { cur ->
                cur.copy(
                    state = RecordRules.State.STOPPED, autoFinish = auto && !discard, discard = discard,
                    segments = cur.segments.dropLast(1) + RecordRules.end(cur.current!!, len, ms),
                )
            }
        }
        quit()
    }

    private fun close() {
        ui.removeCallbacks(tick)
        val r = recorder ?: return
        recorder = null
        runSince = 0L
        try {
            r.stop()
        } catch (_: Exception) {
            // 너무 짧아 쓸 소리가 없을 때 등. 파일에 있는 만큼만 조각으로 남는다.
        }
        try {
            r.release()
        } catch (_: Exception) {
        }
    }

    private fun quit() {
        ui.removeCallbacks(tick)
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        // 멈춤 없이 서비스가 끝나면(시스템 정리 등) 여기까지를 '이어서 정리'로 남긴다.
        if (recorder != null) {
            val ms = segMs()
            close()
            RecordHub.session()?.current?.let { seg ->
                val len = RecordHub.store().length(seg)
                RecordHub.update { cur -> cur.copy(state = RecordRules.State.INTERRUPTED, segments = cur.segments.dropLast(1) + RecordRules.end(cur.current!!, len, ms)) }
            }
        }
        ui.removeCallbacks(tick)
        super.onDestroy()
    }

    // ---- 알림줄 ----
    private fun goForeground(s: RecordRules.Session?) {
        ServiceCompat.startForeground(this, NOTE_ID, build(s), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    }

    private fun notifyNow() {
        val s = RecordHub.session() ?: return
        if (recorder == null) return
        getSystemService(NotificationManager::class.java)?.notify(NOTE_ID, build(s))
    }

    private fun build(s: RecordRules.Session?): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm?.getNotificationChannel(CHANNEL) == null) {
            nm?.createNotificationChannel(NotificationChannel(CHANNEL, "녹음", NotificationManager.IMPORTANCE_LOW).apply {
                description = "녹음 중 알림"
                setShowBadge(false)
            })
        }
        val paused = s?.state == RecordRules.State.PAUSED
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).setAction(RecordHub.ACTION_OPEN), flags)
        val toggle = PendingIntent.getService(this, 1, intent(this, ACTION_TOGGLE), flags)
        val stop = PendingIntent.getActivity(this, 2, Intent(this, RecordActionActivity::class.java).setAction(RecordHub.ACTION_STOP), flags)
        val elapsed = s?.elapsedMs() ?: 0L
        val b = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_rec)
            .setContentTitle(if (paused) "녹음 일시정지" else "녹음 중")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(open)
            .addAction(0, if (paused) "이어 녹음" else "일시정지", toggle)
            .addAction(0, "멈추고 정리", stop)
        if (paused) {
            b.setShowWhen(false).setContentText(clock(elapsed))
        } else {
            b.setShowWhen(true).setUsesChronometer(true).setWhen(System.currentTimeMillis() - elapsed)
        }
        return b.build()
    }

    companion object {
        const val ACTION_START = "kr.or.kptu.work.rec.START"
        const val ACTION_TOGGLE = "kr.or.kptu.work.rec.TOGGLE"
        const val ACTION_PAUSE = "kr.or.kptu.work.rec.PAUSE"
        const val ACTION_RESUME = "kr.or.kptu.work.rec.RESUME"
        const val ACTION_ROLL = "kr.or.kptu.work.rec.ROLL"
        const val ACTION_STOP = "kr.or.kptu.work.rec.STOP"
        const val EXTRA_AUTO = "auto"
        const val EXTRA_DISCARD = "discard"
        private const val CHANNEL = "recording"
        private const val NOTE_ID = 4401
        private const val TICK_MS = 1_000L

        fun intent(context: Context, action: String): Intent = Intent(context, RecorderService::class.java).setAction(action)

        fun clock(ms: Long): String {
            val s = (ms / 1000).coerceAtLeast(0)
            val h = s / 3600
            val m = s % 3600 / 60
            val r = s % 60
            return if (h > 0) "%d:%02d:%02d".format(h, m, r) else "%02d:%02d".format(m, r)
        }
    }
}
