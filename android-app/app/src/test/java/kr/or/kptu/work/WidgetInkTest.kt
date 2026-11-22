package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/**
 * APP-위젯먹색 S68-06(11/22): 위젯 5개 먹색 통일. 파랑 강조를 빼고 종이색 바탕 + 먹색 글자·강조(앱 테마 기본 먹),
 * 주황은 요청(widget_req_*)만. 빠른 쓰기 단추는 한 칸 위젯과 같은 먹색 정사각 칸, '지금' 2×2는 다음 일정만.
 */
class WidgetInkTest {
    private val android = "http://schemas.android.com/apk/res/android"

    private fun xml(path: String): Element =
        DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(File(path)).documentElement

    private fun children(parent: Element, tag: String): List<Element> {
        val nodes = parent.childNodes
        return (0 until nodes.length).mapNotNull { nodes.item(it) as? Element }.filter { it.tagName == tag }
    }

    private fun attr(e: Element, name: String): String = e.getAttributeNS(android, name)

    private fun colors(path: String): Map<String, String> {
        val list = xml(path).getElementsByTagName("color")
        return (0 until list.length).map { list.item(it) as Element }.associate { it.getAttribute("name") to it.textContent.trim().uppercase() }
    }

    private val light = colors("src/main/res/values/colors.xml")
    private val night = colors("src/main/res/values-night/colors.xml")

    /** 11/21까지 쓰던 파랑 계열 값(낮·밤). 위젯 색에 하나도 남지 않는다. */
    private val blues = setOf("#2F5E8E", "#23486D", "#E1E8F0", "#E7ECF2", "#332F5E8E", "#8FB3D9", "#C9D6E8", "#263445", "#B8CCE4", "#2A3340", "#408FB3D9")

    @Test
    fun noBlueLeftInWidgetColors() {
        for ((mode, c) in listOf("낮" to light, "밤" to night)) {
            val left = c.filter { it.key.startsWith("widget_") && it.value in blues }
            assertEquals(mode, emptyMap<String, String>(), left)
        }
        // 낮: 강조·글자는 앱 테마 기본 먹, 옅은 칸은 웹 --kptu-primary-soft(#e7e5df). 종이색 바탕은 그대로.
        for (k in listOf("widget_accent", "widget_icon", "widget_tile_ink", "widget_todo_ink", "widget_btn_ink")) assertEquals(k, "#22262B", light[k])
        for (k in listOf("widget_todo_bg", "widget_btn_bg")) assertEquals(k, "#E7E5DF", light[k])
        assertEquals("#F7F5F0", light["widget_bg"])
        // 밤: 먹을 뒤집어 밝은 먹(#f3f1ea), 옅은 칸은 웹 어두운 --kptu-primary-soft(#2e3035).
        for (k in listOf("widget_accent", "widget_icon", "widget_tile_ink", "widget_todo_ink", "widget_btn_ink")) assertEquals(k, "#F3F1EA", night[k])
        for (k in listOf("widget_todo_bg", "widget_btn_bg")) assertEquals(k, "#2E3035", night[k])
        // 주황은 요청만 그대로.
        assertEquals("#F6E4D6", light["widget_req_bg"])
        assertEquals("#8A3F10", light["widget_req_ink"])
        // 오늘 칸: 낮 먹 바탕 + 밝은 글자, 밤은 뒤집음.
        assertEquals("#22262B", light["widget_today_bg"])
        assertEquals("#F3F1EA", light["widget_today_ink"])
        assertEquals("#F3F1EA", night["widget_today_bg"])
        assertEquals("#22262B", night["widget_today_ink"])
        // 낮·밤에 같은 색 이름이 다 있다.
        assertEquals(light.keys, night.keys + setOf("app_icon_bg"))
    }

    @Test
    fun quickWriteButtonsAreInkSquareTilesWithLabelBelow() {
        for ((name, labels) in listOf("quick_widget" to listOf("업데이트", "할 일", "노트", "사진"), "quick_widget_small" to listOf("업데이트", "할 일"))) {
            val root = xml("src/main/res/layout/$name.xml")
            // 종이색 바탕 안에 그리는 위젯이라 이름은 먹색 글자(그림자 없음).
            assertEquals(name, "@drawable/widget_bg", attr(root, "background"))
            val cells = children(root, "LinearLayout")
            assertEquals(name, labels, cells.map { attr(it, "contentDescription") })
            cells.forEachIndexed { i, cell ->
                assertEquals("@+id/quick_cell$i", attr(cell, "id"))
                // 칸 전체는 누를 때 물결만(색 칠한 큰 단추 없음).
                assertEquals("@drawable/widget_day_plain", attr(cell, "background"))
                val tile = children(cell, "FrameLayout").single()
                // 한 칸 위젯과 같은 모양 파일(새로 만들지 않음), 정사각 고정 크기.
                assertEquals("@drawable/widget_one_tile", attr(tile, "background"))
                assertTrue(attr(tile, "layout_width").endsWith("dp"))
                assertEquals(attr(tile, "layout_width"), attr(tile, "layout_height"))
                val icon = children(tile, "ImageView").single()
                assertEquals("@color/widget_one_icon", attr(icon, "tint"))
                assertEquals("center", attr(icon, "layout_gravity"))
                val label = children(cell, "TextView").single()
                assertEquals(labels[i], attr(label, "text"))
                assertEquals("@color/widget_ink", attr(label, "textColor"))
                assertEquals("", attr(label, "shadowRadius"))
            }
            assertFalse(name, File("src/main/res/layout/$name.xml").readText().contains("widget_btn"))
        }
    }

    @Test
    fun nowSmallShowsOnlyNextEvent() {
        // 2×2 틀: 남은 시간(now_left)·시각(now_time)·제목(now_title)과 안내 한 줄만. 요청·챙길 것 숫자 칸은 4×2에만.
        val small = File("src/main/res/layout/now_widget_small.xml").readText()
        for (id in listOf("now_left", "now_time", "now_title", "now_note", "now_refresh", "now_next")) assertTrue(id, small.contains("@+id/$id\""))
        for (id in listOf("now_row_asks", "now_row_todo", "now_row_due", "now_after")) assertFalse(id, small.contains("@+id/$id\""))
        val big = File("src/main/res/layout/now_widget.xml").readText()
        for (id in listOf("now_row_asks", "now_row_todo", "now_row_due", "now_after")) assertTrue(id, big.contains("@+id/$id\""))
        // 크기별 그림(HomeWidgets.sized)은 그대로, 작은 크기에서는 처리할 것 줄을 그리지 않는다.
        val src = File("src/main/java/kr/or/kptu/work/NowWidget.kt").readText()
        assertTrue(src.contains("HomeWidgets.sized(context, R.layout.now_widget_small, R.layout.now_widget, SMALL, LARGE)"))
        val content = src.substringAfter("private fun content(").substringBefore("private fun line(")
        assertTrue(content.indexOf("if (small) return") in 0 until content.indexOf("R.id.now_row_asks"))
    }

    @Test
    fun widgetLayoutsHaveNoHardBlue() {
        val dirs = File("src/main/res").listFiles { f -> f.isDirectory && (f.name.startsWith("layout") || f.name.startsWith("drawable")) }!!
        val bad = dirs.flatMap { d -> d.listFiles { f -> f.name.startsWith("widget") || f.name.startsWith("ic_w_") || f.name.contains("_widget") }!!.toList() }
            .filter { f -> blues.any { f.readText().uppercase().contains(it) } }
            .map { it.name }
        assertEquals(emptyList<String>(), bad)
    }
}
