package kr.or.kptu.work

import kr.or.kptu.work.RecordRules.Message
import kr.or.kptu.work.RecordRules.Outcome
import kr.or.kptu.work.RecordRules.Perm
import kr.or.kptu.work.RecordRules.Segment
import kr.or.kptu.work.RecordRules.Session
import kr.or.kptu.work.RecordRules.State
import kr.or.kptu.work.RecordRules.Step
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordRulesTest {
    private val sid = "11111111-2222-4333-8444-555555555555"
    private val rid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    private val rid2 = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff"
    private val ws = "99999999-8888-4777-8666-555555555555"

    private fun seg(no: Int = 1, id: String? = rid) = Segment(no = no, id = id, file = RecordRules.segmentFile(sid, no))
    private fun session(vararg segs: Segment) = Session(sid, ws, "2026-10-30T05:00:00.000Z", State.RECORDING, 900, segs.toList())

    @Test fun 조각_나누기_1분마다_새_바이트만_순서대로() {
        var s = seg()
        assertFalse(RecordRules.shouldCut(s, 59_999))
        assertTrue(RecordRules.shouldCut(s, 60_000))
        s = RecordRules.cut(s, 240_000, 60_000)
        assertEquals(1, s.pieces.size)
        assertEquals(RecordRules.Piece(1, 0, 240_000, 60), s.pieces[0])
        assertFalse(RecordRules.shouldCut(s, 119_000))
        s = RecordRules.cut(s, 470_000, 120_400)
        assertEquals(RecordRules.Piece(2, 240_000, 470_000, 121), s.pieces[1])
        // 이어 붙이면 빈틈·겹침이 없다(서버가 순서대로 이어 한 파일로 만든다).
        assertEquals(s.pieces[0].to, s.pieces[1].from)
        // 새 바이트가 없으면 조각을 만들지 않는다.
        val same = RecordRules.cut(s, 470_000, 180_000)
        assertEquals(2, same.pieces.size)
        // 멈추면 남은 바이트가 마지막 조각.
        val ended = RecordRules.end(s, 500_000, 130_000)
        assertTrue(ended.ended)
        assertEquals(RecordRules.Piece(3, 470_000, 500_000, 130), ended.pieces.last())
        // 길이는 1초~1시간 안.
        assertEquals(1, RecordRules.cut(seg(), 10, 0).pieces[0].seconds)
        assertEquals(3600, RecordRules.cut(seg(), 10, 9_000_000).pieces[0].seconds)
    }

    @Test fun 구간_길이는_서버_조각_기준을_따른다() {
        // 옛 서버(5분 조각, 한 구간 16조각까지): 1분 조각 15개에서 넘긴다.
        assertEquals(900, RecordRules.segmentLimitSeconds(300, 3540))
        assertEquals(900, RecordRules.segmentLimitSeconds(null, null))
        // 1분 조각 서버: 서버 구간 길이(59분).
        assertEquals(3540, RecordRules.segmentLimitSeconds(60, 3540))
        assertEquals(3540, RecordRules.segmentLimitSeconds(60, 99_999))
        assertTrue(RecordRules.shouldRoll(900_000, 900))
        assertFalse(RecordRules.shouldRoll(899_999, 900))
    }

    @Test fun 대기열은_한_번에_하나_순서대로() {
        val a = RecordRules.cut(seg(), 100, 60_000)
        assertEquals(Step.Send(0, a.pieces[0]), RecordRules.nextStep(listOf(a)))
        assertEquals(Step.Idle, RecordRules.nextStep(listOf(seg())))
        // 앞 구간을 다 보내기 전에는 다음 구간을 열지 않는다.
        val ended = RecordRules.end(a, 200, 70_000)
        val next = seg(2, null)
        assertTrue(RecordRules.nextStep(listOf(ended, next)) is Step.Send)
        val done = ended.copy(pieces = emptyList())
        assertEquals(Step.Open(1), RecordRules.nextStep(listOf(done, next)))
        assertEquals(Step.Drained, RecordRules.nextStep(listOf(done)))
        // 조각 없이 끝난 새 구간은 열지 않는다.
        assertEquals(Step.Drained, RecordRules.nextStep(listOf(done, next.copy(ended = true))))
        // 서버가 닫은 구간은 건너뛴다.
        assertEquals(Step.Drained, RecordRules.nextStep(listOf(a.copy(stopped = true, ended = true))))
        assertEquals(2, RecordRules.queued(listOf(ended)))
    }

    @Test fun 업로드_재시도_간격과_성공하면_처음부터() {
        assertEquals(3_000L, RecordRules.retryDelay(1))
        assertEquals(10_000L, RecordRules.retryDelay(2))
        assertEquals(30_000L, RecordRules.retryDelay(3))
        assertEquals(60_000L, RecordRules.retryDelay(4))
        assertEquals(60_000L, RecordRules.retryDelay(40))
        var s = session(RecordRules.cut(seg(), 100, 60_000))
        s = RecordRules.failed(s, 1, Outcome.RETRY)
        s = RecordRules.failed(s, 1, Outcome.RETRY)
        assertEquals(2, s.fails)
        // 재시도는 조각을 버리지 않는다(같은 번호로 다시).
        assertEquals(1, s.segments[0].pieces.size)
        s = RecordRules.sent(s, 1, 1)
        assertEquals(0, s.fails)
        assertEquals(0, s.segments[0].pieces.size)
        // 늦게 온 같은 답은 무시.
        val again = RecordRules.sent(session(RecordRules.cut(RecordRules.cut(seg(), 100, 60_000), 200, 120_000)).let { RecordRules.sent(it, 1, 1) }, 1, 1)
        assertEquals(1, again.segments[0].pieces.size)
    }

    @Test fun 서버가_닫거나_가득_차면_그_구간_조각을_버린다() {
        val s = session(RecordRules.cut(seg(), 100, 60_000))
        val stop = RecordRules.failed(s, 1, Outcome.STOP)
        assertTrue(stop.segments[0].stopped)
        assertTrue(stop.segments[0].pieces.isEmpty())
        val full = RecordRules.failed(s, 1, Outcome.FULL)
        assertTrue(full.segments[0].stopped)
        // 닫힌 구간은 더 자르지 않는다.
        assertTrue(RecordRules.cut(full.segments[0], 999, 120_000).pieces.isEmpty())
        val opened = RecordRules.opened(session(seg(), seg(2, null)), 2, rid2)
        assertEquals(rid2, opened.segments[1].id)
    }

    @Test fun 임시_파일_지우기() {
        val live = RecordRules.cut(seg(), 100, 60_000)
        val sentAll = RecordRules.end(seg(2), 0, 0).copy(pieces = emptyList())
        val stopped = seg(3).copy(stopped = true, ended = true)
        val s = session(live, sentAll, stopped)
        val files = listOf(live.file, sentAll.file, stopped.file, "seg-other-1.ogg", "seg-zzzzzzzz-1.ogg", "state.json", "photo.jpg")
        assertEquals(listOf(sentAll.file, stopped.file, "seg-zzzzzzzz-1.ogg"), RecordRules.filesToDelete(s, files))
        // 녹음이 없으면 녹음 파일은 모두 지운다(다른 파일은 건드리지 않음).
        assertEquals(listOf(live.file, sentAll.file, stopped.file, "seg-zzzzzzzz-1.ogg"), RecordRules.filesToDelete(null, files))
        assertFalse(RecordRules.isSegmentFile("../seg-$sid-1.ogg"))
    }

    @Test fun 앱이_죽은_뒤에는_이어서_정리() {
        val s = session(RecordRules.cut(seg().copy(recordedMs = 90_000), 100, 60_000).copy(recordedMs = 90_000)).copy(autoFinish = true)
        val r = RecordRules.recover(s) { 150 }
        assertEquals(State.INTERRUPTED, r.state)
        assertFalse(r.autoFinish)
        assertTrue(r.segments[0].ended)
        assertEquals(RecordRules.Piece(2, 100, 150, 90), r.segments[0].pieces.last())
    }

    @Test fun 권한은_처음_쓸_때만() {
        assertEquals(listOf(Perm.MIC, Perm.NOTIFY), RecordRules.permissionsToAsk(34, false, false, false))
        assertEquals(listOf(Perm.MIC), RecordRules.permissionsToAsk(34, false, false, true))
        assertEquals(emptyList<Perm>(), RecordRules.permissionsToAsk(34, true, false, true))
        assertEquals(emptyList<Perm>(), RecordRules.permissionsToAsk(34, true, true, false))
        // 안드로이드 12 이하는 알림 권한을 묻지 않는다.
        assertEquals(listOf(Perm.MIC), RecordRules.permissionsToAsk(31, false, false, false))
    }

    @Test fun 다리_글_읽기() {
        assertEquals(Message.Hello, RecordRules.message("rec:hello"))
        assertEquals(Message.Sent(1, 3), RecordRules.message("rec:sent:1:3"))
        assertEquals(Message.Failed(2, 1, Outcome.RETRY), RecordRules.message("rec:failed:2:1:retry"))
        assertEquals(Message.Opened(2, rid2), RecordRules.message("rec:opened:2:$rid2"))
        assertNull(RecordRules.message("rec:opened:2:not-a-uuid"))
        assertNull(RecordRules.message("rec:failed:2:1:boom"))
        assertNull(RecordRules.message("rec:sent:0:1"))
        assertNull(RecordRules.message("widget:status"))
        val begin = RecordRules.message("rec:begin:{\"session_id\":\"$sid\",\"recording_id\":\"$rid\",\"segment_no\":1,\"workspace_id\":\"$ws\",\"started_at\":\"2026-10-30T05:00:00.000Z\",\"piece_seconds\":300,\"segment_seconds\":3540}")
        assertEquals(Message.Begin(sid, rid, 1, ws, "2026-10-30T05:00:00.000Z", 900), begin)
        assertNull(RecordRules.message("rec:begin:{\"session_id\":\"x\"}"))
    }

    @Test fun 웹에_주는_글에는_소리_파일_토큰이_없다() {
        val s = session(RecordRules.cut(seg(), 100, 60_000))
        val state = RecordRules.stateJson(s, false)
        assertTrue(state.contains("\"state\":\"recording\""))
        assertTrue(state.contains("\"queued\":1"))
        assertFalse(state.contains(".ogg"))
        assertEquals("{\"state\":\"idle\",\"want_start\":true}", RecordRules.stateJson(null, true))
        val next = RecordRules.nextJson(s, "tok")
        assertEquals("{\"kind\":\"piece\",\"no\":1,\"id\":\"$rid\",\"seq\":1,\"seconds\":60,\"size\":100,\"token\":\"tok\"}", next)
        assertEquals("{\"kind\":\"none\"}", RecordRules.nextJson(null, null))
    }

    @Test fun 조각_주소는_웹2_호스트의_rec_경로만() {
        val t = "AbCdEfGhIjKlMnOpQrStUvWx"
        assertEquals(t, RecordRules.pieceRequest("https://bokdoong.com/work/app/__rec/$t"))
        assertNull(RecordRules.pieceRequest("https://evil.example/work/app/__rec/$t"))
        assertNull(RecordRules.pieceRequest("http://bokdoong.com/work/app/__rec/$t"))
        assertNull(RecordRules.pieceRequest("https://bokdoong.com/work/app/__rec/$t?x=1"))
        assertNull(RecordRules.pieceRequest("https://bokdoong.com/work/app/__rec/short"))
        assertNull(RecordRules.pieceRequest("https://bokdoong.com/work/app/__share/$t/0"))
    }
}
