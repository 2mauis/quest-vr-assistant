package com.example.questvr.tunnelprobe;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Message;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/** A separate page in the existing APK. Authentication stays inside its WebView profile. */
public final class WebActivity extends Activity {
    private static final int MICROPHONE = 41, FILE_PICKER = 42;
    private final List<WebView> pages = new ArrayList<>();
    private FrameLayout content;
    private TextView address;
    private PermissionRequest pending;
    private WebView permissionOwner;
    private ValueCallback<Uri[]> fileResult;
    private final List<String> suspendedUrls = new ArrayList<>();
    private boolean visible;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    private WebView current() { return pages.isEmpty() ? null : pages.get(pages.size() - 1); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void message(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        LinearLayout bar = new LinearLayout(this);
        addButton(bar, "连接", () -> finish());
        addButton(bar, "返回", this::goBack);
        addButton(bar, "主页", () -> current().loadUrl(WebBuildConfig.START_URL));
        address = new TextView(this);
        address.setSingleLine(true); address.setTextSize(12);
        bar.addView(address, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button menu = addButton(bar, "更多", () -> {});
        menu.setOnClickListener(v -> {
            PopupMenu popup = new PopupMenu(this, menu);
            popup.getMenu().add("刷新").setOnMenuItemClickListener(i -> { current().reload(); return true; });
            popup.getMenu().add("麦克风检查").setOnMenuItemClickListener(i -> { current().loadUrl(WebPolicy.VOICE_CHECK); return true; });
            popup.getMenu().add("在浏览器打开").setOnMenuItemClickListener(i -> {
                String url = current().getUrl();
                if (WebPolicy.origin(url) != null && !WebPolicy.origin(url).equals(WebPolicy.origin(WebPolicy.VOICE_CHECK))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)); }
                    catch (ActivityNotFoundException error) { message("未找到可用浏览器"); }
                }
                return true;
            });
            popup.show();
        });
        root.addView(bar);
        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        WebView page = createPage();
        String last = getPreferences(0).getString("last_page", WebBuildConfig.START_URL);
        page.loadUrl(WebPolicy.rememberedPage(last, WebBuildConfig.START_URL));
    }

    private Button addButton(LinearLayout bar, String title, Runnable action) {
        Button button = new Button(this); button.setText(title); button.setTextSize(12);
        button.setMinWidth(0); button.setMinimumWidth(0);
        button.setPadding(dp(10), 0, dp(10), 0);
        button.setOnClickListener(v -> action.run());
        bar.addView(button, new LinearLayout.LayoutParams(-2, dp(48)));
        return button;
    }

    private WebView createPage() {
        WebView page = new WebView(this);
        WebSettings settings = page.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Only user-selected content URIs from the system picker.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setUseWideViewPort(true); settings.setLoadWithOverviewMode(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(page, true);
        page.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (WebPolicy.origin(request.getUrl().toString()) != null) return false;
                message("此链接需要浏览器或其他应用，请从“更多”打开浏览器");
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (pending != null && permissionOwner == view) cancelPermission();
                if (view == current()) address.setText(WebPolicy.origin(url) == null ? "正在打开…" : Uri.parse(url).getHost());
            }
            @Override public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (view == current() && WebPolicy.origin(url) != null && WebPolicy.origin(url).equals(WebPolicy.origin(WebBuildConfig.START_URL)))
                    getPreferences(0).edit().putString("last_page", WebPolicy.rememberedPage(url, WebBuildConfig.START_URL)).apply();
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); message("网站证书验证失败，请检查网络后重试");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && view == current()) address.setText("页面未加载，请重试");
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!WebPolicy.origin(WebPolicy.VOICE_CHECK).equals(WebPolicy.origin(uri.toString()))) return null;
                try {
                    if (!"GET".equals(request.getMethod()) || !"/".equals(uri.getPath()) || uri.getQuery() != null)
                        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                    return new WebResourceResponse("text/html", "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-store"), getAssets().open("voice-check.html"));
                } catch (Exception error) { return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0])); }
            }
        });
        page.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                if (!visible || page != current() || !WebPolicy.microphoneAllowed(request.getOrigin().toString(), page.getUrl(), WebBuildConfig.START_URL)
                    || !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) { request.deny(); return; }
                cancelPermission();
                pending = request; permissionOwner = page;
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) grantMicrophone();
                else requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MICROPHONE);
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pending == request) { pending = null; permissionOwner = null; }
            }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message result) {
                if (!userGesture || pages.size() >= 4) return false;
                cancelPermission();
                WebView child = createPage();
                ((WebView.WebViewTransport) result.obj).setWebView(child); result.sendToTarget();
                return true;
            }
            @Override public void onCloseWindow(WebView window) { if (window == current() && pages.size() > 1) closePopup(); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (view != current() || !WebPolicy.microphoneAllowed(WebBuildConfig.START_URL, view.getUrl(), WebBuildConfig.START_URL)) {
                    callback.onReceiveValue(null); return true;
                }
                if (fileResult != null) fileResult.onReceiveValue(null);
                fileResult = callback;
                try { startActivityForResult(params.createIntent(), FILE_PICKER); }
                catch (ActivityNotFoundException error) { fileResult = null; callback.onReceiveValue(null); message("设备没有可用文件选择器"); }
                return true;
            }
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreen != null) { callback.onCustomViewHidden(); return; }
                fullscreen = view; fullscreenCallback = callback;
                content.addView(view, new FrameLayout.LayoutParams(-1, -1));
            }
            @Override public void onHideCustomView() { hideFullscreen(); }
        });
        if (current() != null) current().setVisibility(View.GONE);
        pages.add(page); content.addView(page, new FrameLayout.LayoutParams(-1, -1));
        return page;
    }

    private void grantMicrophone() {
        PermissionRequest request = pending; WebView owner = permissionOwner;
        pending = null; permissionOwner = null;
        if (request == null) return;
        if (visible && owner == current() && WebPolicy.microphoneAllowed(request.getOrigin().toString(), owner.getUrl(), WebBuildConfig.START_URL)
            && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        else request.deny();
    }
    private void cancelPermission() {
        PermissionRequest request = pending; pending = null; permissionOwner = null;
        if (request != null) request.deny();
    }
    @Override public void onRequestPermissionsResult(int code, String[] names, int[] results) {
        super.onRequestPermissionsResult(code, names, results);
        if (code == MICROPHONE) {
            if (visible) grantMicrophone();
            else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) cancelPermission();
        }
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != FILE_PICKER || fileResult == null) return;
        ValueCallback<Uri[]> callback = fileResult; fileResult = null;
        Uri[] values = WebChromeClient.FileChooserParams.parseResult(result, data);
        if (values != null) for (Uri uri : values) if (!"content".equals(uri.getScheme())) { values = null; break; }
        callback.onReceiveValue(values);
    }
    private void closePopup() {
        cancelPermission();
        WebView page = pages.remove(pages.size() - 1); content.removeView(page); page.destroy();
        current().setVisibility(View.VISIBLE);
        address.setText(Uri.parse(current().getUrl() == null ? WebBuildConfig.START_URL : current().getUrl()).getHost());
    }
    private void hideFullscreen() {
        if (fullscreen == null) return;
        content.removeView(fullscreen); fullscreen = null;
        WebChromeClient.CustomViewCallback callback = fullscreenCallback; fullscreenCallback = null;
        if (callback != null) callback.onCustomViewHidden();
    }
    private void goBack() {
        if (fullscreen != null) hideFullscreen();
        else if (current().canGoBack()) current().goBack();
        else if (pages.size() > 1) closePopup();
        else finish();
    }
    @Override public void onBackPressed() { goBack(); }
    @Override protected void onStart() {
        super.onStart(); visible = true;
        for (WebView page : pages) page.onResume();
        for (int i = 0; i < suspendedUrls.size() && i < pages.size(); i++) pages.get(i).loadUrl(suspendedUrls.get(i));
        suspendedUrls.clear();
        if (pending != null && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) grantMicrophone();
    }
    @Override protected void onPause() { CookieManager.getInstance().flush(); super.onPause(); }
    @Override protected void onStop() {
        visible = false;
        // The system permission/file picker can temporarily cover the activity.
        // Otherwise unload documents so microphone tracks cannot continue in the background.
        if (pending == null && fileResult == null && current() != null) {
            suspendedUrls.clear();
            for (WebView page : pages) {
                String url = page.getUrl();
                suspendedUrls.add(WebPolicy.origin(url) == null ? WebBuildConfig.START_URL : url);
                page.loadUrl("about:blank");
            }
        }
        for (WebView page : pages) page.onPause();
        super.onStop();
    }
    @Override protected void onDestroy() {
        cancelPermission();
        if (fileResult != null) { fileResult.onReceiveValue(null); fileResult = null; }
        hideFullscreen();
        for (WebView page : pages) { content.removeView(page); page.destroy(); }
        pages.clear(); super.onDestroy();
    }
}
