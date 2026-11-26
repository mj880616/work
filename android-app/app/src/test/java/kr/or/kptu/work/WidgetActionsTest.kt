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
        assertEquals(WidgetActions.Target("QuickWriteActivity", "kr.or.kptu.work.action.WIDGET_QUICK_WRITE", "update"), WidgetActions.target(WidgetAction.UPDATE))
        assertEquals(WidgetActions.Target("MainActivity", "kr.or.kptu.work.action.WIDGET_WRITE", "update"), WidgetActions.bigTarget(WidgetAction.UPDATE))
        assertEquals(WidgetActions.Target("QuickWriteActivity", "kr.or.kptu.work.action.WIDGET_QUICK_WRITE", "task"), WidgetActions.target(WidgetAction.TASK))
        assertEquals(WidgetActions.Target("MainActivity", "kr.or.kptu.work.action.WIDGET_WRITE", "task"), WidgetActions.bigTarget(WidgetAction.TASK))
        assertEquals(WidgetActions.Target("QuickWriteActivity", "kr.or.kptu.work.action.WIDGET_QUICK_WRITE", "note"), WidgetActions.target(WidgetAction.NOTE))
        assertEquals(WidgetActions.Target("MainActivity", "kr.or.kptu.work.action.WIDGET_WRITE", "note"), WidgetActions.bigTarget(WidgetAction.NOTE))
        assertEquals(WidgetActions.Target("PhotoPickActivity", "kr.or.kptu.work.action.WIDGET_PHOTO", null), WidgetActions.target(WidgetAction.PHOTO))
        // 녹음은 MTG-폰녹음의 녹음 시작 인텐트 그대로(내보내지 않은 RecordActionActivity).
        assertEquals(WidgetActions.Target("RecordActionActivity", RecordHub.ACTION_START, null), WidgetActions.target(WidgetAction.RECORD))
        assertEquals("kr.or.kptu.work.action.REC_START", RecordHub.ACTION_START)
    }

    @Test
    fun writeAddressAndBridgeMessageOnlyForWriteKinds() {
        assertEquals("https://workonplus.com/work/app/?write=update", WidgetActions.writeUrl(WidgetAction.UPDATE))
        assertEquals("https://workonplus.com/work/app/?write=task", WidgetActions.writeUrl(WidgetAction.TASK))
        assertEquals("https://workonplus.com/work/app/?write=note", WidgetActions.writeUrl(WidgetAction.NOTE))
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
        // S68-13(11/22 사용자): '지금'(.NowWidget)·'아스날'(.ArsenalWidget) 위젯은 쓰지 않아 지웠다.
        assertEquals(setOf(".QuickWidget", ".OneWidget", ".WeekWidget"), receivers.keys)
        val infos = mapOf(".QuickWidget" to "@xml/quick_widget_info", ".OneWidget" to "@xml/one_widget_info", ".WeekWidget" to "@xml/week_widget_info")
        for ((name, r) in receivers) {
            assertEquals("$name exported", "false", attr(r, "exported"))
            assertEquals(infos[name], attr(children(r, "meta-data").single(), "resource"))
        }
        val activities = children(app, "activity").associateBy { attr(it, "name") }
        // 칸이 여는 화면: 사진·녹음은 내보내지 않은 화면, 고르기 창만 홈 화면 앱용으로 내보낸다(설정 동작 하나만).
        assertEquals("false", attr(activities.getValue(".PhotoPickActivity"), "exported"))
        assertEquals("false", attr(activities.getValue(".QuickWriteActivity"), "exported"))
        assertEquals("false", attr(activities.getValue(".RecordActionActivity"), "exported"))
        val config = activities.getValue(".OneWidgetConfigActivity")
        assertEquals("true", attr(config, "exported"))
        val actions = children(config, "action").map { attr(it, "name") }
        assertEquals(listOf("android.appwidget.action.APPWIDGET_CONFIGURE"), actions)
        // S68-13: 아스날 위젯과 함께 그 고르기 창도 지웠다(내보낸 화면이 하나 줄었다).
        assertFalse(activities.containsKey(".ArsenalWidgetConfigActivity"))
        // 위젯은 권한을 늘리지 않았다(카메라 권한 없음). 설치 권한 둘은 앱 스스로 업데이트(0.3.8)용.
        // 사진·동영상 읽기 넷은 사진 메뉴 '폰 사진'(PHOTO-출처 ①, 0.3.9)용 — 저장소 쓰기·위치·카메라는 없다.
        // MANAGE_MEDIA는 사진 [폴더]의 폰 폴더 바꾸기(PHOTO-폴더스위치, 0.4.1)용 — 사용자가 설정에서 켜야만 쓰인다.
        // ACCESS_MEDIA_LOCATION은 사진 [정보 고치기](S48-60, 0.4.15)용 — 사진 안 위치(EXIF)를 가리지 않고 읽고 고친다(기기 위치 아님).
        // MANAGE_EXTERNAL_STORAGE는 [파일] '이 폰'(S49-51, 0.5.0, 사용자 결정 H-1)용 — 설정에서 사용자가 켜야만 쓰인다. 다리는 PhoneFilesRules가 막는다.
        val perms = children(xml("src/main/AndroidManifest.xml"), "uses-permission").map { attr(it, "name") }.toSet()
        assertEquals(
            setOf(
                "android.permission.INTERNET", "android.permission.RECORD_AUDIO", "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_MICROPHONE", "android.permission.POST_NOTIFICATIONS",
                "android.permission.REQUEST_INSTALL_PACKAGES", "android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION",
                "android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO", "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
                "android.permission.READ_EXTERNAL_STORAGE", "android.permission.MANAGE_MEDIA", "android.permission.ACCESS_MEDIA_LOCATION",
                "android.permission.MANAGE_EXTERNAL_STORAGE",
                // S67-38: 뒤에서 올리기 앞쪽 작업 알림(종류 dataSync). 사용자에게 묻지 않는 권한.
                "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
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
    fun oneCellIsSquareInkTileWithLabelBelow() {
        // APP-한칸위젯 A(11/22): 앱 아이콘처럼 정사각 둥근 먹색 칸(가운데) + 흰 그림 + 칸 아래 흰 이름(그림자).
        // S68-11: 칸은 그림 한 장(widget_tile_*)을 fitCenter로(크기 시험은 WidgetTileTest).
        val one = xml("src/main/res/layout/one_widget.xml")
        assertEquals("match_parent", attr(one, "layout_width"))
        assertEquals("match_parent", attr(one, "layout_height"))
        assertEquals("center", attr(one, "gravity"))
        assertEquals("vertical", attr(one, "orientation"))
        assertEquals("", attr(one, "background")) // 바깥은 비움: 먹색은 칸 그림에만.
        // S68-19: 칸은 바깥 LinearLayout 바로 아래 그림 하나(좌우 빈칸 줄 없음, 폭 전부).
        assertTrue(children(one, "LinearLayout").isEmpty())
        val tile = children(one, "ImageView").single()
        assertEquals("@+id/one_tile", attr(tile, "id"))
        assertEquals("fitCenter", attr(tile, "scaleType"))
        assertTrue(attr(tile, "src").startsWith("@drawable/widget_tile_"))
        // 이름은 칸 안이 아니라 칸 아래(바깥 LinearLayout의 직속 자식). 여기 children은 모든 후손을 돌려준다(줄 안 TextView는 좌우 빈칸).
        val label = children(one, "TextView").single { attr(it, "id") == "@+id/one_label" }
        assertEquals(one, label.parentNode)
        assertEquals("@color/widget_one_label", attr(label, "textColor"))
        assertEquals("12sp", attr(label, "textSize"))
        assertTrue(attr(label, "shadowRadius").isNotEmpty())
        // 먹색 하나: 칸 모양 파일은 먹색 토큰, 낮·밤 모두 같은 먹(앱 테마 기본 먹 #22262b).
        for (a in listOf("update", "task", "note", "photo", "record")) {
            assertTrue(a, File("src/main/res/drawable/widget_tile_$a.xml").readText().contains("@color/widget_one_bg"))
        }
        for (p in listOf("src/main/res/values/colors.xml", "src/main/res/values-night/colors.xml")) {
            assertTrue(File(p).readText().contains("<color name=\"widget_one_bg\">#22262B</color>"))
        }
        // 기능마다 칠하던 코드(주황 녹음 등)는 남지 않는다.
        val code = File("src/main/java/kr/or/kptu/work/ActionWidgets.kt").readText()
        assertTrue(!code.contains("widget_btn_warm"))
        assertTrue(!code.contains("\"setBackgroundResource\""))
        assertTrue(!File("src/main/res/drawable/widget_btn_warm.xml").exists())
    }

    @Test
    fun widgetNamesAreNeverRemoved() {
        // 규칙(11/02): 위젯 받는 곳을 지우거나 이름을 바꾸면 홈 화면에 놓인 자리가 '위젯을 추가할 수 없습니다'로 남는다.
        // 모양을 바꿀 때는 같은 이름으로. 이 목록은 늘릴 수만 있다(manifestListsTheWidgets와 함께 고정).
        // 예외: 사용자가 위젯을 쓰지 않기로 정해 지울 때만 뺀다(S68-13, 11/22 '지금'·'아스날'). 놓아 둔 자리는 홈 화면에서 길게 눌러 지운다.
        val manifest = File("src/main/AndroidManifest.xml").readText()
        for (name in listOf(".QuickWidget", ".OneWidget", ".WeekWidget")) {
            assertTrue(name, manifest.contains("android:name=\"$name\""))
        }
        assertTrue(manifest.contains("위젯 받는 곳(receiver)은 지우거나 이름을 바꾸지 않는다"))
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
