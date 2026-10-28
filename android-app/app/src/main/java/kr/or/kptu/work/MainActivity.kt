package kr.or.kptu.work

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceResponse
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray

/**
 * 웹2 폰 앱 껍데기(설계 docs/design/phone-app-v2.md 단계 ①).
 * 화면은 모두 desk.bokdoong.com 웹이다. 앱은 시스템 바 색, 뒤로가기, 로그인 복귀, 바깥 링크, 파일 선택만 맡는다.
 * 단계 ②: 다른 앱의 [공유]로 받은 것을 메모리에 들고 웹 바구니 확인 줄로 넘긴다(ShareIntake, 폰에 저장하지 않음).
 * 앱은 토큰·업무 데이터를 따로 저장하지 않는다. 로그인은 브라우저 탭에서 하고 기존 handoff로 돌아온다.
 */
class MainActivity : ComponentActivity() {
    private lateinit var root: LinearLayout
    private lateinit var webView: WebView
    private lateinit var updateBar: LinearLayout
    private lateinit var updateText: TextView
    private lateinit var updateGet: TextView
    private lateinit var updateClose: TextView

    private var barColor: Int = 0
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var backPending = false
    private var updateUrl: String? = null
    @Volatile private var alive = true

    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        barColor = ContextCompat.getColor(this, R.color.web_bg)

        // targetSdk 35부터 화면 끝까지 그린다. 바 자리는 앱이 비우고 웹 바탕색으로 칠한다.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        @Suppress("DEPRECATION")
        run {
            window.statusBarColor = Color.TRANSPARENT
            window.navigationBarColor = Color.TRANSPARENT
        }
        window.isNavigationBarContrastEnforced = false
        window.isStatusBarContrastEnforced = false

        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        buildUpdateBar()
        webView = WebView(this)
        root.addView(updateBar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(webView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            // 자판이 열리면 자판 높이만큼 웹 화면을 줄인다(웹 interactive-widget=resizes-content).
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
        applyBarColor(barColor)

        setUpWebView()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = handleBack()
        })

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) loadFromIntent(intent)
        if (savedInstanceState == null) checkForUpdate()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWebView() {
        webView.setBackgroundColor(barColor)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportZoom(false)
            setSupportMultipleWindows(false)
            cacheMode = WebSettings.LOAD_DEFAULT
            // 웹은 이 표시로 앱인지 안다(native-google-return.js, native-back-guard.js, google-tasks.js).
            userAgentString = "$userAgentString KPTUAndroid/${BuildConfig.VERSION_NAME}"
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        // 웹2 화면(허용 Origin의 최상위 화면)만 바 색을 알려 줄 수 있다. 다른 사이트에는 이 이름이 보이지 않는다.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            // 단계 ②: 같은 다리로 공유 목록을 묻고(share:get), 다 받았음(share:done)·돌아가기(share:back)를 알린다.
            WebViewCompat.addWebMessageListener(webView, BAR_BRIDGE, ShellRules.ALLOWED_ORIGINS) { _, message, sourceOrigin, isMainFrame, reply ->
                if (!isMainFrame || sourceOrigin.toString() !in ShellRules.ALLOWED_ORIGINS) return@addWebMessageListener
                val data = message.data ?: return@addWebMessageListener
                if (data.startsWith("bar:")) ShellRules.parseColor(data.substring(4))?.let(::applyBarColor)
                else if (data.startsWith("share:")) onShareMessage(data, reply)
            }
        }

        // 웹 서비스 워커(app/sw.js)를 거친 요청도 __share 가로채기가 받도록 같은 규칙을 건다.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)
        ) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(object : ServiceWorkerClientCompat() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                    ShareIntake.serve(request.url.toString(), request.method, applicationContext.contentResolver)
            })
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    val chooser = params.createIntent().addCategory(Intent.CATEGORY_OPENABLE)
                    fileChooser.launch(chooser)
                    true
                } catch (_: Exception) {
                    fileCallback = null
                    callback.onReceiveValue(null)
                    true
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // 화면 안 작은 창(iframe)은 그 자리에서 연다. 최상위 이동만 판정한다.
                if (!request.isForMainFrame) return false
                val url = request.url.toString()
                if (!ShellRules.opensOutside(url)) return false
                openOutside(request.url)
                return true
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                ShareIntake.serve(request.url.toString(), request.method, applicationContext.contentResolver)

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                if (ShellRules.isInternalApp(url)) syncBarColor()
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // 화면 엔진이 죽으면 이 WebView는 다시 쓸 수 없다. 화면을 새로 만든다.
                if (view === webView) recreate()
                return true
            }
        }

        webView.setDownloadListener { url, _, _, _, _ ->
            val uri = Uri.parse(url)
            if (uri.scheme.equals("https", true) || uri.scheme.equals("http", true)) openView(uri)
        }
    }

    private fun loadFromIntent(intent: Intent?) {
        if (ShareIntake.isShare(intent)) {
            deliverShare(intent!!)
            return
        }
        val data = intent?.data?.toString()
        when {
            ShellRules.isAppReturn(data) -> webView.loadUrl(ShellRules.homeForReturn(data))
            ShellRules.isInternalApp(data) -> webView.loadUrl(data!!)
            else -> webView.loadUrl(ShellRules.HOME)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (ShareIntake.isShare(intent)) {
            deliverShare(intent)
            return
        }
        val data = intent.data?.toString()
        // 로그인·캘린더 복귀 또는 웹2 주소일 때만 화면을 바꾼다. 아이콘으로 다시 열면 보던 화면을 그대로 둔다.
        if (ShellRules.isAppReturn(data) || ShellRules.isInternalApp(data)) loadFromIntent(intent)
    }

    /**
     * 공유를 받으면 웹 바구니로 넘긴다. 웹2 화면이 이미 떠 있으면 다시 불러오지 않고 그 화면에 번호만 알리고(arrive),
     * 아니면 ?view=basket&share=<번호>로 연다. 로그인 전이면 로그인 뒤 웹이 빈 번호로 다시 묻는다.
     */
    private fun deliverShare(intent: Intent) {
        val share = ShareIntake.receive(intent, contentResolver, packageName)
        if (share == null) {
            if (!ShellRules.isInternalApp(webView.url)) webView.loadUrl(ShellRules.HOME)
            return
        }
        val target = ShellRules.shareHome(share.id)
        if (!ShellRules.isInternalApp(webView.url)) {
            webView.loadUrl(target)
            return
        }
        webView.evaluateJavascript(ARRIVE_SCRIPT.replace("%ID%", share.id)) { value ->
            if (value != "true") webView.loadUrl(target)
        }
    }

    private fun onShareMessage(data: String, reply: JavaScriptReplyProxy) {
        when (val m = ShellRules.shareMessage(data)) {
            is ShellRules.ShareMessage.Get -> {
                val p = ShareIntake.get(m.id)
                reply.postMessage(if (p == null) "share:none" else "share:list:" + p.json)
            }
            is ShellRules.ShareMessage.Done -> ShareIntake.done(m.id)
            ShellRules.ShareMessage.Back -> moveTaskToBack(true)
            null -> Unit
        }
    }

    override fun onResume() {
        super.onResume()
        if (ShellRules.isInternalApp(webView.url)) syncBarColor()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    /** 바깥 주소: 웹 주소는 앱 위 브라우저 탭(Custom Tab), 전화·메일 등은 그 앱, 그 밖은 열지 않는다. */
    private fun openOutside(uri: Uri) {
        val scheme = uri.scheme?.lowercase() ?: return
        when {
            scheme == "https" || scheme == "http" -> openTab(uri)
            scheme == "kptuwork" -> if (ShellRules.isAppReturn(uri.toString())) webView.loadUrl(ShellRules.homeForReturn(uri.toString()))
            scheme == "intent" -> openIntentUri(uri.toString())
            scheme in ShellRules.OUTSIDE_SCHEMES -> openView(uri)
        }
    }

    private fun openTab(uri: Uri) {
        val colors = CustomTabColorSchemeParams.Builder().setToolbarColor(barColor).setNavigationBarColor(barColor).build()
        try {
            CustomTabsIntent.Builder()
                .setShowTitle(true)
                .setDefaultColorSchemeParams(colors)
                .build()
                .launchUrl(this, uri)
        } catch (_: ActivityNotFoundException) {
            openView(uri)
        }
    }

    private fun openView(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
        }
    }

    /** intent:// 주소는 지정 부품·선택자를 지우고 브라우저에서 열 수 있는 앱으로만 연다. */
    private fun openIntentUri(value: String) {
        val parsed = try {
            Intent.parseUri(value, Intent.URI_INTENT_SCHEME)
        } catch (_: Exception) {
            return
        }
        parsed.component = null
        parsed.selector = null
        parsed.addCategory(Intent.CATEGORY_BROWSABLE)
        try {
            startActivity(parsed)
        } catch (_: ActivityNotFoundException) {
            val fallback = parsed.getStringExtra("browser_fallback_url")
            if (fallback != null && fallback.startsWith("https://")) openTab(Uri.parse(fallback))
        }
    }

    /**
     * 뒤로가기: 웹의 window.KPTUNativeBack.handle()(native-back-guard.js)이 메뉴·창·탭을 차례로 닫는다.
     * 웹이 처리하지 못하면 WebView 기록으로 돌아가고, 그것도 없으면 앱을 끄지 않고 뒤로 보낸다.
     */
    private fun handleBack() {
        if (backPending) return
        backPending = true
        webView.evaluateJavascript(BACK_SCRIPT) { value ->
            backPending = false
            if (value == "true") return@evaluateJavascript
            if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
        }
    }

    /** 웹의 지금 theme-color(계정 테마 바탕)를 읽어 바 색을 맞추고, 바뀌면 알려 주도록 한 번 묶는다. */
    private fun syncBarColor() {
        webView.evaluateJavascript(BAR_SCRIPT) { value ->
            val color = try {
                JSONArray("[$value]").optString(0)
            } catch (_: Exception) {
                null
            }
            ShellRules.parseColor(color)?.let(::applyBarColor)
        }
    }

    private fun applyBarColor(color: Int) {
        barColor = color
        root.setBackgroundColor(color)
        webView.setBackgroundColor(color)
        val light = ShellRules.isLight(color)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
        val ink = if (light) INK_ON_LIGHT else INK_ON_DARK
        updateBar.setBackgroundColor(blend(color, ink, 0.07f))
        updateText.setTextColor(ink)
        updateGet.setTextColor(ink)
        updateClose.setTextColor(blend(ink, color, 0.35f))
    }

    private fun buildUpdateBar() {
        val pad = dp(6)
        updateBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            visibility = View.GONE
            setPadding(dp(12), 0, dp(4), 0)
        }
        updateText = TextView(this).apply { textSize = 12f }
        updateGet = TextView(this).apply {
            text = "받기"
            textSize = 12f
            setPadding(dp(10), pad, dp(10), pad)
            isClickable = true
            isFocusable = true
            minHeight = dp(32)
            gravity = Gravity.CENTER
            setOnClickListener { updateUrl?.let { openView(Uri.parse(it)) } }
        }
        updateClose = TextView(this).apply {
            text = "닫기"
            textSize = 12f
            setPadding(dp(10), pad, dp(10), pad)
            isClickable = true
            isFocusable = true
            minHeight = dp(32)
            gravity = Gravity.CENTER
            setOnClickListener { updateBar.visibility = View.GONE }
        }
        updateBar.addView(updateText, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        updateBar.addView(updateGet)
        updateBar.addView(updateClose)
    }

    private fun checkForUpdate() {
        val current = BuildConfig.VERSION_NAME
        Thread {
            val found = UpdateCheck.fetch(current) ?: return@Thread
            runOnUiThread {
                if (!alive) return@runOnUiThread
                updateUrl = found.url
                updateText.text = "앱 새 버전 ${found.version}"
                updateBar.visibility = View.VISIBLE
            }
        }.apply { isDaemon = true }.start()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density + 0.5f).toInt()

    private fun blend(from: Int, to: Int, ratio: Float): Int {
        fun mix(a: Int, b: Int) = (a + (b - a) * ratio).toInt().coerceIn(0, 255)
        return Color.rgb(
            mix(Color.red(from), Color.red(to)),
            mix(Color.green(from), Color.green(to)),
            mix(Color.blue(from), Color.blue(to)),
        )
    }

    override fun onDestroy() {
        alive = false
        // 앱을 닫으면 공유로 받은 것도 버린다(폰에 보관하지 않음, D6). 화면 다시 만들기(다크 전환 등)에는 유지한다.
        if (isFinishing) ShareIntake.clear()
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        webView.stopLoading()
        (webView.parent as? LinearLayout)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val BAR_BRIDGE = "KPTUAppShell"
        val INK_ON_LIGHT = Color.rgb(0x2b, 0x2a, 0x26)
        val INK_ON_DARK = Color.rgb(0xe8, 0xe6, 0xdf)

        // %ID%는 ShellRules.isShareId를 통과한 값([A-Za-z0-9_-])만 들어간다.
        const val ARRIVE_SCRIPT =
            "(function(){try{return !!(window.KPTUShareIntake&&window.KPTUShareIntake.arrive('%ID%'));}catch(e){return false;}})();"

        const val BACK_SCRIPT =
            "(function(){try{return !!(window.KPTUNativeBack&&window.KPTUNativeBack.handle&&window.KPTUNativeBack.handle());}catch(e){return false;}})();"

        // theme-color meta는 topbar-actions.js의 syncThemeColor가 계정 테마 바탕으로 맞춘다. 그 값만 읽는다.
        const val BAR_SCRIPT = "(function(){try{" +
            "var read=function(){try{var dark=!!(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);" +
            "var m=document.querySelector('meta[name=\"theme-color\"][media=\"(prefers-color-scheme: '+(dark?'dark':'light')+')\"]')||document.querySelector('meta[name=\"theme-color\"]');" +
            "return (m&&m.getAttribute('content'))||'';}catch(e){return '';}};" +
            "var post=function(){var c=read();try{if(c&&window.$BAR_BRIDGE&&window.$BAR_BRIDGE.postMessage)window.$BAR_BRIDGE.postMessage('bar:'+c);}catch(e){}return c;};" +
            "if(!window.__KPTU_SHELL_BAR__){window.__KPTU_SHELL_BAR__=true;" +
            "var mo=new MutationObserver(post);document.querySelectorAll('meta[name=\"theme-color\"]').forEach(function(m){mo.observe(m,{attributes:true,attributeFilter:['content']});});" +
            "if(window.matchMedia){var q=matchMedia('(prefers-color-scheme: dark)');if(q.addEventListener)q.addEventListener('change',post);}}" +
            "return read();}catch(e){return '';}})();"
    }
}
