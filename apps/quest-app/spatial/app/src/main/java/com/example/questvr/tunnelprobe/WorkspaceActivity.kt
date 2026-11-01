package com.example.questvr.tunnelprobe

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
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
import com.meta.spatial.isdk.*
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
import org.json.JSONArray
import org.json.JSONObject

/** A display client for the existing relay, with no MCP or model credentials in this process. */
class WorkspaceActivity : AppSystemActivity() {
    companion object { const val OPEN_GROK = "com.example.questvr.OPEN_GROK" }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val client = RelayClient()
    private lateinit var models: ModelStore
    private var connection: Job? = null
    private var ready = false
    private var resumed = false
    private var focused by mutableStateOf(false)
    private var visible = false
    private var pendingGrokOpen = false
    private var layoutOrigin: Pose? = null
    private var mounted = true
    private var vrReady = false
    private var applied = WorkspaceState()
    private var sceneEntity: Entity? = null
    private var sceneBaseScale = .18f
    private var controls: Entity? = null
    private val panels = linkedMapOf<String, PanelRecord>()
    private val byEntity = mutableMapOf<Long, PanelRecord>()
    private val ticks = AtomicLong()
    private val grabStates = mutableMapOf<Long, IsdkGrabState>()
    private val inputStates = mutableMapOf<Long, String>()
    private val inputEvents = ArrayDeque<JSONObject>()
    private var origins: Set<String> = emptySet()

    private class PanelRecord(val entity: Entity, panel: TextPanel) {
        var content by mutableStateOf(panel)
        var revision by mutableLongStateOf(1L)
        val drawn = AtomicLong()
    }

    override fun registerFeatures(): List<SpatialFeature> = listOf(
        VRFeature(this, shouldConsumeLeftRightInput = false, handMicrogestureLocomotion = false), ComposeFeature())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingGrokOpen = intent.getBooleanExtra(OPEN_GROK, false)
        models = ModelStore(cacheDir)
        if (BuildConfig.DEBUG) WorkspaceRuntime.debugCommand = { operation ->
            when (operation) {
                "recenter" -> if (canPresent()) resetRightLayout()
                "open_grok" -> if (canPresent()) GrokWindowActivity.open(this)
                "expire_session" -> {
                    val store = DisplaySessionStore(this)
                    store.load()?.takeIf { it.canRefresh() }?.let {
                        store.save(it.copy(expiresAt = 0)); pauseDisplay(); reconcile()
                    }
                }
            }
            writeDebugState()
        }
        scope.launch {
            WorkspaceRuntime.connectionAllowed.collect { allowed -> if (allowed) reconcile() else pauseDisplay() }
        }
        if (BuildConfig.DEBUG) scope.launch {
            WorkspaceRuntime.status.collect { status ->
                Log.i("QvrWorkspace", "phase=${status.phase} seq=${status.seq} panels=${WorkspaceRuntime.engine.state.panels.size}")
            }
        }
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
            override fun execute() {
                if (!canPresent()) return
                ticks.incrementAndGet()
                if (layoutOrigin == null) reconcile()
                if (BuildConfig.DEBUG) {
                    for (entity in Query.where { has(Controller.id) }.eval()) {
                        val input = entity.getComponent<Controller>()
                        val value = "${input.type}:${input.isActive}:${input.buttonState}:${input.laserEnabled}"
                        if (inputStates.put(entity.id, value) != value) recordInput(
                            JSONObject().put("source", entity.id).put("kind", "device")
                                .put("type", input.type.toString()).put("active", input.isActive)
                                .put("buttons", input.buttonState).put("laser", input.laserEnabled))
                    }
                    val entities = listOfNotNull(controls, sceneEntity) + panels.values.map { it.entity }
                    grabStates.keys.retainAll(entities.map { it.id }.toSet())
                    for (entity in entities) {
                        val state = entity.tryGetComponent<IsdkGrabbable>()?.grabState ?: continue
                        val previous = grabStates.put(entity.id, state)
                        if (previous != null && previous != state) {
                            Log.i("QvrWorkspace", "grab entity=${entity.id} state=$state")
                            recordInput(JSONObject().put("kind", "grab").put("target", entity.id).put("state", state.toString()))
                        }
                    }
                }
            }
        })
        ready = true
        reconcile()
    }

    override fun onResume() { super.onResume(); resumed = true; reconcile() }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(OPEN_GROK, false)) { pendingGrokOpen = true; reconcile() }
    }
    override fun onPause() { resumed = false; pauseDisplay(); super.onPause() }
    override fun onVRReady() { super.onVRReady(); vrReady = true; reconcile() }
    override fun onVRPause() { vrReady = false; pauseDisplay(); super.onVRPause() }
    override fun onHMDMounted() { super.onHMDMounted(); mounted = true; reconcile() }
    override fun onHMDUnmounted() { mounted = false; pauseDisplay(); super.onHMDUnmounted() }
    override fun onSessionStateChanged(state: SessionState) {
        super.onSessionStateChanged(state)
        focused = state == SessionState.FOCUSED
        visible = focused || state == SessionState.VISIBLE
        if (BuildConfig.DEBUG) Log.i("QvrWorkspace", "xr=$state resumed=$resumed mounted=$mounted ready=$vrReady")
        reconcile()
    }

    private fun canPresent() = ready && resumed && vrReady && visible && mounted

    private fun reconcile() {
        if (!canPresent()) { pauseDisplay(); return }
        if (layoutOrigin == null) {
            // Lifecycle callbacks can precede tracked frames. Anchor only after the viewer pose is live.
            if (ticks.get() < 3) return
            layoutOrigin = scene.getViewerPose().removePitchAndRoll()
            controls = Entity.create(listOf(Panel(R.id.workspace_controls),
                Transform(rightPose(Vector3(.87f, .72f, 1.55f))), IsdkGrabbable(),
                IsdkPanelGrabHandle(), resizeOptions()))
            if (BuildConfig.DEBUG) Log.i("QvrWorkspace", "layout=viewer_right controls_width=0.42 panel_width=0.48")
        }
        // Opening Grok must enter the workspace too, even when pairing needs attention.
        // Keep its status / connection controls visible instead of leaving only the website open.
        if (pendingGrokOpen) {
            pendingGrokOpen = false
            window.decorView.post { if (!isFinishing) GrokWindowActivity.open(this) }
        }
        if (!WorkspaceRuntime.connectionAllowed.value || connection?.isActive == true || WorkspaceRuntime.explicitReconnectRequired) return
        val session = DisplaySessionStore(this).load()
        if (session == null) {
            WorkspaceRuntime.status.value = ConnectionStatus("pairing_required", WorkspaceRuntime.engine.lastSeq)
            return
        }
        connection = scope.launch {
            try {
                origins = client.assetOrigins(session.endpoint) {
                    WorkspaceRuntime.status.value = ConnectionStatus("reconnecting", WorkspaceRuntime.engine.lastSeq)
                }
                present(WorkspaceRuntime.engine.state)
                client.run(session, WorkspaceRuntime.engine, { status ->
                    WorkspaceRuntime.status.value = status
                    if (status.phase in setOf("taken_over", "render_failed", "queue_full", "pairing_required")) {
                        WorkspaceRuntime.explicitReconnectRequired = true
                        if (status.phase == "pairing_required") DisplaySessionStore(this@WorkspaceActivity).clear()
                    }
                }, onSessionRenewed = { DisplaySessionStore(this@WorkspaceActivity).save(it) }, present = ::present)
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
                    candidate = Entity.create(listOf(Mesh(uri), Transform(contentPose(content.placement, -1)),
                        Scale(Vector3(.18f)), Visible(false)))
                    val object3d = sceneObject(candidate)
                    val bounds = requireNotNull(object3d.mesh) { "missing_model_mesh" }.computeCombinedBounds()
                    val size = bounds.size()
                    val longest = maxOf(size.x, size.y, size.z)
                    require(longest.isFinite() && longest > .0001f) { "invalid_model_bounds" }
                    sceneBaseScale = .25f / longest
                    candidate.setComponents(Scale(Vector3(sceneBaseScale * content.placement.scale)),
                        IsdkGrabbable(), IsdkBoxCollider(size, bounds.center()),
                        IsdkGrabConstraints(maxGrabbers = 2, scaleMinMax = Vector2(sceneBaseScale * .5f, sceneBaseScale * 4f)))
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
                entity.setComponents(Panel(R.id.workspace_content), Transform(contentPose(panel.placement, panels.keys.indexOf(id))),
                    Scale(Vector3(panel.placement.scale)), IsdkGrabbable(), IsdkPanelGrabHandle(), resizeOptions())
                sceneObject(entity).addInputListener(selectionListener(id))
            } else if (old.content != panel) {
                val placementChanged = old.content.placement != panel.placement
                old.content = panel; old.revision++
                // Text-only updates retain the user's grabbed position and chosen size.
                if (placementChanged) {
                    old.entity.setComponents(Transform(contentPose(panel.placement, panels.keys.indexOf(id))), Scale(Vector3(panel.placement.scale)))
                }
            }
        }
        // Compose must draw the exact revision, then Spatial SDK must advance active frames.
        while (panels.values.any { it.drawn.get() < it.revision }) { check(canPresent()); delay(10) }
        val after = ticks.get() + 2
        while (ticks.get() < after) { check(canPresent()); delay(10) }
        ensureActive(); check(canPresent())
        applied = next
        if (BuildConfig.DEBUG) Log.i("QvrWorkspace", "present panels=${panels.size} scene=${next.scene != null} tick=${ticks.get()}")
    }

    private suspend fun sceneObject(entity: Entity): SceneObject {
        val future = systemManager.findSystem<SceneObjectSystem>().getSceneObject(entity) ?: error("missing_scene_object")
        return future.awaitReady()
    }

    private fun selectionListener(target: String) = object : InputListener {
        override fun onPointerEvent(receiver: SceneObject, hitInfo: HitInfo, type: Int,
            sourceOfInput: Entity, scrollInfo: Vector2, semanticType: Int) {
            if (BuildConfig.DEBUG && type != PointerEventType.Move.id) recordInput(
                JSONObject().put("kind", "pointer").put("target", target).put("source", sourceOfInput.id)
                    .put("event", PointerEventType.entries.firstOrNull { it.id == type }?.name ?: type.toString())
                    .put("source_type", sourceOfInput.tryGetComponent<Controller>()?.type?.toString()))
            if (canPresent() && focused && type == PointerEventType.Select.id) client.interaction("select", target)
        }
    }

    override fun registerPanels(): List<PanelRegistration> = listOf(
        ComposeViewPanelRegistration(R.id.workspace_controls, composeViewCreator = { _, context ->
            ComposeView(context).apply { setContent { AssistantTheme { Controls() } } }
        }, settingsCreator = { panelSettings(.42f, .38f) }),
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
                                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(content.title.ifEmpty { "信息" }, style = MaterialTheme.typography.headlineSmall)
                                    HorizontalDivider()
                                    Text(content.text, modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()),
                                        style = MaterialTheme.typography.bodyLarge)
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        TextButton(onClick = { resizeEntity(record.entity, .8f) }) { Text("缩小") }
                                        TextButton(onClick = { resizeEntity(record.entity, 1.25f) }) { Text("放大") }
                                        TextButton(onClick = { client.interaction("activate", content.id) }) { Text("选择") }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }, settingsCreator = { panelSettings(.48f, .32f) })
    )

    private fun panelSettings(width: Float, height: Float) = UIPanelSettings(
        shape = QuadShapeOptions(width = width, height = height), display = DpPerMeterDisplayOptions(dpPerMeter = 1000f),
        style = PanelStyleOptions(themeResourceId = R.style.PanelTheme))

    private fun resizeOptions() = IsdkPanelResize(resizeMode = ResizeMode.Simple,
        minDimensions = Vector2(.24f, .16f), maxDimensions = Vector2(1.5f, 1f), preserveAspectRatio = true)

    private fun resizeEntity(entity: Entity, factor: Float, minimum: Float = .5f, maximum: Float = 3f) {
        val current = entity.tryGetComponent<Scale>()?.scale?.x ?: 1f
        entity.setComponent(Scale(Vector3((current * factor).coerceIn(minimum, maximum))))
        if (BuildConfig.DEBUG) Log.i("QvrWorkspace", "resize entity=${entity.id} scale=${entity.getComponent<Scale>().scale.x}")
    }

    private fun rightPose(offset: Vector3): Pose {
        val origin = requireNotNull(layoutOrigin)
        val position = origin * offset
        // Compose quad layers face local -Z. Their +Z axis must point away from the viewer.
        return Pose(position, Quaternion.fromDirection(position - origin.t))
    }

    private fun contentPose(requested: Placement, slot: Int): Pose {
        val offset = placement(requested)
        // Keep the compact workspace above the right edge of the wide system web window.
        val base = if (slot < 0) Vector3(.87f, 1.10f, 1.55f)
            else Vector3(.35f + .55f * (slot % 2), .72f + .38f * (slot / 2), 1.55f)
        val result = rightPose(base + Vector3(offset.t.x * .15f, (offset.t.y - 1.2f) * .15f, (offset.t.z - 1.2f) * .15f))
        result.q = result.q * offset.q
        return result
    }

    private fun resetRightLayout() {
        layoutOrigin = scene.getViewerPose().removePitchAndRoll()
        controls?.setComponent(Transform(rightPose(Vector3(.87f, .72f, 1.55f))))
        panels.values.forEachIndexed { index, record ->
            record.entity.setComponents(Transform(contentPose(record.content.placement, index)), Scale(Vector3(1f)))
        }
        applied.scene?.let { content -> sceneEntity?.setComponent(Transform(contentPose(content.placement, -1))) }
    }

    private fun recordInput(event: JSONObject) {
        if (!BuildConfig.DEBUG) return
        if (inputEvents.size >= 64) inputEvents.removeFirst()
        inputEvents.addLast(event.put("at", System.currentTimeMillis()).put("focused", focused))
    }

    @OptIn(SpatialSDKExperimentalAPI::class)
    private fun writeDebugState() {
        if (!BuildConfig.DEBUG || !ready) return
        val viewer = scene.getViewerPose()
        fun vector(value: Vector3) = JSONArray(listOf(value.x, value.y, value.z))
        fun pose(value: Pose) = JSONObject().put("position", vector(value.t))
            .put("rotation", JSONArray(listOf(value.q.w, value.q.x, value.q.y, value.q.z)))
        fun record(entity: Entity) = JSONObject().put("id", entity.id)
            .put("pose", pose(entity.getComponent<Transform>().transform))
            .put("viewer_relative", vector(viewer.inverse() * entity.getComponent<Transform>().transform.t))
            .put("scale", entity.tryGetComponent<Scale>()?.scale?.x ?: 1f)
            .put("grab", entity.tryGetComponent<IsdkGrabbable>()?.grabState?.toString())
            .put("grab_enabled", entity.tryGetComponent<IsdkGrabbable>()?.enabled)
            .put("panel_dimensions", entity.tryGetComponent<IsdkPanelDimensions>()?.dimensions?.let { JSONArray(listOf(it.x, it.y)) })
            .put("panel_offset", entity.tryGetComponent<IsdkPanelDimensions>()?.localOffset?.let { JSONArray(listOf(it.x, it.y)) })
        fun controllerPose(left: Boolean): JSONObject {
            val value = scene.getControllerPoseAtTime(left, SystemClock.elapsedRealtimeNanos())
            return JSONObject().put("flags", value.flags).put("pose", pose(value.pose))
        }
        val data = JSONObject().put("captured_at", System.currentTimeMillis()).put("ticks", ticks.get())
            .put("ready", ready).put("resumed", resumed).put("visible", visible)
            .put("focused", focused).put("mounted", mounted).put("vrReady", vrReady)
            .put("phase", WorkspaceRuntime.status.value.phase).put("seq", WorkspaceRuntime.engine.lastSeq)
            .put("viewer", pose(viewer)).put("origin", layoutOrigin?.let { pose(it) })
            .put("controls", controls?.let { record(it) }).put("scene", sceneEntity?.let { record(it) })
            .put("panels", JSONArray(panels.values.map { record(it.entity) }))
            .put("left_controller", controllerPose(true)).put("right_controller", controllerPose(false))
            .put("input_events", JSONArray(inputEvents.toList()))
        // Only in app-private cache; never log room poses or include them in repository artifacts.
        File(cacheDir, "workspace-debug.json").writeText(data.toString())
    }

    @Composable private fun Controls() {
        val status by WorkspaceRuntime.status.collectAsState()
        Surface(Modifier.fillMaxSize(), shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Quest Assistant", style = MaterialTheme.typography.headlineSmall)
                Text(statusText(status.phase))
                Text("已呈现序号 ${status.seq}")
                Text(if (focused) "扳机点击，侧键抓取；手势射线捏合。" else "网页或系统窗口正在接收输入。",
                    style = MaterialTheme.typography.bodySmall)
                Button(onClick = { GrokWindowActivity.open(this@WorkspaceActivity) }) { Text("显示 Grok 对话") }
                Row {
                    TextButton(onClick = { resetRightLayout() }) { Text("收回右侧") }
                    TextButton(onClick = { sceneEntity?.let { resizeEntity(it, .8f, sceneBaseScale * .5f, sceneBaseScale * 4f) } }) { Text("模型 −") }
                    TextButton(onClick = { sceneEntity?.let { resizeEntity(it, 1.25f, sceneBaseScale * .5f, sceneBaseScale * 4f) } }) { Text("模型 +") }
                }
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
    override fun onDestroy() {
        if (BuildConfig.DEBUG) WorkspaceRuntime.debugCommand = null
        pauseDisplay(); scope.cancel(); if (::models.isInitialized) models.close(); super.onDestroy()
    }
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
