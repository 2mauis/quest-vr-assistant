package com.example.questvr.display

import java.net.URI
import kotlinx.serialization.json.*

private val identifier = Regex("[A-Za-z0-9_-]{1,64}")
data class Vec3(val x: Float = 0f, val y: Float = 0f, val z: Float = 0f)
data class Placement(val anchor: String, val position: Vec3, val rotation: Vec3, val scale: Float)
data class SceneContent(val preset: String?, val modelUrl: String?, val placement: Placement)
data class TextPanel(val id: String, val title: String, val text: String, val placement: Placement)
data class WorkspaceState(val scene: SceneContent? = null, val panels: Map<String, TextPanel> = emptyMap())
data class Envelope(val session: String, val request: String, val seq: Long, val type: String, val body: JsonObject)

object DisplayProtocol {
    const val MAX_MESSAGE_BYTES = 256 * 1024
    const val MAX_PANELS = 32
    val commands = setOf("show_scene", "render_panel", "clear", "snapshot")

    fun endpoint(value: String, allowLocal: Boolean): String {
        val uri = URI(value.trim())
        require(uri.host != null && uri.userInfo == null && uri.query == null && uri.fragment == null)
        require(uri.path.isNullOrEmpty() || uri.path == "/") { "display_base_path" }
        require(uri.scheme == "https" || (allowLocal && uri.scheme == "http" && uri.host == "localhost")) { "display_requires_tls" }
        return uri.toASCIIString().trimEnd('/')
    }

    fun decode(text: String): Envelope {
        require(text.toByteArray(Charsets.UTF_8).size <= MAX_MESSAGE_BYTES) { "message_too_large" }
        val obj = Json.parseToJsonElement(text).jsonObject
        require(obj["v"]?.jsonPrimitive?.intOrNull == 1) { "protocol_version" }
        val seq = obj["seq"]?.jsonPrimitive?.longOrNull ?: error("invalid_seq")
        require(seq >= 0) { "invalid_seq" }
        val type = obj.string("type")
        val session = obj.string("session_id")
        val request = obj.string("request_id")
        require(identifier.matches(session)) { "invalid_session" }
        require(request.isEmpty() || identifier.matches(request)) { "invalid_request" }
        if (type in commands && type != "snapshot") require(seq > 0 && request.isNotEmpty())
        return Envelope(session, request, seq, type, obj["body"]!!.jsonObject)
    }

    fun encode(type: String, seq: Long = 0, body: JsonObject = buildJsonObject {}, request: String = ""): String =
        buildJsonObject {
            put("v", 1); put("session_id", "native_display"); put("request_id", request)
            put("seq", seq); put("type", type); put("body", body)
        }.toString()

    fun reduce(state: WorkspaceState, message: Envelope): WorkspaceState = when (message.type) {
        "show_scene" -> state.copy(scene = scene(message.body))
        "render_panel" -> {
            val panel = panel(message.body)
            require(panel.id in state.panels || state.panels.size < MAX_PANELS) { "panel_capacity" }
            state.copy(panels = state.panels + (panel.id to panel))
        }
        "clear" -> when (message.body.string("scope")) {
            "all" -> WorkspaceState()
            "scene" -> state.copy(scene = null)
            "panel" -> state.copy(panels = state.panels - message.body.id("panel_id"))
            else -> error("invalid_scope")
        }
        "snapshot" -> {
            val panels = message.body["panels"]!!.jsonArray.map { panel(it.jsonObject) }
            require(panels.size <= MAX_PANELS && panels.map { it.id }.distinct().size == panels.size)
            WorkspaceState(message.body["scene"]?.takeUnless { it is JsonNull }?.let { scene(it.jsonObject) },
                panels.associateBy { it.id })
        }
        else -> error("not_a_command")
    }

    private fun scene(obj: JsonObject): SceneContent {
        val preset = obj["preset"]?.jsonPrimitive?.contentOrNull
        val model = obj["model_url"]?.jsonPrimitive?.contentOrNull
        require((preset != null) xor (model != null)) { "scene_source" }
        if (preset != null) require(preset in setOf("grid", "orbit", "crystal", "pedestal"))
        if (model != null) {
            val uri = URI(model)
            require(uri.scheme == "https" && uri.host != null && uri.userInfo == null && uri.fragment == null)
            require(uri.path.endsWith(".gltf") || uri.path.endsWith(".glb"))
        }
        return SceneContent(preset, model, placement(obj))
    }

    private fun panel(obj: JsonObject): TextPanel {
        val title = obj["title"]?.jsonPrimitive?.contentOrNull ?: ""
        val text = obj.string("text")
        require(title.length <= 100 && text.length <= 20000 && text.isNotEmpty())
        require('<' !in title && '>' !in title && '<' !in text && '>' !in text)
        return TextPanel(obj.id("panel_id"), title, text, placement(obj))
    }

    private fun placement(obj: JsonObject): Placement {
        val anchor = obj.string("anchor")
        require(anchor in setOf("world", "floor", "head", "front", "left", "right"))
        val pose = obj["pose"]!!.jsonObject
        fun vector(key: String, min: Float, max: Float): Vec3 {
            val v = pose[key]!!.jsonObject
            return Vec3(v.number("x", min, max), v.number("y", min, max), v.number("z", min, max))
        }
        return Placement(anchor, vector("position", -10f, 10f), vector("rotation", -360f, 360f), pose.number("scale", .1f, 3f))
    }

    fun anchor(name: String): Vec3 = when (name) {
        "head" -> Vec3(0f, 1.6f, 0f)
        "front" -> Vec3(0f, 1.2f, -1.2f)
        "left" -> Vec3(-1.2f, 1.2f, -.6f)
        "right" -> Vec3(1.2f, 1.2f, -.6f)
        else -> Vec3()
    }
}

internal fun JsonObject.string(key: String): String {
    val value = this[key] as? JsonPrimitive ?: error("missing_$key")
    require(value.isString) { "invalid_$key" }
    return value.content
}
private fun JsonObject.id(key: String) = string(key).also { require(identifier.matches(it)) }
private fun JsonObject.number(key: String, min: Float, max: Float): Float {
    val v = this[key]?.jsonPrimitive ?: error("missing_$key")
    require(!v.isString)
    return (v.floatOrNull ?: error("invalid_$key")).also { require(it.isFinite() && it in min..max) }
}
