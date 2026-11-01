package com.example.questvr.display

import java.net.URI
import kotlinx.serialization.json.*

private val identifier = Regex("[A-Za-z0-9_-]{1,64}")
data class Envelope(val session: String, val request: String, val seq: Long, val type: String, val body: JsonObject)

object DisplayProtocol {
    const val MAX_MESSAGE_BYTES = 256 * 1024
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
}

internal fun JsonObject.string(key: String): String {
    val value = this[key] as? JsonPrimitive ?: error("missing_$key")
    require(value.isString) { "invalid_$key" }
    return value.content
}
