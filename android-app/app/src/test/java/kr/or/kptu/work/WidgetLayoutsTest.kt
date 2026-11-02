package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/**
 * APP-죽은위젯: 위젯 화면 틀에는 RemoteViews가 그릴 수 있는 부품만(<View>·<Space> 금지),
 * 새 판 설치 뒤에는 홈의 위젯 5종을 모두 다시 그린다.
 * CI의 android-app/scripts/check-widget-layouts.py와 같은 검사를 단위 시험에서도 한 번 더 한다(릴리스 시험 포함).
 */
class WidgetLayoutsTest {
    private val android = "http://schemas.android.com/apk/res/android"

    private val allowed = setOf(
        "FrameLayout", "LinearLayout", "RelativeLayout", "GridLayout",
        "AnalogClock", "Button", "Chronometer", "ImageButton", "ImageView", "ProgressBar",
        "TextClock", "TextView", "ViewFlipper", "ListView", "GridView", "StackView",
        "AdapterViewFlipper", "ViewStub",
    )

    private fun xml(file: File): Element {
        val f = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        return f.newDocumentBuilder().parse(file).documentElement
    }

    private fun widgetLayouts(): Set<String> {
        val names = mutableSetOf<String>()
        File("src/main/res/xml").listFiles { f -> f.name.endsWith(".xml") }!!.forEach { info ->
            val root = xml(info)
            if (root.tagName != "appwidget-provider") return@forEach
            for (attr in listOf("initialLayout", "previewLayout", "initialKeyguardLayout")) {
                val v = root.getAttributeNS(android, attr)
                if (v.startsWith("@layout/")) names += v.removePrefix("@layout/")
            }
        }
        File("src/main/java").walkTopDown().filter { it.name.endsWith(".kt") }.forEach { kt ->
            val text = kt.readText()
            if ("RemoteViews" in text) Regex("""R\.layout\.([A-Za-z0-9_]+)""").findAll(text).forEach { names += it.groupValues[1] }
        }
        return names
    }

    @Test
    fun widgetLayoutsUseOnlyRemoteViewsParts() {
        val names = widgetLayouts()
        assertTrue("위젯 화면 틀을 찾지 못함", names.size >= 10)
        val bad = mutableListOf<String>()
        for (name in names.sorted()) {
            val files = File("src/main/res").listFiles { f -> f.isDirectory && f.name.startsWith("layout") }!!
                .map { File(it, "$name.xml") }.filter { it.exists() }
            assertTrue("$name 화면 틀 파일 없음", files.isNotEmpty())
            for (file in files) {
                val all = file.let { xml(it) }.let { root ->
                    val list = root.getElementsByTagName("*")
                    listOf(root) + (0 until list.length).map { list.item(it) as Element }
                }
                all.map { it.tagName }.filter { it !in allowed }.forEach { bad += "${file.name}: <$it>" }
            }
        }
        assertEquals("위젯이 그릴 수 없는 부품", emptyList<String>(), bad)
    }

    @Test
    fun repaintCoversEveryWidgetInManifest() {
        val manifest = xml(File("src/main/AndroidManifest.xml"))
        val receivers = manifest.getElementsByTagName("receiver")
        val widgets = (0 until receivers.length).map { receivers.item(it) as Element }
            .filter { r ->
                val actions = r.getElementsByTagName("action")
                (0 until actions.length).any {
                    (actions.item(it) as Element).getAttributeNS(android, "name") == "android.appwidget.action.APPWIDGET_UPDATE"
                }
            }
            .map { it.getAttributeNS(android, "name").removePrefix(".") }
            .toSet()
        assertEquals(5, widgets.size)
        assertEquals(widgets, HomeWidgets.PROVIDERS.map { it.simpleName }.toSet())
    }

    @Test
    fun replacedPackageRepaintsWidgets() {
        val src = File("src/main/java/kr/or/kptu/work/AppUpdater.kt").readText()
        val body = src.substringAfter("fun onReplaced(").substringBefore("\n    fun ")
        assertTrue("새 판 설치 뒤 위젯 다시 그리기", "HomeWidgets.repaintAll(" in body)
    }
}
