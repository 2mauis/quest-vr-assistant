package com.example.questvr.tunnelprobe

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.meta.spatial.compose.ComposeFeature
import com.meta.spatial.compose.ComposeViewPanelRegistration
import com.meta.spatial.core.*
import com.meta.spatial.runtime.ReferenceSpace
import com.meta.spatial.runtime.SessionState
import com.meta.spatial.runtime.SystemBase
import com.meta.spatial.toolkit.*
import com.meta.spatial.vr.VRFeature
import java.io.File
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

/**
 * Thin spatial shell: a WebView panel of the web display page, plus the existing
 * Grok Custom Tab window. Kotlin scene rendering is not used here.
 */
class WorkspaceActivity : AppSystemActivity() {
    companion object { const val OPEN_GROK = "com.example.questvr.OPEN_GROK" }

    private var ready = false
    private var resumed = false
    private var mounted = true
    private var vrReady = false
    private var visible = false
    private var pendingGrokOpen = false
    private var layoutOrigin: Pose? = null
    private var controls: Entity? = null
    private var display: Entity? = null
    private var webView: WebView? = null
    private val ticks = AtomicLong()
    private var note by mutableStateOf("网页显示面板会在准备好后出现。")

    override fun registerFeatures() = listOf(
        VRFeature(this, shouldConsumeLeftRightInput = false, handMicrogestureLocomotion = false),
        ComposeFeature(),
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingGrokOpen = intent.getBooleanExtra(OPEN_GROK, false)
        if (BuildConfig.DEBUG) WorkspaceRuntime.debugCommand = { operation ->
            when (operation) {
                "recenter" -> placePanels(force = true)
                "open_grok" -> GrokWindowActivity.open(this)
                "expire_session" -> expireSession()
            }
            writeDebugState()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(OPEN_GROK, false)) {
            pendingGrokOpen = true
            openGrokIfRequested()
        }
    }

    override fun onSceneReady() {
        super.onSceneReady()
        scene.setReferenceSpace(ReferenceSpace.LOCAL_FLOOR)
        scene.setViewOrigin(0f, 0f, 0f, 0f)
        scene.enablePassthrough(true)
        systemManager.registerSystem(object : SystemBase() {
            override fun execute() {
                if (!canPlace()) return
                ticks.incrementAndGet()
                if (layoutOrigin == null) placePanels(force = false)
            }
        })
        ready = true
    }

    override fun onResume() { super.onResume(); resumed = true; webView?.onResume() }
    override fun onPause() { webView?.onPause(); resumed = false; super.onPause() }
    override fun onVRReady() { super.onVRReady(); vrReady = true }
    override fun onVRPause() { vrReady = false; super.onVRPause() }
    override fun onHMDMounted() { super.onHMDMounted(); mounted = true }
    override fun onHMDUnmounted() { mounted = false; super.onHMDUnmounted() }
    override fun onSessionStateChanged(state: SessionState) {
        super.onSessionStateChanged(state)
        visible = state == SessionState.FOCUSED || state == SessionState.VISIBLE
    }

    private fun canPlace() = ready && resumed && vrReady && visible && mounted

    private fun placePanels(force: Boolean) {
        if (!canPlace() || ticks.get() < 3) return
        if (layoutOrigin != null && !force) return
        layoutOrigin = scene.getViewerPose().removePitchAndRoll()
        if (controls == null) {
            controls = Entity.create(listOf(
                Panel(R.id.workspace_controls),
                Transform(rightPose(Vector3(0.15f, 0.42f, 1.45f))),
            ))
        } else controls?.setComponent(Transform(rightPose(Vector3(0.15f, 0.42f, 1.45f))))
        if (display == null) {
            display = Entity.create(listOf(
                Panel(R.id.display_web),
                Transform(rightPose(Vector3(0.95f, 1.15f, 1.65f))),
            ))
        } else display?.setComponent(Transform(rightPose(Vector3(0.95f, 1.15f, 1.65f))))
        if (BuildConfig.DEBUG) Log.i("QvrWorkspace", "layout=web_display_right")
        openGrokIfRequested()
    }

    private fun openGrokIfRequested() {
        if (!pendingGrokOpen) return
        pendingGrokOpen = false
        window.decorView.post { if (!isFinishing) GrokWindowActivity.open(this) }
    }

    private fun rightPose(offset: Vector3): Pose {
        val origin = requireNotNull(layoutOrigin)
        val position = origin * offset
        return Pose(position, Quaternion.fromDirection(position - origin.t))
    }

    private fun displayUrl(): String? {
        val raw = DisplaySessionStore(this).endpoint.trim().trimEnd('/')
        val uri = Uri.parse(raw)
        val host = uri.host ?: return null
        val debugLocal = BuildConfig.DEBUG && uri.scheme == "http" && host == "localhost"
        if ((uri.scheme != "https" && !debugLocal) || uri.userInfo != null) return null
        return "$raw/"
    }

    private fun expireSession() {
        val store = DisplaySessionStore(this)
        store.load()?.takeIf { it.canRefresh() }?.let { store.save(it.copy(expiresAt = 0)) }
        webView?.loadUrl(displayUrl() ?: "about:blank")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createDisplayView(context: Context): WebView {
        val page = WebView(context)
        val settings = page.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.mediaPlaybackRequiresUserGesture = true
        page.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String?) {
                if (!isFinishing) injectSession(view, 0)
            }
        }
        val url = displayUrl()
        if (url == null) {
            note = "显示地址不可用。请在连接页填写 http://localhost 或 https 地址。"
            page.loadUrl("about:blank")
        } else {
            note = "显示页已打开。需要时在面板里配对。"
            page.loadUrl(url)
        }
        webView = page
        return page
    }

    private fun injectSession(view: WebView, attempt: Int) {
        if (isFinishing || attempt > 24 || webView != view) return
        val token = DisplaySessionStore(this).load()?.token ?: return
        if (!token.matches(Regex("^[0-9a-f]{64}$"))) return
        val quoted = JSONObject.quote(token)
        view.evaluateJavascript(
            "(function(){return !!(window.__display&&window.__display.adoptSession&&window.__display.adoptSession($quoted));})()",
        ) { result ->
            if (result != "true" && !isFinishing) view.postDelayed({ injectSession(view, attempt + 1) }, 250)
        }
    }

    override fun registerPanels(): List<PanelRegistration> = listOf(
        ComposeViewPanelRegistration(R.id.workspace_controls, composeViewCreator = { _, context ->
            ComposeView(context).apply { setContent { AssistantTheme { Controls() } } }
        }, settingsCreator = { panelSettings(0.42f, 0.38f) }),
        ComposeViewPanelRegistration(R.id.display_web, composeViewCreator = { _, context ->
            ComposeView(context).apply {
                setContent {
                    AndroidView(factory = { createDisplayView(it) }, modifier = Modifier.fillMaxSize())
                }
            }
        }, settingsCreator = { panelSettings(1.15f, 0.68f) }),
    )

    private fun panelSettings(width: Float, height: Float) = UIPanelSettings(
        shape = QuadShapeOptions(width = width, height = height),
        display = DpPerMeterDisplayOptions(dpPerMeter = 1000f),
        style = PanelStyleOptions(themeResourceId = R.style.PanelTheme),
    )

    @Composable private fun Controls() {
        Surface(Modifier.fillMaxSize(), shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Quest Assistant", style = MaterialTheme.typography.headlineSmall)
                Text("Grok 在旁边的浏览器窗口。三维内容在网页显示面板。")
                Text(note, style = MaterialTheme.typography.bodySmall)
                Button(onClick = { GrokWindowActivity.open(this@WorkspaceActivity) }) { Text("显示 Grok 对话") }
                TextButton(onClick = { placePanels(force = true) }) { Text("收回右侧") }
                TextButton(onClick = {
                    startActivity(Intent(this@WorkspaceActivity, HomeActivity::class.java))
                    finish()
                }) { Text("连接设置") }
            }
        }
    }

    private fun writeDebugState() {
        if (!BuildConfig.DEBUG || !ready) return
        val data = JSONObject()
            .put("captured_at", System.currentTimeMillis())
            .put("ticks", ticks.get())
            .put("display_placed", display != null)
            .put("grok_pending", pendingGrokOpen)
            .put("has_session", DisplaySessionStore(this).load() != null)
        File(cacheDir, "workspace-debug.json").writeText(data.toString())
    }

    override fun onSpatialShutdown() {
        ready = false
        webView?.destroy()
        webView = null
        controls?.destroy()
        display?.destroy()
        controls = null
        display = null
        super.onSpatialShutdown()
    }

    override fun onDestroy() {
        if (BuildConfig.DEBUG) WorkspaceRuntime.debugCommand = null
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}
