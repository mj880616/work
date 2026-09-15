package kr.or.kptu.work;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private WebView webView;
    private FrameLayout root;
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1002;
    private static final String HOME = "https://mj880616.github.io/work/app/";
    private static final String INTERNAL_HOST = "mj880616.github.io";
    private static final String APP_VERSION = "0.1.12";
    private boolean firebaseConfigured = false;
    private boolean backDispatchPending = false;
    private Object platformBackCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        initFirebase();

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        root.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(
                0,
                insets.getSystemWindowInsetTop(),
                0,
                insets.getSystemWindowInsetBottom()
            );
            return insets;
        });

        setContentView(root);
        root.requestApplyInsets();
        registerPlatformBackCallback();

        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " KPTUAndroid/" + APP_VERSION);
        WebView.setWebContentsDebuggingEnabled(false);
        webView.addJavascriptInterface(new NativePushBridge(), "KPTUNativePush");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> callback,
                FileChooserParams fileChooserParams
            ) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                Intent intent;
                try {
                    intent = fileChooserParams.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    filePathCallback.onReceiveValue(null);
                    filePathCallback = null;
                    return false;
                }
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (shouldOpenExternal(uri)) {
                    openExternal(uri);
                    return true;
                }
                return false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (shouldOpenExternal(uri)) {
                    openExternal(uri);
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (isInternalAppUri(Uri.parse(url))) installNativeBackBridge(view);
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> openExternal(Uri.parse(url)));
        loadFromIntent(getIntent());
    }

    private void initFirebase() {
        firebaseConfigured = notBlank(BuildConfig.FIREBASE_API_KEY)
            && notBlank(BuildConfig.FIREBASE_APP_ID)
            && notBlank(BuildConfig.FIREBASE_PROJECT_ID)
            && notBlank(BuildConfig.FIREBASE_SENDER_ID);
        if (!firebaseConfigured) return;
        try {
            if (FirebaseApp.getApps(this).isEmpty()) {
                FirebaseOptions options = new FirebaseOptions.Builder()
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build();
                FirebaseApp.initializeApp(this, options);
            }
        } catch (Exception e) {
            firebaseConfigured = false;
        }
    }

    private boolean notBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private boolean notificationPermissionGranted() {
        return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestNativePush() {
        if (!firebaseConfigured) {
            emitPushEvent("error", null, "Firebase 연결정보가 설정되지 않았습니다.");
            return;
        }
        if (!notificationPermissionGranted()) {
            if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
            return;
        }
        requestFirebaseToken();
    }

    private void requestFirebaseToken() {
        if (!firebaseConfigured) return;
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || task.getResult() == null || task.getResult().isEmpty()) {
                emitPushEvent("error", null, "Android 푸시 토큰을 가져오지 못했습니다.");
                return;
            }
            emitPushEvent("token", task.getResult(), null);
        });
    }

    private void disableNativePush() {
        if (!firebaseConfigured) {
            emitPushEvent("disabled", null, null);
            return;
        }
        FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener(task -> emitPushEvent("disabled", null, null));
    }

    private void emitPushEvent(String type, String token, String message) {
        runOnUiThread(() -> {
            if (webView == null) return;
            try {
                JSONObject detail = new JSONObject();
                detail.put("type", type);
                detail.put("appVersion", APP_VERSION);
                if (token != null) detail.put("token", token);
                if (message != null) detail.put("message", message);
                String js = "window.dispatchEvent(new CustomEvent('kptu:native-push',{detail:" + detail.toString() + "}));";
                webView.evaluateJavascript(js, null);
            } catch (Exception ignored) {
            }
        });
    }

    public class NativePushBridge {
        @JavascriptInterface
        public boolean isConfigured() {
            return firebaseConfigured;
        }

        @JavascriptInterface
        public boolean permissionGranted() {
            return notificationPermissionGranted();
        }

        @JavascriptInterface
        public String appVersion() {
            return APP_VERSION;
        }

        @JavascriptInterface
        public void enable() {
            runOnUiThread(() -> requestNativePush());
        }

        @JavascriptInterface
        public void requestToken() {
            runOnUiThread(() -> {
                if (notificationPermissionGranted()) requestFirebaseToken();
                else emitPushEvent("permission-denied", null, null);
            });
        }

        @JavascriptInterface
        public void disable() {
            runOnUiThread(() -> disableNativePush());
        }
    }

    private boolean shouldOpenExternal(Uri uri) {
        if (uri == null) return false;
        if ("1".equals(uri.getQueryParameter("external"))) return true;
        return !("https".equalsIgnoreCase(uri.getScheme()) && INTERNAL_HOST.equalsIgnoreCase(uri.getHost()));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != NOTIFICATION_PERMISSION_REQUEST) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) requestFirebaseToken();
        else emitPushEvent("permission-denied", null, null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            Uri[] results = null;
            if (resultCode == RESULT_OK) results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private String freshHome() {
        return HOME + "?app=" + System.currentTimeMillis();
    }

    private boolean isInternalAppUri(Uri uri) {
        if (uri == null) return false;
        String path = uri.getPath();
        return "https".equalsIgnoreCase(uri.getScheme())
            && INTERNAL_HOST.equalsIgnoreCase(uri.getHost())
            && path != null
            && path.startsWith("/work/app/");
    }

    private void loadFromIntent(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (isInternalAppUri(data)) {
            webView.loadUrl(data.toString());
            return;
        }
        if (data != null && "kptuwork".equalsIgnoreCase(data.getScheme()) && "auth".equalsIgnoreCase(data.getHost())) {
            String payload = data.getQueryParameter("payload");
            if (payload != null && !payload.isEmpty()) {
                webView.loadUrl(freshHome() + "#" + payload);
                return;
            }
            StringBuilder target = new StringBuilder(freshHome());
            if (data.getEncodedFragment() != null && !data.getEncodedFragment().isEmpty()) target.append('#').append(data.getEncodedFragment());
            else if (data.getEncodedQuery() != null && !data.getEncodedQuery().isEmpty()) target.append('&').append(data.getEncodedQuery());
            webView.loadUrl(target.toString());
        } else webView.loadUrl(freshHome());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadFromIntent(intent);
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
        }
    }

    private void installNativeBackBridge(WebView view) {
        if (view == null) return;
        String js = "(function(){try{"
            + "if(window.KPTUNativeBack&&window.KPTUNativeBack.version>=2)return;"
            + "var stack=window.__KPTU_NATIVE_BACK_STACK__||[];window.__KPTU_NATIVE_BACK_STACK__=stack;"
            + "window.__KPTU_NATIVE_BACK_CURRENT__=(window.KPTURouter&&window.KPTURouter.current)||window.__KPTU_NATIVE_BACK_CURRENT__||null;"
            + "if(!window.__KPTU_NATIVE_BACK_BOUND__){window.__KPTU_NATIVE_BACK_BOUND__=true;window.addEventListener('kptu:view-changed',function(e){"
            + "var d=e&&e.detail||{};var next=d.view;if(!next)return;var cur=window.__KPTU_NATIVE_BACK_CURRENT__;"
            + "if(next===cur)return;if(d.source==='native-back'){window.__KPTU_NATIVE_BACK_CURRENT__=next;return;}"
            + "if(d.source==='popstate'){if(stack.length&&stack[stack.length-1]===next)stack.pop();window.__KPTU_NATIVE_BACK_CURRENT__=next;return;}"
            + "if(cur&&['initial','restore','visibility','session'].indexOf(d.source)<0&&stack[stack.length-1]!==cur)stack.push(cur);"
            + "window.__KPTU_NATIVE_BACK_CURRENT__=next;});}"
            + "function visible(el){return !!el&&!el.classList.contains('hidden')&&getComputedStyle(el).display!=='none'&&el.getAttribute('aria-hidden')!=='true';}"
            + "window.KPTUNativeBack={version:2,handle:function(){try{"
            + "var guestBack=document.querySelector('#guestBackBtn');var auth=document.querySelector('#authView');var app=document.querySelector('#appView');"
            + "if(guestBack&&visible(auth)&&(!app||!visible(app))){guestBack.click();return true;}"
            + "var modals=[].slice.call(document.querySelectorAll('.modal')).filter(visible);var modal=modals.length?modals[modals.length-1]:null;"
            + "if(modal){var close=modal.querySelector('[data-close=\"'+modal.id+'\"],[data-pm2-close=\"'+modal.id+'\"],.icon-btn');if(close)close.click();else{modal.classList.add('hidden');modal.setAttribute('aria-hidden','true');}return true;}"
            + "var router=window.KPTURouter;var now=(router&&router.current)||window.__KPTU_NATIVE_BACK_CURRENT__;"
            + "if(router){while(stack.length){var prev=stack.pop();if(prev&&prev!==now&&document.getElementById(prev+'View')){router.go(prev,{source:'native-back',replaceUrl:true});window.__KPTU_NATIVE_BACK_CURRENT__=prev;return true;}}"
            + "if(now&&now!=='home'&&document.getElementById('homeView')){router.go('home',{source:'native-back',replaceUrl:true});window.__KPTU_NATIVE_BACK_CURRENT__='home';return true;}}"
            + "return false;}catch(e){return false;}}};"
            + "}catch(e){}})();";
        view.evaluateJavascript(js, null);
    }

    private void registerPlatformBackCallback() {
        if (Build.VERSION.SDK_INT < 33 || platformBackCallback != null) return;
        platformBackCallback = Api33BackHandler.register(this, this::handleSystemBack);
    }

    private void unregisterPlatformBackCallback() {
        if (Build.VERSION.SDK_INT < 33 || platformBackCallback == null) return;
        Api33BackHandler.unregister(this, platformBackCallback);
        platformBackCallback = null;
    }

    private void handleSystemBack() {
        if (webView == null || backDispatchPending) return;
        backDispatchPending = true;
        String js = "(function(){try{return !!(window.KPTUNativeBack&&window.KPTUNativeBack.handle&&window.KPTUNativeBack.handle());}catch(e){return false;}})();";
        webView.evaluateJavascript(js, value -> {
            backDispatchPending = false;
            if ("true".equals(value)) return;
            if (webView != null && webView.canGoBack()) {
                webView.goBack();
                return;
            }
            // Root back is intentionally consumed. Never finish/move the workspace Activity.
        });
    }

    private static class Api33BackHandler {
        static Object register(MainActivity activity, Runnable action) {
            android.window.OnBackInvokedCallback callback = action::run;
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                callback
            );
            return callback;
        }

        static void unregister(MainActivity activity, Object callback) {
            if (callback instanceof android.window.OnBackInvokedCallback) {
                activity.getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(
                    (android.window.OnBackInvokedCallback) callback
                );
            }
        }
    }

    @Override
    public void onBackPressed() {
        handleSystemBack();
    }

    @Override
    protected void onDestroy() {
        unregisterPlatformBackCallback();
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.removeJavascriptInterface("KPTUNativePush");
            webView.destroy();
        }
        super.onDestroy();
    }
}
