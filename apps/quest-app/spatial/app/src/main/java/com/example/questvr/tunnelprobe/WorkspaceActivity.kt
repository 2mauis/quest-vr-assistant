package com.example.questvr.tunnelprobe

import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
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
import com.example.questvr.display.DisplayEndpoint
import com.example.questvr.display.DisplaySession
import com.meta.spatial.compose.ComposeFeature
import com.meta.spatial.compose.ComposeViewPanelRegistration
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Pose
import com.meta.spatial.core.Quaternion
import com.meta.spatial.core.SystemBase
import com.meta.spatial.core.Vector3
import com.meta.spatial.runtime.ReferenceSpace
import com.meta.spatial.runtime.SessionState
import com.meta.spatial.toolkit.AppSystemActivity
import com.meta.spatial.toolkit.DpPerMeterDisplayOptions
import com.meta.spatial.toolkit.Panel
import com.meta.spatial.toolkit.PanelRegistration
import com.meta.spatial.toolkit.PanelStyleOptions
import com.meta.spatial.toolkit.QuadShapeOptions
import com.meta.spatial.toolkit.Transform
import com.meta.spatial.toolkit.UIPanelSettings
import com.meta.spatial.toolkit.ViewPanelRegistration
import com.meta.spatial.vr.VRFeature
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/**
 * Thin spatial shell: one WebView panel with the web display page beside a small control
 * panel, plus the Grok Custom Tab window. The page renders; this Activity only places
 * panels and keeps the display session fresh.
 */
class WorkspaceActivity : AppSystemActivity() {
    private val scope = MainScope()
    private val store by lazy { DisplaySessionStore(this) }
    private val displayHost by lazy { FrameLayout(this) }
    private var display: DisplayWebView? = null
    private var keeper: Job? = null

    private var sceneReady = false
    private var resumed = false
    private var mounted = true
    private var vrReady = false
    private var visible = false
    private var pendingGrokOpen = false
    private var sceneTicks = 0L
    private var layoutOrigin: Pose? = null
    private var controlsEntity: Entity? = null
    private var displayEntity: Entity? = null
    private var note by mutableStateOf("网页显示面板会在准备好后出现。")
    private val debugCommand: (String) -> Unit = ::runDebugCommand

    override fun registerFeatures() =
        listOf(
            VRFeature(this, shouldConsumeLeftRightInput = false, handMicrogestureLocomotion = false),
            ComposeFeature(),
        )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingGrokOpen = intent.getBooleanExtra(OPEN_GROK, false)
        if (BuildConfig.DEBUG) WorkspaceDebugHook.command = debugCommand
        scope.launch { openDisplay() }
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
        systemManager.registerSystem(
            object : SystemBase() {
                override fun execute() {
                    if (!canPlace()) return
                    sceneTicks++
                    if (layoutOrigin == null) placePanels(force = false)
                }
            },
        )
        sceneReady = true
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        display?.onResume()
    }

    override fun onPause() {
        display?.onPause()
        resumed = false
        super.onPause()
    }

    override fun onVRReady() {
        super.onVRReady()
        vrReady = true
    }

    override fun onVRPause() {
        vrReady = false
        super.onVRPause()
    }

    override fun onHMDMounted() {
        super.onHMDMounted()
        mounted = true
    }

    override fun onHMDUnmounted() {
        mounted = false
        super.onHMDUnmounted()
    }

    override fun onSessionStateChanged(state: SessionState) {
        super.onSessionStateChanged(state)
        visible = state == SessionState.FOCUSED || state == SessionState.VISIBLE
    }

    override fun registerPanels(): List<PanelRegistration> =
        listOf(
            ComposeViewPanelRegistration(
                R.id.workspace_controls,
                composeViewCreator = { _, context ->
                    ComposeView(context).apply { setContent { AssistantTheme { Controls() } } }
                },
                settingsCreator = { panelSettings(width = 0.42f, height = 0.38f) },
            ),
            ViewPanelRegistration(
                R.id.display_web,
                { _, _ -> displayHost.also(::detach) },
                { panelSettings(width = 1.15f, height = 0.68f) },
            ),
        )

    override fun onSpatialShutdown() {
        sceneReady = false
        releaseDisplay()
        controlsEntity?.destroy()
        displayEntity?.destroy()
        controlsEntity = null
        displayEntity = null
        super.onSpatialShutdown()
    }

    override fun onDestroy() {
        if (WorkspaceDebugHook.command === debugCommand) WorkspaceDebugHook.command = null
        releaseDisplay()
        super.onDestroy()
    }

    private suspend fun openDisplay() {
        val endpoint =
            try {
                DisplayEndpoint.parse(store.endpointText(), allowLocal = BuildConfig.DEBUG)
            } catch (_: IllegalArgumentException) {
                note = "显示地址不可用。请在连接设置里填写 https 地址（调试版可用 http://localhost）。"
                return
            }
        val page = DisplayWebView(this, endpoint, displayHost)
        display = page
        page.load()
        val session = store.load()
        if (session == null || session.endpoint != endpoint) {
            note = "显示页已打开。需要时在面板里配对。"
            return
        }
        note = "显示页已打开，正在接入已配对的会话。"
        keepSession(session)
    }

    /** Hands the page a live token and keeps renewing it until pairing is required. */
    private fun keepSession(session: DisplaySession) {
        keeper?.cancel()
        if (session.expiresAt > System.currentTimeMillis()) display?.offer(session.token)
        keeper =
            scope.launch {
                DisplayServices.sessionKeeper().keep(session) { renewed ->
                    store.save(renewed)
                    display?.offer(renewed.token)
                }
                store.clear()
                note = "显示授权已失效，请在连接设置里重新配对。"
            }
    }

    private fun releaseDisplay() {
        scope.cancel()
        display?.destroy()
        display = null
    }

    private fun canPlace() = sceneReady && resumed && vrReady && visible && mounted

    private fun placePanels(force: Boolean) {
        if (!canPlace() || sceneTicks < SETTLE_TICKS) return
        if (layoutOrigin != null && !force) return
        val origin = scene.getViewerPose().removePitchAndRoll()
        layoutOrigin = origin
        controlsEntity = place(controlsEntity, R.id.workspace_controls, facing(origin, CONTROLS_OFFSET))
        displayEntity = place(displayEntity, R.id.display_web, facing(origin, DISPLAY_OFFSET))
        if (BuildConfig.DEBUG) Log.i(TAG, "layout=web_display_right")
        openGrokIfRequested()
    }

    private fun place(
        entity: Entity?,
        panel: Int,
        pose: Pose,
    ): Entity {
        if (entity == null) return Entity.create(listOf(Panel(panel), Transform(pose)))
        entity.setComponent(Transform(pose))
        return entity
    }

    private fun facing(
        origin: Pose,
        offset: Vector3,
    ): Pose {
        val position = origin * offset
        return Pose(position, Quaternion.fromDirection(position - origin.t))
    }

    private fun openGrokIfRequested() {
        if (!pendingGrokOpen) return
        pendingGrokOpen = false
        window.decorView.post { if (!isFinishing && !isDestroyed) GrokWindowActivity.open(this) }
    }

    private fun panelSettings(
        width: Float,
        height: Float,
    ) = UIPanelSettings(
        shape = QuadShapeOptions(width = width, height = height),
        display = DpPerMeterDisplayOptions(dpPerMeter = 1000f),
        style = PanelStyleOptions(themeResourceId = R.style.PanelTheme),
    )

    @Composable
    private fun Controls() {
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

    private fun runDebugCommand(operation: String) {
        when (operation) {
            "recenter" -> placePanels(force = true)
            "open_grok" -> GrokWindowActivity.open(this)
            "expire_session" -> scope.launch { expireSession() }
        }
        scope.launch { writeDebugState() }
    }

    /** Debug only: forces the renewal path that a long-lived workspace would take. */
    private suspend fun expireSession() {
        val session = store.load()?.takeIf { it.canRefresh(System.currentTimeMillis()) } ?: return
        val expired = session.copy(expiresAt = 0)
        store.save(expired)
        keepSession(expired)
    }

    private suspend fun writeDebugState() {
        if (!sceneReady) return
        val data =
            JSONObject()
                .put("captured_at", System.currentTimeMillis())
                .put("ticks", sceneTicks)
                .put("display_placed", displayEntity != null)
                .put("grok_pending", pendingGrokOpen)
                .put("has_session", store.load() != null)
                .put("keeping_session", keeper?.isActive == true)
        withContext(Dispatchers.IO) { File(cacheDir, "workspace-debug.json").writeText(data.toString()) }
    }

    companion object {
        const val OPEN_GROK = "com.example.questvr.OPEN_GROK"
        private const val TAG = "QvrWorkspace"
        private const val SETTLE_TICKS = 3
        private val CONTROLS_OFFSET = Vector3(0.15f, 0.42f, 1.45f)
        private val DISPLAY_OFFSET = Vector3(0.95f, 1.15f, 1.65f)

        private fun detach(view: View) {
            (view.parent as? ViewGroup)?.removeView(view)
        }
    }
}
