package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/** WIDGET-여러개 ①: 빠른 쓰기(4×1)·한 칸(1×1) 위젯 규칙과 매니페스트 목록. */
class WidgetActionsTest {
    private val android = "http://schemas.android.com/apk/res/android"

    private fun xml(path: String): Element {
        val f = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        return f.newDocumentBuilder().parse(File(path)).documentElement
    }

    private fun children(parent: Element, tag: String): List<Element> {
        val list = parent.getElementsByTagName(tag)
        return (0 until list.length).map { list.item(it) as Element }
    }

    private fun attr(e: Element, name: String): String = e.getAttributeNS(android, name)

    @Test
    fun quickCellsAreUpdateTaskNotePhoto() {
        assertEquals(listOf(WidgetAction.UPDATE, WidgetAction.TASK, WidgetAction.NOTE, WidgetAction.PHOTO), WidgetActions.QUICK)
        assertEquals(listOf("업데이트", "할 일", "노트", "사진"), WidgetActions.QUICK.map { it.label })
    }

    @Test
    fun oneWidgetChoicesAreTheFiveAsked() {
        assertEquals(
            listOf(WidgetAction.NOTE, WidgetAction.UPDATE, WidgetAction.TASK, WidgetAction.PHOTO, WidgetAction.RECORD),
            WidgetActions.ONE_CHOICES,
        )
        assertEquals(WidgetAction.RECORD, WidgetActions.chosen("record"))
        assertNull(WidgetActions.chosen("delete"))
        assertNull(WidgetActions.chosen(null))
        assertNull(WidgetActions.chosen(""))
    }

    @Test
    fun eachCellOpensTheRightPlace() {
        assertEquals(WidgetActions.Target("MainActivity", "kr.or.kptu.work.action.WIDGET_WRITE", "update"), WidgetActions.target(WidgetAction.UPDATE))
        assertEquals(WidgetActions.Target("MainActivity", "kr.or.kptu.work.action.WIDGET_WRITE", "task"), WidgetActions.target(WidgetAction.TASK))
        assertEquals(WidgetActions.Target("MainActivity", "kr.or.kptu.work.action.WIDGET_WRITE", "note"), WidgetActions.target(WidgetAction.NOTE))
        assertEquals(WidgetActions.Target("PhotoPickActivity", "kr.or.kptu.work.action.WIDGET_PHOTO", null), WidgetActions.target(WidgetAction.PHOTO))
        // 녹음은 MTG-폰녹음의 녹음 시작 인텐트 그대로(내보내지 않은 RecordActionActivity).
        assertEquals(WidgetActions.Target("RecordActionActivity", RecordHub.ACTION_START, null), WidgetActions.target(WidgetAction.RECORD))
        assertEquals("kr.or.kptu.work.action.REC_START", RecordHub.ACTION_START)
    }

    @Test
    fun writeAddressAndBridgeMessageOnlyForWriteKinds() {
        assertEquals("https://bokdoong.com/work/app/?write=update", WidgetActions.writeUrl(WidgetAction.UPDATE))
        assertEquals("https://bokdoong.com/work/app/?write=task", WidgetActions.writeUrl(WidgetAction.TASK))
        assertEquals("https://bokdoong.com/work/app/?write=note", WidgetActions.writeUrl(WidgetAction.NOTE))
        assertEquals("write:open:note", WidgetActions.writeMessage(WidgetAction.NOTE))
        assertTrue(ShellRules.isInternalApp(WidgetActions.writeUrl(WidgetAction.TASK)))
        // 밖에서 MainActivity로 보낸 값은 쓰기 종류만 받는다.
        assertEquals(WidgetAction.TASK, WidgetActions.writeKind("task"))
        assertNull(WidgetActions.writeKind("photo"))
        assertNull(WidgetActions.writeKind("record"))
        assertNull(WidgetActions.writeKind("../x"))
        assertNull(WidgetActions.writeKind(null))
        for (a in listOf(WidgetAction.PHOTO, WidgetAction.RECORD)) {
            assertFalse(WidgetActions.isWrite(a))
            try {
                WidgetActions.writeUrl(a)
                throw AssertionError("writeUrl($a)")
            } catch (_: IllegalArgumentException) {
            }
        }
    }

    @Test
    fun requestCodesDoNotCollide() {
        val codes = listOf(QuickWidget.WIDGET, OneWidget.WIDGET).flatMap { w -> WidgetAction.values().map { WidgetActions.requestCode(w, it) } }
        assertEquals(codes.size, codes.toSet().size)
        // 오늘 위젯(10~21)과 겹치지 않는다.
        assertTrue(codes.all { it >= 100 })
    }

    @Test
    fun choiceIsKeptPerWidgetInAppOnlyPrefs() {
        assertEquals("one.7", WidgetActions.prefKey(7))
        assertEquals("one.8", WidgetActions.prefKey(8))
        assertEquals("widget_one", WidgetActions.PREFS)
        // 설정 파일(sharedpref)은 백업·새 폰 옮기기에서 빠진다.
        val rules = File("src/main/res/xml/data_extraction_rules.xml").readText()
        assertEquals(2, Regex("<exclude domain=\"sharedpref\" path=\".\" />").findAll(rules).count())
    }

    @Test
    fun manifestListsTheWidgets() {
        val app = children(xml("src/main/AndroidManifest.xml"), "application").single()
        // 위젯 받는 곳만(앱 업데이트 결과 받는 곳 .UpdateReceiver는 UpdateRulesTest가 본다).
        val receivers = children(app, "receiver").filter { attr(it, "name") != ".UpdateReceiver" }.associateBy { attr(it, "name") }
        assertEquals(setOf(".NowWidget", ".QuickWidget", ".OneWidget", ".WeekWidget", ".ArsenalWidget"), receivers.keys)
        val infos = mapOf(".NowWidget" to "@xml/now_widget_info", ".QuickWidget" to "@xml/quick_widget_info", ".OneWidget" to "@xml/one_widget_info", ".WeekWidget" to "@xml/week_widget_info", ".ArsenalWidget" to "@xml/arsenal_widget_info")
        for ((name, r) in receivers) {
            assertEquals("$name exported", "false", attr(r, "exported"))
            assertEquals(infos[name], attr(children(r, "meta-data").single(), "resource"))
        }
        val activities = children(app, "activity").associateBy { attr(it, "name") }
        // 칸이 여는 화면: 사진·녹음은 내보내지 않은 화면, 고르기 창만 홈 화면 앱용으로 내보낸다(설정 동작 하나만).
        assertEquals("false", attr(activities.getValue(".PhotoPickActivity"), "exported"))
        assertEquals("false", attr(activities.getValue(".RecordActionActivity"), "exported"))
        val config = activities.getValue(".OneWidgetConfigActivity")
        assertEquals("true", attr(config, "exported"))
        val actions = children(config, "action").map { attr(it, "name") }
        assertEquals(listOf("android.appwidget.action.APPWIDGET_CONFIGURE"), actions)
        // 위젯은 권한을 늘리지 않았다(카메라 권한 없음). 설치 권한 둘은 앱 스스로 업데이트(0.3.8)용.
        // 사진·동영상 읽기 넷은 사진 메뉴 '폰 사진'(PHOTO-출처 ①, 0.3.9)용 — 저장소 쓰기·위치·카메라는 없다.
        val perms = children(xml("src/main/AndroidManifest.xml"), "uses-permission").map { attr(it, "name") }.toSet()
        assertEquals(
            setOf(
                "android.permission.INTERNET", "android.permission.RECORD_AUDIO", "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_MICROPHONE", "android.permission.POST_NOTIFICATIONS",
                "android.permission.REQUEST_INSTALL_PACKAGES", "android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION",
                "android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO", "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
                "android.permission.READ_EXTERNAL_STORAGE",
            ),
            perms,
        )
    }

    @Test
    fun widgetInfoSizesAndHomeOnly() {
        val quick = xml("src/main/res/xml/quick_widget_info.xml")
        assertEquals("4", attr(quick, "targetCellWidth"))
        assertEquals("1", attr(quick, "targetCellHeight"))
        assertEquals("home_screen", attr(quick, "widgetCategory"))
        assertEquals("0", attr(quick, "updatePeriodMillis"))
        val one = xml("src/main/res/xml/one_widget_info.xml")
        assertEquals("1", attr(one, "targetCellWidth"))
        assertEquals("1", attr(one, "targetCellHeight"))
        assertEquals("kr.or.kptu.work.OneWidgetConfigActivity", attr(one, "configure"))
        assertEquals("reconfigurable", attr(one, "widgetFeatures"))
        assertEquals("home_screen", attr(one, "widgetCategory"))
        assertEquals("0", attr(one, "updatePeriodMillis"))
    }

    @Test
    fun actionWidgetsSendNoServerRequestAndDoNotLog() {
        val dir = File("src/main/java/kr/or/kptu/work")
        for (name in listOf("WidgetActions.kt", "ActionWidgets.kt")) {
            val text = File(dir, name).readText()
            for (bad in listOf("Log.", "println(", "printStackTrace", "WidgetHub", "OkHttp", "https://")) {
                assertFalse("$name: $bad", text.contains(bad))
            }
        }
    }
}
