package com.example.questvr.tunnelprobe

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.unit.dp
import com.example.questvr.display.*
import com.meta.spatial.compose.ComposeFeature
import com.meta.spatial.compose.ComposeViewPanelRegistration
import com.meta.spatial.core.*
import com.meta.spatial.isdk.IsdkPanelResize
import com.meta.spatial.runtime.*
import com.meta.spatial.toolkit.*
import com.meta.spatial.vr.VRFeature
import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.cos
import kotlin.math.sin
import kotlinx.coroutines.*

/** A display client for the existing relay, with no MCP or model credentials in this process. */
class WorkspaceActivity : AppSystemActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val client = RelayClient()
    private lateinit var models: ModelStore
    private var connection: Job? = null
    private var ready = false
    private var resumed = false
    private var focused = false
    private var mounted = true
    private var vrReady = false
    private var applied = WorkspaceState()
    private var sceneEntity: Entity? = null
    private var controls: Entity? = null
    private val panels = linkedMapOf<String, PanelRecord>()
    private val byEntity = mutableMapOf<Long, PanelRecord>()
    private val ticks = AtomicLong()
    private var origins: Set<String> = emptySet()

    private class PanelRecord(val entity: Entity, panel: TextPanel) {
        var content by mutableStateOf(panel)
        var revision by mutableLongStateOf(1L)
        val drawn = AtomicLong()
    }

    override fun registerFeatures(): List<SpatialFeature> = listOf(VRFeature(this), ComposeFeature())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        models = ModelStore(cacheDir)
        // Network access goes through ModelStore. The SDK fetcher only accepts its vetted local files.
        NetworkedAssetLoader.init(File(cacheDir, "spatial-assets"), object : AssetFetcher {
            override fun fetchAsset(uri: Uri, destination: File, onSuccess: () -> Unit, onError: (Exception) -> Unit) {
                scope.launch(Dispatchers.IO) {
                    try {
                        require(uri.scheme == "file")
                        val source = File(requireNotNull(uri.path)).canonicalFile
                        require(source.parentFile == models.directory.canonicalFile && source.isFile)
                        source.copyTo(destination, overwrite = true)
                        onSuccess()
                    } catch (error: Exception) { onError(error) }
                }
            }
        })
    }

    override fun onSceneReady() {
        super.onSceneReady()
        scene.setReferenceSpace(ReferenceSpace.LOCAL_FLOOR)
        scene.setViewOrigin(0f, 0f, 0f, 0f)
        scene.setLightingEnvironment(Vector3(.6f), Vector3(2f), Vector3(-1f, 3f, -2f), .3f)
        scene.enablePassthrough(true)
        systemManager.registerSystem(object : SystemBase() {
            override fun execute() { if (canPresent()) ticks.incrementAndGet() }
        })
        controls = Entity.create(listOf(Panel(R.id.workspace_controls),
            Transform(Pose(Vector3(-.95f, 1.55f, 1.35f))), Grabbable(), IsdkPanelResize()))
        ready = true
        reconcile()
    }

    override fun onResume() { super.onResume(); resumed = true; reconcile() }
    override fun onPause() { resumed = false; pauseDisplay(); super.onPause() }
    override fun onVRReady() { super.onVRReady(); vrReady = true; reconcile() }
    override fun onVRPause() { vrReady = false; pauseDisplay(); super.onVRPause() }
    override fun onHMDMounted() { super.onHMDMounted(); mounted = true; reconcile() }
    override fun onHMDUnmounted() { mounted = false; pauseDisplay(); super.onHMDUnmounted() }
    override fun onSessionStateChanged(state: SessionState) {
        super.onSessionStateChanged(state)
        focused = state == SessionState.FOCUSED
        reconcile()
    }

    private fun canPresent() = ready && resumed && vrReady && focused && mounted

    private fun reconcile() {
        if (!canPresent()) { pauseDisplay(); return }
        if (connection?.isActive == true || WorkspaceRuntime.explicitReconnectRequired) return
        val session = DisplaySessionStore(this).load()
        if (session == null) {
            WorkspaceRuntime.status.value = ConnectionStatus("pairing_required", WorkspaceRuntime.engine.lastSeq)
            return
        }
        connection = scope.launch {
            try {
                origins = client.assetOrigins(session.endpoint)
                present(WorkspaceRuntime.engine.state)
                client.run(session, WorkspaceRuntime.engine, { status ->
                    WorkspaceRuntime.status.value = status
                    if (status.phase in setOf("taken_over", "render_failed", "queue_full", "pairing_required")) {
                        WorkspaceRuntime.explicitReconnectRequired = true
                        if (status.phase == "pairing_required") DisplaySessionStore(this@WorkspaceActivity).clear()
                    }
                }, ::present)
            } catch (error: CancellationException) {
                if (error is TimeoutCancellationException) failRendering() else throw error
            } catch (_: Exception) { failRendering() }
        }
    }

    private fun failRendering() {
        WorkspaceRuntime.explicitReconnectRequired = true
        WorkspaceRuntime.status.value = ConnectionStatus("render_failed", WorkspaceRuntime.engine.lastSeq)
    }

    private fun pauseDisplay() {
        connection?.cancel(); connection = null
        client.close()
        if (!WorkspaceRuntime.explicitReconnectRequired && WorkspaceRuntime.status.value.phase != "pairing_required") {
            WorkspaceRuntime.status.value = ConnectionStatus("paused", WorkspaceRuntime.engine.lastSeq)
        }
    }

    private suspend fun present(next: WorkspaceState) = withTimeout(30_000) {
        check(canPresent())
        if (next.scene != applied.scene) {
            val content = next.scene
            var candidate: Entity? = null
            try {
                if (content != null) {
                    val uri = content.preset?.let { Uri.parse("apk:///presets/$it.glb") }
                        ?: models.prepare(requireNotNull(content.modelUrl), origins)
                    ensureActive(); check(canPresent())
                    candidate = Entity.create(listOf(Mesh(uri), Transform(placement(content.placement)),
                        Scale(Vector3(content.placement.scale)), Grabbable(), Visible(false)))
                    val object3d = sceneObject(candidate)
                    object3d.addInputListener(selectionListener(content.preset ?: "model"))
                    candidate.setComponent(Visible(true))
                }
                sceneEntity?.destroy(); sceneEntity = candidate
                applied = applied.copy(scene = content)
            } catch (error: Exception) { candidate?.destroy(); throw error }
        }
        for (id in panels.keys.toList()) {
            if (id !in next.panels) {
                val removed = panels.remove(id)!!
                byEntity.remove(removed.entity.id); removed.entity.destroy()
            }
        }
        for ((id, panel) in next.panels) {
            val old = panels[id]
            if (old == null) {
                val entity = Entity.create()
                val record = PanelRecord(entity, panel)
                panels[id] = record; byEntity[entity.id] = record
                entity.setComponents(Panel(R.id.workspace_content), Transform(placement(panel.placement)),
                    Scale(Vector3(panel.placement.scale)), Grabbable(), IsdkPanelResize())
                sceneObject(entity).addInputListener(selectionListener(id))
            } else if (old.content != panel) {
                old.content = panel; old.revision++
                old.entity.setComponents(Transform(placement(panel.placement)), Scale(Vector3(panel.placement.scale)))
            }
        }
        // Compose must draw the exact revision, then Spatial SDK must advance active frames.
        while (panels.values.any { it.drawn.get() < it.revision }) { check(canPresent()); delay(10) }
        val after = ticks.get() + 2
        while (ticks.get() < after) { check(canPresent()); delay(10) }
        ensureActive(); check(canPresent())
        applied = next
    }

    private suspend fun sceneObject(entity: Entity): SceneObject {
        val future = systemManager.findSystem<SceneObjectSystem>().getSceneObject(entity) ?: error("missing_scene_object")
        return future.awaitReady()
    }

    private fun selectionListener(target: String) = object : InputListener {
        override fun onPointerEvent(receiver: SceneObject, hitInfo: HitInfo, type: Int,
            sourceOfInput: Entity, scrollInfo: Vector2, semanticType: Int) {
            if (canPresent() && type == PointerEventType.Select.id) client.interaction("select", target)
        }
    }

    override fun registerPanels(): List<PanelRegistration> = listOf(
        ComposeViewPanelRegistration(R.id.workspace_controls, composeViewCreator = { _, context ->
            ComposeView(context).apply { setContent { AssistantTheme { Controls() } } }
        }, settingsCreator = { panelSettings(.72f, .62f) }),
        ComposeViewPanelRegistration(R.id.workspace_content, composeViewCreator = { entity, context ->
            ComposeView(context).apply {
                setContent {
                    val record = byEntity[entity.id]
                    if (record != null) {
                        val content = record.content
                        val revision = record.revision
                        AssistantTheme {
                            Surface(Modifier.fillMaxSize().drawWithContent {
                                drawContent(); record.drawn.set(revision)
                            }, shape = MaterialTheme.shapes.large) {
                                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Text(content.title.ifEmpty { "信息" }, style = MaterialTheme.typography.headlineSmall)
                                    HorizontalDivider()
                                    Text(content.text, modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()),
                                        style = MaterialTheme.typography.bodyLarge)
                                    TextButton(onClick = { client.interaction("activate", content.id) }) { Text("选择这块面板") }
                                }
                            }
                        }
                    }
                }
            }
        }, settingsCreator = { panelSettings(1.4f, .7f) })
    )

    private fun panelSettings(width: Float, height: Float) = UIPanelSettings(
        shape = QuadShapeOptions(width = width, height = height), display = DpPerMeterDisplayOptions(),
        style = PanelStyleOptions(themeResourceId = R.style.PanelTheme))

    @Composable private fun Controls() {
        val status by WorkspaceRuntime.status.collectAsState()
        Surface(Modifier.fillMaxSize(), shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Quest Assistant", style = MaterialTheme.typography.headlineSmall)
                Text(statusText(status.phase))
                Text("已呈现序号 ${status.seq}")
                Button(onClick = { BrowserPage.open(this@WorkspaceActivity) }) { Text("打开 Grok 对话") }
                if (WorkspaceRuntime.explicitReconnectRequired) {
                    OutlinedButton(onClick = { WorkspaceRuntime.explicitReconnectRequired = false; reconcile() }) {
                        Text(if (status.phase == "taken_over") "切回此头显" else "重新连接")
                    }
                }
                TextButton(onClick = {
                    pauseDisplay()
                    startActivity(Intent(this@WorkspaceActivity, HomeActivity::class.java))
                    finish()
                }) { Text("连接设置") }
            }
        }
    }

    override fun onSpatialShutdown() {
        ready = false; pauseDisplay(); scope.cancel()
        if (::models.isInitialized) models.close()
        panels.values.forEach { it.entity.destroy() }; panels.clear(); byEntity.clear()
        sceneEntity?.destroy(); sceneEntity = null; controls?.destroy(); controls = null
        super.onSpatialShutdown()
    }
    override fun onDestroy() { pauseDisplay(); scope.cancel(); if (::models.isInitialized) models.close(); super.onDestroy() }
}

private suspend fun <T> CompletableFuture<T>.awaitReady(): T = suspendCancellableCoroutine { continuation ->
    whenComplete { value, failure ->
        if (continuation.isActive) {
            if (failure == null) continuation.resume(value) else continuation.resumeWithException(failure)
        }
    }
}

/** Mirror the web display's right-handed coordinates into the SDK's forward-positive Z space. */
private fun placement(p: Placement): Pose {
    val anchor = DisplayProtocol.anchor(p.anchor)
    val x = Math.toRadians(p.rotation.x.toDouble()) / 2
    val y = Math.toRadians(p.rotation.y.toDouble()) / 2
    val z = Math.toRadians(p.rotation.z.toDouble()) / 2
    val qx = sin(x)*cos(y)*cos(z) + cos(x)*sin(y)*sin(z)
    val qy = cos(x)*sin(y)*cos(z) - sin(x)*cos(y)*sin(z)
    val qz = cos(x)*cos(y)*sin(z) + sin(x)*sin(y)*cos(z)
    val qw = cos(x)*cos(y)*cos(z) - sin(x)*sin(y)*sin(z)
    return Pose(Vector3(anchor.x+p.position.x, anchor.y+p.position.y, -anchor.z-p.position.z),
        Quaternion(qw.toFloat(), -qx.toFloat(), -qy.toFloat(), qz.toFloat()))
}
