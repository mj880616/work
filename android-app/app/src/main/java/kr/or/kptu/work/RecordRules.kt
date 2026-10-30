package kr.or.kptu.work

import java.net.URI

/**
 * 폰 앱 [녹음]의 판단 규칙(MTG-폰녹음, 요청함 10/30 10:56). 안드로이드 API를 쓰지 않아 JVM 단위 시험으로 확인한다.
 * - 앱(RecorderService)이 OGG/Opus 한 파일로 계속 녹음하고, 1분마다 새로 쓰인 바이트를 조각(파일 안 범위)으로 자른다.
 *   서버(meeting-transcribe rec_piece)는 조각을 순서대로 이어 한 파일로 만들므로, 바이트를 순서대로 자르기만 하면 된다.
 * - 조각 올리기는 웹 화면(app/phone-recorder.js)이 웹2 로그인 세션으로 한다. 앱은 토큰을 보지 않는다.
 *   앱은 대기열·순서·재시도 간격·임시 파일 지우기를 맡는다(여기 규칙).
 * - 녹음 내용·토큰은 로그에 쓰지 않는다.
 */
object RecordRules {
    /** 조각 간격(요청함 11:15 결정: 1분). */
    const val PIECE_SECONDS = 60
    /** 서버 전사 한 번 상한(1시간) 안의 구간 길이. 서버 REC_SEGMENT_SECONDS와 같다. */
    const val SEGMENT_SECONDS = 59 * 60
    /** 서버가 아직 5분 조각 기준이면(rec_start 답의 piece_seconds ≥ 300) 한 구간 조각 상한이 16개다(REC_MAX_PIECES). */
    const val OLD_SERVER_MAX_PIECES = 16
    /** 조각 한 개의 길이 상한(초, 서버 MAX_SECONDS). */
    const val MAX_PIECE_SECONDS = 3600
    val RETRY_MS: List<Long> = listOf(3_000L, 10_000L, 30_000L, 60_000L)
    const val AUDIO_BITS = 32_000
    const val MIME = "audio/ogg"

    // ---- 상태 ----
    enum class State(val wire: String) {
        RECORDING("recording"), PAUSED("paused"),
        /** [멈추고 정리]·[버리기]로 녹음기를 멈춤. 남은 조각을 웹이 올리면 끝. */
        STOPPED("stopped"),
        /** 앱이 녹음 중에 죽었다(강제 종료·폰 꺼짐). 다시 열면 '이어서 정리'. */
        INTERRUPTED("interrupted");

        companion object {
            fun of(wire: String?): State? = entries.firstOrNull { it.wire == wire }
        }
    }

    /** 조각 = 구간 파일의 [from, to) 바이트. seconds = 구간 시작부터 녹음한 초(서버 x-duration-sec). */
    data class Piece(val seq: Int, val from: Long, val to: Long, val seconds: Int) {
        val size: Long get() = to - from
    }

    /**
     * 녹음 구간 하나(서버 app_meeting_recordings 한 행 = 파일 하나). id는 rec_start가 준 recording_id(아직 안 열었으면 null).
     * cutAt: 조각으로 자른 바이트 끝. recordedMs: 이 구간에서 녹음한 시간(일시정지 뺌, 마지막 저장 기준).
     */
    data class Segment(
        val no: Int,
        val id: String?,
        val file: String,
        val ended: Boolean = false,
        val stopped: Boolean = false,
        val cutAt: Long = 0L,
        val cutSeq: Int = 0,
        val cutMs: Long = 0L,
        val recordedMs: Long = 0L,
        val pieces: List<Piece> = emptyList(),
    )

    data class Session(
        val sessionId: String,
        val workspaceId: String,
        val startedAt: String,
        val state: State,
        val segmentLimit: Int,
        val segments: List<Segment>,
        /** 앞 구간들 녹음 시간 합 + 지금 구간(일시정지 뺌). 알림·띠의 시계. */
        val baseMs: Long = 0L,
        val fails: Int = 0,
        /** 알림 [멈추고 정리]로 멈춤: 웹 화면이 열리면 바로 정리한다(한 번). */
        val autoFinish: Boolean = false,
        val discard: Boolean = false,
    ) {
        val current: Segment? get() = segments.lastOrNull()
        fun elapsedMs(): Long = baseMs + (current?.recordedMs ?: 0L)
    }

    /**
     * 한 구간을 몇 초에서 넘길지. 서버가 rec_start 답으로 주는 piece_seconds·segment_seconds를 본다.
     * 옛 서버(5분 조각, 한 구간 조각 16개까지)면 1분 조각 15개(15분)에서 넘겨 마지막 조각 자리 1개를 남긴다.
     */
    fun segmentLimitSeconds(serverPieceSeconds: Int?, serverSegmentSeconds: Int?): Int {
        val seg = (serverSegmentSeconds ?: SEGMENT_SECONDS).takeIf { it in 60..SEGMENT_SECONDS } ?: SEGMENT_SECONDS
        if ((serverPieceSeconds ?: 300) >= 300) return minOf(seg, (OLD_SERVER_MAX_PIECES - 1) * PIECE_SECONDS)
        return seg
    }

    fun shouldCut(seg: Segment, recordedMs: Long): Boolean = recordedMs - seg.cutMs >= PIECE_SECONDS * 1000L

    fun shouldRoll(recordedMs: Long, limitSeconds: Int): Boolean = recordedMs >= limitSeconds * 1000L

    /** 파일이 fileLength까지 쓰였을 때 새 바이트를 조각 하나로 자른다. 새 바이트가 없으면 그대로. */
    fun cut(seg: Segment, fileLength: Long, recordedMs: Long): Segment {
        if (seg.stopped || fileLength <= seg.cutAt) return seg.copy(recordedMs = maxOf(seg.recordedMs, recordedMs))
        val seconds = ((recordedMs + 999) / 1000).toInt().coerceIn(1, MAX_PIECE_SECONDS)
        val piece = Piece(seg.cutSeq + 1, seg.cutAt, fileLength, seconds)
        return seg.copy(cutAt = fileLength, cutSeq = piece.seq, cutMs = recordedMs, recordedMs = maxOf(seg.recordedMs, recordedMs), pieces = seg.pieces + piece)
    }

    /** 녹음기를 멈춘 뒤: 남은 바이트를 마지막 조각으로 자르고 구간을 끝낸다. */
    fun end(seg: Segment, fileLength: Long, recordedMs: Long): Segment = cut(seg, fileLength, recordedMs).copy(ended = true)

    /** 앱이 죽은 뒤 다시 열었을 때: 끝나지 않은 구간은 파일에 남은 만큼 잘라 끝낸다(마지막 저장 시각 기준 길이). */
    /** 녹음기가 없는 새 프로세스에서 읽은 녹음은 모두 '끝나지 않은 녹음'(INTERRUPTED)이다. 자동 정리는 다시 하지 않는다(되풀이 방지). */
    fun recover(s: Session, fileLength: (Segment) -> Long): Session =
        s.copy(state = State.INTERRUPTED, autoFinish = false, segments = s.segments.map { if (it.ended) it else end(it, fileLength(it), it.recordedMs) })

    // ---- 대기열(웹 nextStep과 같은 규칙, 한 번에 하나·순서대로) ----
    sealed class Step {
        data class Send(val index: Int, val piece: Piece) : Step()
        data class Open(val index: Int) : Step()
        object Idle : Step()
        object Drained : Step()
    }

    fun nextStep(segments: List<Segment>): Step {
        for ((i, s) in segments.withIndex()) {
            if (s.stopped) continue
            if (s.id == null && s.ended && s.pieces.isEmpty()) continue
            if (s.id == null) return Step.Open(i)
            if (s.pieces.isNotEmpty()) return Step.Send(i, s.pieces.first())
            if (!s.ended) return Step.Idle
        }
        return if (segments.isNotEmpty() && segments.all { it.stopped || (it.ended && it.pieces.isEmpty()) }) Step.Drained else Step.Idle
    }

    fun queued(segments: List<Segment>): Int = segments.sumOf { if (it.stopped) 0 else it.pieces.size }

    /** 올렸다: 그 구간 첫 조각이 맞을 때만 뺀다(늦게 온 같은 답은 무시). */
    fun sent(s: Session, no: Int, seq: Int): Session {
        val segs = s.segments.map { if (it.no == no && it.pieces.firstOrNull()?.seq == seq) it.copy(pieces = it.pieces.drop(1)) else it }
        return s.copy(segments = segs, fails = 0)
    }

    /** 웹이 rec_start로 연 새 구간 번호. 아직 id 없는 그 구간에만 붙인다. */
    fun opened(s: Session, no: Int, recordingId: String): Session =
        s.copy(segments = s.segments.map { if (it.no == no && it.id == null) it.copy(id = recordingId) else it }, fails = 0)

    enum class Outcome { RETRY, STOP, FULL }

    fun outcome(wire: String?): Outcome? = when (wire) {
        "retry" -> Outcome.RETRY
        "stop" -> Outcome.STOP
        "full" -> Outcome.FULL
        else -> null
    }

    /**
     * 올리기 실패. RETRY: 같은 번호로 다시(기다릴 시간은 retryDelay). STOP: 서버가 이 구간을 닫음 → 남은 조각을 버림.
     * FULL: 구간이 가득 참(옛 서버 상한을 넘김) → 이 구간은 닫고, 녹음 중이면 화면이 새 구간으로 넘기게 한다(rollWanted).
     */
    fun failed(s: Session, no: Int, outcome: Outcome): Session = when (outcome) {
        Outcome.RETRY -> s.copy(fails = s.fails + 1)
        Outcome.STOP, Outcome.FULL -> s.copy(segments = s.segments.map { if (it.no == no) it.copy(stopped = true, pieces = emptyList()) else it }, fails = 0)
    }

    fun retryDelay(fails: Int): Long = RETRY_MS[(maxOf(1, fails) - 1).coerceAtMost(RETRY_MS.size - 1)]

    // ---- 임시 파일 ----
    /** 지울 구간 파일: 끝났고 남은 조각이 없거나, 서버가 닫은 구간. 상태에 없는 녹음 파일(앞 녹음의 찌꺼기)도. */
    fun filesToDelete(s: Session?, files: List<String>): List<String> {
        val keep = s?.segments?.filterNot { (it.ended && it.pieces.isEmpty()) || it.stopped }?.map { it.file }?.toSet() ?: emptySet()
        return files.filter { isSegmentFile(it) && it !in keep }
    }

    private val SEGMENT_FILE = Regex("^seg-[A-Za-z0-9_-]{8,64}-\\d{1,2}\\.ogg$")
    fun isSegmentFile(name: String): Boolean = SEGMENT_FILE.matches(name)
    fun segmentFile(token: String, no: Int): String = "seg-$token-$no.ogg"

    // ---- 권한(처음 쓸 때만 묻는다) ----
    enum class Perm { MIC, NOTIFY }

    /** 물어야 할 권한. 마이크는 없으면 늘 묻고, 알림(안드로이드 13+)은 한 번도 묻지 않았을 때만 묻는다(거절해도 녹음은 된다). */
    fun permissionsToAsk(sdk: Int, micGranted: Boolean, notifyGranted: Boolean, notifyAskedBefore: Boolean): List<Perm> {
        val out = mutableListOf<Perm>()
        if (!micGranted) out += Perm.MIC
        if (sdk >= 33 && !notifyGranted && !notifyAskedBefore) out += Perm.NOTIFY
        return out
    }

    // ---- 다리 글 ----
    sealed class Message {
        object Hello : Message()
        object Prepare : Message()
        data class Begin(val sessionId: String, val recordingId: String, val segmentNo: Int, val workspaceId: String, val startedAt: String, val limitSeconds: Int) : Message()
        object Pause : Message()
        object Resume : Message()
        object Stop : Message()
        object Discard : Message()
        object Next : Message()
        data class Sent(val no: Int, val seq: Int) : Message()
        data class Failed(val no: Int, val seq: Int, val outcome: Outcome) : Message()
        data class Opened(val no: Int, val recordingId: String) : Message()
        object Finishing : Message()
        object Clear : Message()
    }

    private val UUID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    private val ISO = Regex("^\\d{4}-\\d{2}-\\d{2}T[0-9:.]{5,15}Z$")
    fun isUuid(v: String?): Boolean = v != null && UUID.matches(v)

    fun message(data: String?): Message? {
        if (data == null || !data.startsWith("rec:") || data.length > 2000) return null
        val body = data.substring(4)
        when (body) {
            "hello" -> return Message.Hello
            "prepare" -> return Message.Prepare
            "pause" -> return Message.Pause
            "resume" -> return Message.Resume
            "stop" -> return Message.Stop
            "discard" -> return Message.Discard
            "next" -> return Message.Next
            "finishing" -> return Message.Finishing
            "clear" -> return Message.Clear
        }
        val parts = body.split(':')
        fun int(i: Int) = parts.getOrNull(i)?.toIntOrNull()?.takeIf { it in 1..999 }
        return when (parts[0]) {
            "sent" -> if (parts.size == 3) Message.Sent(int(1) ?: return null, int(2) ?: return null) else null
            "failed" -> if (parts.size == 4) Message.Failed(int(1) ?: return null, int(2) ?: return null, outcome(parts[3]) ?: return null) else null
            "opened" -> if (parts.size == 3 && isUuid(parts[2])) Message.Opened(int(1) ?: return null, parts[2]) else null
            "begin" -> begin(body.substring("begin:".length))
            else -> null
        }
    }

    private fun begin(json: String): Message.Begin? {
        val o = MiniJson.obj(MiniJson.parse(json)) ?: return null
        val sid = MiniJson.str(o["session_id"]).takeIf(::isUuid) ?: return null
        val rid = MiniJson.str(o["recording_id"]).takeIf(::isUuid) ?: return null
        val ws = MiniJson.str(o["workspace_id"]).takeIf(::isUuid) ?: return null
        val at = MiniJson.str(o["started_at"])?.takeIf { ISO.matches(it) } ?: return null
        val no = MiniJson.num(o["segment_no"])?.toInt()?.takeIf { it in 1..99 } ?: 1
        val limit = segmentLimitSeconds(MiniJson.num(o["piece_seconds"])?.toInt(), MiniJson.num(o["segment_seconds"])?.toInt())
        return Message.Begin(sid, rid, no, ws, at, limit)
    }

    /** 'rec:state:' 뒤 JSON. 소리·파일 이름·토큰은 넣지 않는다. */
    fun stateJson(s: Session?, wantStart: Boolean): String {
        if (s == null) return "{\"state\":\"idle\",\"want_start\":$wantStart}"
        val j = ShellRules::jsonString
        return "{\"state\":${j(s.state.wire)},\"session_id\":${j(s.sessionId)},\"started_at\":${j(s.startedAt)}," +
            "\"elapsed_ms\":${s.elapsedMs()},\"queued\":${queued(s.segments)},\"fails\":${s.fails}," +
            "\"auto_finish\":${s.autoFinish},\"discard\":${s.discard},\"want_start\":$wantStart}"
    }

    /** 'rec:next:' 뒤 JSON. 조각 내용은 __rec/<번호> 가로채기로만 준다. */
    fun nextJson(s: Session?, token: String?): String {
        if (s == null) return "{\"kind\":\"none\"}"
        return when (val step = nextStep(s.segments)) {
            is Step.Send -> {
                val seg = s.segments[step.index]
                "{\"kind\":\"piece\",\"no\":${seg.no},\"id\":${ShellRules.jsonString(seg.id ?: "")},\"seq\":${step.piece.seq}," +
                    "\"seconds\":${step.piece.seconds},\"size\":${step.piece.size},\"token\":${ShellRules.jsonString(token ?: "")}}"
            }
            is Step.Open -> "{\"kind\":\"start\",\"no\":${s.segments[step.index].no}}"
            Step.Idle -> "{\"kind\":\"idle\"}"
            Step.Drained -> "{\"kind\":\"drained\"}"
        }
    }

    private val PIECE_PATH = Regex("^(?:/work/app)?/__rec/([A-Za-z0-9_-]{22,64})$")

    /** 웹이 조각을 받는 주소 https://<허용 호스트>/work/app/__rec/<번호>. 맞으면 번호, 아니면 null(평소대로). */
    fun pieceRequest(url: String?): String? {
        val u = try {
            if (url.isNullOrBlank()) return null else URI(url.trim())
        } catch (_: Exception) {
            return null
        }
        if (!"https".equals(u.scheme, ignoreCase = true) || u.rawUserInfo != null) return null
        if (u.port != -1 && u.port != 443) return null
        if ((u.host?.lowercase() ?: return null) !in ShellRules.INTERNAL_HOSTS) return null
        if (u.rawQuery != null || u.rawFragment != null) return null
        return PIECE_PATH.matchEntire(u.rawPath ?: return null)?.groupValues?.get(1)
    }
}
