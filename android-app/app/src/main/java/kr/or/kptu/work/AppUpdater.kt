package kr.or.kptu.work

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * 앱 스스로 업데이트(APP-스스로업데이트, 명진 결정 A안). 판단은 UpdateRules(시험으로 고정), 여기서는 받기·확인·설치만 한다.
 * 1. 새 판을 찾으면 공개 릴리스 APK를 앱 전용 공간(noBackupFilesDir/update)에 받는다. 넘김 대상도 허용 목록만, 크기·sha256 확인.
 * 2. 받은 APK의 앱 ID·버전·서명(지금 앱과 같은 인증서)을 PackageManager로 확인한다.
 * 3. 녹음·조각 올리기가 없고 '이 앱에서 설치 허용'이 켜져 있으면 PackageInstaller 세션으로 설치한다.
 *    화면을 쓰는 중에는 [지금 업데이트]를 누르거나 앱이 뒤에 10분 머문 뒤(WorkManager) 설치한다.
 * 4. 안드로이드 12+는 확인 없이 업데이트를 청하고, 시스템이 확인을 원하면 알림 [업데이트] 한 번.
 * 어디서든 어긋나면 FAILED → 예전처럼 [받기](브라우저). 토큰·로그인은 쓰지 않는다.
 */
object AppUpdater {
    const val ACTION_STATUS = "kr.or.kptu.work.update.STATUS"
    private const val CHANNEL = "app_update"
    private const val NOTE_ID = 4501
    private const val WORK = "app-update-install"
    private const val DIR = "update"

    @Volatile var phase: UpdateRules.Phase = UpdateRules.Phase.IDLE
        private set
    @Volatile var release: UpdateRules.Release? = null
        private set
    /** 화면이 보이는 중(onStart~onStop). */
    @Volatile var foreground = false
    @Volatile private var userAsked = false
    @Volatile private var confirm: Intent? = null
    /** 상태가 바뀌면 부른다(MainActivity가 위쪽 줄을 다시 그림). 아무 스레드에서나 불린다. */
    @Volatile var listener: (() -> Unit)? = null

    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(10, TimeUnit.MINUTES)
            .build()
    }

    // ── 시작: 새 판 찾음 ──

    fun found(context: Context, r: UpdateRules.Release) {
        val app = context.applicationContext
        synchronized(this) {
            if (release?.version == r.version && phase != UpdateRules.Phase.IDLE) return
            release = r
            userAsked = false
            confirm = null
        }
        set(app, UpdateRules.Phase.FOUND)
        worker.execute { download(app, r) }
    }

    private fun download(app: Context, r: UpdateRules.Release) {
        try {
            val dir = File(app.noBackupFilesDir, DIR).apply { mkdirs() }
            val target = File(dir, UpdateRules.apkFileName(r.version))
            dir.listFiles()?.forEach { if (it.name != target.name) it.delete() }
            if (!(target.isFile && UpdateRules.fileOk(r, target.length(), sha256(target)))) {
                target.delete()
                set(app, UpdateRules.Phase.DOWNLOADING)
                fetch(r, target)
            }
            if (!verify(app, target, r.version)) {
                target.delete()
                throw IOException("verify")
            }
            set(app, UpdateRules.Phase.READY)
            tryInstall(app)
        } catch (_: Exception) {
            fail(app)
        }
    }

    /** 허용 주소만 따라가며 받는다. 넘김은 손으로 하나씩 확인(OkHttp 자동 넘김 끔). */
    private fun fetch(r: UpdateRules.Release, target: File) {
        if (!UpdateRules.firstHopOk(r)) throw IOException("url")
        val part = File(target.parentFile, target.name + ".part")
        part.delete()
        var url = r.url
        var hops = 0
        while (true) {
            val req = Request.Builder().url(url).header("User-Agent", "KPTUAndroid/${BuildConfig.VERSION_NAME}").get().build()
            http.newCall(req).execute().use { res ->
                if (res.code in 300..399) {
                    if (++hops > UpdateRules.MAX_REDIRECTS) throw IOException("hops")
                    url = UpdateRules.nextHop(url, res.header("Location"), r) ?: throw IOException("redirect")
                    return@use
                }
                if (res.code != 200) throw IOException("http")
                val body = res.body ?: throw IOException("body")
                if (!UpdateRules.lengthOk(r, body.contentLength())) throw IOException("length")
                val md = MessageDigest.getInstance("SHA-256")
                var received = 0L
                body.byteStream().use { input ->
                    part.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            received += n
                            if (UpdateRules.overflow(r, received)) throw IOException("size")
                            md.update(buf, 0, n)
                            out.write(buf, 0, n)
                        }
                        out.fd.sync()
                    }
                }
                if (!UpdateRules.fileOk(r, received, hex(md.digest()))) {
                    part.delete()
                    throw IOException("file")
                }
                if (!part.renameTo(target)) throw IOException("rename")
                return
            }
        }
    }

    // ── 받은 APK 확인(앱 ID·버전·서명) ──

    private fun verify(app: Context, file: File, expectedVersion: String?): Boolean {
        val pm = app.packageManager
        val current = currentInfo(app) ?: return false
        @Suppress("DEPRECATION")
        val archive = pm.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES) ?: return false
        val a = UpdateRules.Archive(archive.packageName, archive.versionName, archive.longVersionCode)
        if (!UpdateRules.archiveOk(a, expectedVersion, current.versionName ?: return false, current.longVersionCode)) return false
        return UpdateRules.sameSigner(signers(current), signers(archive))
    }

    private fun currentInfo(app: Context): PackageInfo? = try {
        @Suppress("DEPRECATION")
        app.packageManager.getPackageInfo(app.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
    } catch (_: Exception) {
        null
    }

    private fun signers(info: PackageInfo): List<String>? {
        val signing = info.signingInfo ?: return null
        val list = signing.apkContentsSigners ?: return null
        return list.map { hex(MessageDigest.getInstance("SHA-256").digest(it.toByteArray())) }
    }

    // ── 설치 ──

    /** 상태가 바뀔 만한 때(화면 앞·뒤, 녹음 끝남, 설치 허용 뒤) 부른다. 조건이 맞을 때만 설치. */
    fun poke(context: Context) {
        val app = context.applicationContext
        worker.execute { tryInstall(app) }
    }

    /** [지금 업데이트]. */
    fun installNow(context: Context) {
        userAsked = true
        poke(context)
    }

    private fun tryInstall(app: Context, fromBackground: Boolean = false) {
        val p = phase
        if (p != UpdateRules.Phase.READY && p != UpdateRules.Phase.NEED_PERMISSION && p != UpdateRules.Phase.WAIT_RECORDING) return
        val r = release ?: return
        val file = File(File(app.noBackupFilesDir, DIR), UpdateRules.apkFileName(r.version))
        if (!file.isFile) return fail(app)
        val go = UpdateRules.decide(
            busy = recordingBusy(app),
            canInstall = app.packageManager.canRequestPackageInstalls(),
            inForeground = foreground || !fromBackground,
            userAsked = userAsked,
        )
        when (go) {
            // 녹음이 끝나면 RecordHub가 poke를 부른다.
            UpdateRules.Go.WAIT_RECORDING -> set(app, UpdateRules.Phase.WAIT_RECORDING)
            UpdateRules.Go.NEED_PERMISSION -> set(app, UpdateRules.Phase.NEED_PERMISSION)
            UpdateRules.Go.WAIT_BACKGROUND -> {
                set(app, UpdateRules.Phase.READY)
                // 받기를 마쳤거나 녹음이 끝났을 때 이미 뒤에 있으면 그때부터 10분을 센다.
                if (!foreground && !fromBackground) schedule(app)
            }
            UpdateRules.Go.INSTALL -> install(app, file)
        }
    }

    private fun recordingBusy(app: Context): Boolean = try {
        RecordHub.init(app)
        UpdateRules.recordingBusy(RecordHub.session())
    } catch (_: Exception) {
        true
    }

    private fun install(app: Context, file: File) {
        // 받아 둔 뒤 바뀌지 않았는지 설치 직전에 한 번 더 본다.
        if (!verify(app, file, release?.version)) {
            file.delete()
            return fail(app)
        }
        set(app, UpdateRules.Phase.INSTALLING)
        try {
            val installer = app.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(app.packageName)
                setSize(file.length())
                if (UpdateRules.askNoUserAction(Build.VERSION.SDK_INT) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                }
            }
            val id = installer.createSession(params)
            installer.openSession(id).use { session ->
                session.openWrite("base.apk", 0, file.length()).use { out ->
                    file.inputStream().use { it.copyTo(out) }
                    session.fsync(out)
                }
                val status = Intent(app, UpdateReceiver::class.java).setAction(ACTION_STATUS)
                val pi = PendingIntent.getBroadcast(app, id, status, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                session.commit(pi.intentSender)
            }
        } catch (_: Exception) {
            fail(app)
        }
    }

    /** PackageInstaller 결과(UpdateReceiver가 넘김). */
    fun onStatus(context: Context, intent: Intent) {
        val app = context.applicationContext
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val ask = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
                if (ask == null) return fail(app)
                confirm = ask.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                set(app, UpdateRules.Phase.CONFIRM)
                // [지금 업데이트]를 누르고 화면에 있으면 바로 확인 창, 아니면 알림 [업데이트] 한 번.
                if (userAsked && foreground) main.post { startConfirm(app) }
            }
            PackageInstaller.STATUS_SUCCESS -> {
                // 보통은 여기 오기 전에 이 프로세스가 새 판으로 바뀐다. 남은 파일은 새 판이 지운다(onReplaced).
                set(app, UpdateRules.Phase.IDLE)
            }
            else -> fail(app)
        }
    }

    /** 위쪽 줄·알림 [업데이트]. */
    fun startConfirm(context: Context): Boolean {
        val ask = confirm ?: return false
        return try {
            context.startActivity(ask)
            true
        } catch (_: Exception) {
            fail(context.applicationContext)
            false
        }
    }

    /** 새 판으로 바뀐 뒤(MY_PACKAGE_REPLACED): 받은 파일을 지우고 알림줄을 '업데이트했어요'로 바꾼다. */
    fun onReplaced(context: Context) {
        val app = context.applicationContext
        File(app.noBackupFilesDir, DIR).deleteRecursively()
        WorkManager.getInstance(app).cancelUniqueWork(WORK)
        if (!canNotify(app)) return
        channel(app)
        val open = PendingIntent.getActivity(app, 0, Intent(app, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val note = NotificationCompat.Builder(app, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("웹2 ${BuildConfig.VERSION_NAME}로 업데이트했어요")
            .setContentIntent(open)
            .setAutoCancel(true)
            .setSilent(true)
            .build()
        notify(app, note)
    }

    // ── 화면 앞·뒤 ──

    fun onForeground(context: Context) {
        foreground = true
        WorkManager.getInstance(context.applicationContext).cancelUniqueWork(WORK)
        poke(context)
    }

    /** 앱이 뒤로 감: 10분 뒤에도 뒤에 있으면 설치(WorkManager가 프로세스를 깨움). */
    fun onBackground(context: Context) {
        foreground = false
        val p = phase
        if (p != UpdateRules.Phase.READY && p != UpdateRules.Phase.WAIT_RECORDING) return
        schedule(context.applicationContext)
    }

    private fun schedule(app: Context) {
        val req = OneTimeWorkRequest.Builder(UpdateInstallWorker::class.java)
            .setInitialDelay(UpdateRules.BACKGROUND_DELAY_MIN, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(app).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, req)
    }

    /** WorkManager 작업: 프로세스가 새로 떴으면(메모리 상태 없음) 앱 전용 공간에 확인해 둔 파일로 다시 본다. */
    fun installFromBackground(context: Context) {
        val app = context.applicationContext
        if (foreground) return
        if (release == null) {
            val file = File(app.noBackupFilesDir, DIR).listFiles()?.firstOrNull { UpdateRules.versionFromFileName(it.name) != null } ?: return
            val version = UpdateRules.versionFromFileName(file.name) ?: return
            if (!verify(app, file, version)) {
                file.delete()
                return
            }
            release = UpdateRules.Release(version, ShellRules.RELEASE_DOWNLOAD_PREFIX + "$version/${file.name}", file.length(), null)
            phase = UpdateRules.Phase.READY
        }
        val done = java.util.concurrent.CountDownLatch(1)
        worker.execute {
            try {
                tryInstall(app, fromBackground = true)
            } finally {
                done.countDown()
            }
        }
        done.await(2, TimeUnit.MINUTES)
    }

    // ── 상태·알림줄 ──

    private fun fail(app: Context) = set(app, UpdateRules.Phase.FAILED)

    private fun set(app: Context, p: UpdateRules.Phase) {
        phase = p
        val v = release?.version ?: ""
        val text = UpdateRules.noteText(p, v)
        if (text == null) {
            NotificationManagerCompat.from(app).cancel(NOTE_ID)
        } else if (canNotify(app)) {
            channel(app)
            val b = NotificationCompat.Builder(app, CHANNEL)
                .setSmallIcon(if (p == UpdateRules.Phase.CONFIRM) android.R.drawable.stat_sys_download_done else android.R.drawable.stat_sys_download)
                .setContentTitle(text)
                .setOnlyAlertOnce(true)
                .setSilent(true)
            if (p == UpdateRules.Phase.CONFIRM) {
                val ask = confirm
                if (ask != null) {
                    val pi = PendingIntent.getActivity(app, 1, ask, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                    b.setContentIntent(pi).addAction(0, "업데이트", pi).setAutoCancel(true)
                }
            } else {
                b.setOngoing(true).setProgress(0, 0, true)
            }
            notify(app, b.build())
        }
        listener?.invoke()
    }

    private fun canNotify(app: Context): Boolean = NotificationManagerCompat.from(app).areNotificationsEnabled()

    private fun notify(app: Context, note: android.app.Notification) {
        try {
            app.getSystemService(NotificationManager::class.java)?.notify(NOTE_ID, note)
        } catch (_: SecurityException) {
        }
    }

    private fun channel(app: Context) {
        val nm = app.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) != null) return
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "앱 업데이트", NotificationManager.IMPORTANCE_LOW).apply {
            description = "새 버전 받는 중·설치 중"
            setShowBadge(false)
        })
    }

    private fun sha256(file: File): String? = try {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        hex(md.digest())
    } catch (_: Exception) {
        null
    }

    private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    /** 첫 한 번 '이 앱에서 설치 허용' 안내(설정 화면 바로 열기). */
    fun askPermission(activity: Activity) {
        android.app.AlertDialog.Builder(activity)
            .setTitle("앱 안에서 업데이트 허용")
            .setMessage(
                "처음 한 번만 하면 다음부터는 앱이 스스로 업데이트해요.\n\n" +
                    "1. 아래 [설정 열기]를 누르세요.\n" +
                    "2. '이 출처 허용'(또는 '알 수 없는 앱 설치 허용')을 켜세요.\n" +
                    "3. 뒤로가기를 누르면 이 앱으로 돌아와 업데이트를 이어서 해요.",
            )
            .setPositiveButton("설정 열기") { _, _ ->
                userAsked = true
                try {
                    activity.startActivity(
                        Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:" + activity.packageName)),
                    )
                } catch (_: Exception) {
                    fail(activity.applicationContext)
                }
            }
            .setNegativeButton("나중에", null)
            .show()
    }
}

/** PackageInstaller 결과와 새 판으로 바뀜(MY_PACKAGE_REPLACED)을 받는다. 내보내지 않는다(시스템만 보냄). */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            AppUpdater.ACTION_STATUS -> AppUpdater.onStatus(context, intent)
            Intent.ACTION_MY_PACKAGE_REPLACED -> AppUpdater.onReplaced(context)
        }
    }
}

/** 앱이 뒤에 10분 머문 뒤 설치(AppUpdater.onBackground가 예약, 화면이 앞에 오면 취소). */
class UpdateInstallWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        try {
            AppUpdater.installFromBackground(applicationContext)
        } catch (_: Exception) {
        }
        return Result.success()
    }
}
