package com.example.questvr.display

import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.random.Random
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okio.ByteString

data class DisplaySession(val endpoint: String, val token: String, val expiresAt: Long,
    val refreshToken: String? = null, val refreshExpiresAt: Long = 0) {
    fun canRefresh(at: Long = System.currentTimeMillis()) = refreshToken != null && refreshExpiresAt > at
    fun canRestore(at: Long = System.currentTimeMillis()) = expiresAt > at || canRefresh(at)
}
class PairingFailure(val status: Int) : IOException("pairing_$status")
data class ConnectionStatus(val phase: String, val seq: Long = 0)

/** No automatic redirects, secrets in URLs, payload logging, or TLS exceptions. */
class RelayClient(private val http: OkHttpClient = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false)
    .connectTimeout(10, TimeUnit.SECONDS).readTimeout(65, TimeUnit.SECONDS).build()) {

    suspend fun pair(endpoint: String, token: String): DisplaySession {
        require(token.length >= 32)
        return requestSession(endpoint, "pair", buildJsonObject { put("token", token); put("remember", true) })
    }

    suspend fun refresh(session: DisplaySession): DisplaySession {
        require(session.canRefresh())
        return requestSession(session.endpoint, "refresh", buildJsonObject { put("refresh_token", session.refreshToken) })
    }

    private suspend fun requestSession(endpoint: String, action: String, body: JsonObject): DisplaySession = withContext(Dispatchers.IO) {
        http.newCall(Request.Builder().url("$endpoint/api/device/$action")
            .post(body.toString().toRequestBody("application/json".toMediaType())).build()).execute().use { response ->
            if (!response.isSuccessful) throw PairingFailure(response.code)
            val result = Json.parseToJsonElement(response.body!!.string()).jsonObject
            val session = result.string("session_token")
            require(session.length in 32..512)
            val seconds = result["expires_in"]!!.jsonPrimitive.long
            require(seconds in 1..86400)
            val refresh = result["refresh_token"]?.jsonPrimitive?.content
            val refreshSeconds = result["refresh_expires_in"]?.jsonPrimitive?.long ?: 0
            require(refresh == null || (refresh.length in 32..1024 && refreshSeconds in 1..31_536_000))
            DisplaySession(endpoint, session, System.currentTimeMillis() + seconds * 1000,
                refresh, if (refresh == null) 0 else System.currentTimeMillis() + refreshSeconds * 1000)
        }
    }

    suspend fun assetOrigins(endpoint: String, onRetry: () -> Unit = {}): Set<String> = withContext(Dispatchers.IO) {
        var attempt = 0
        while (true) {
            try {
                return@withContext http.newCall(Request.Builder().url("$endpoint/api/display/config").build()).execute().use { response ->
                    if (response.code >= 500) throw IOException("display_config_unavailable")
                    require(response.isSuccessful) { "display_config" }
                    val data = Json.parseToJsonElement(response.body!!.string()).jsonObject
                    data["asset_origins"]!!.jsonArray.map { DisplayProtocol.endpoint(it.jsonPrimitive.content, false) }.toSet()
                }
            } catch (error: IOException) {
                currentCoroutineContext().ensureActive()
                onRetry()
                delay(retryDelay(attempt++))
            }
        }
        @Suppress("UNREACHABLE_CODE") emptySet()
    }

    private sealed interface Event {
        data object Open : Event
        data class Text(val text: String) : Event
        data class Closed(val code: Int) : Event
    }
    private var current: WebSocket? = null
    private var lastSeq = 0L
    private var serverId = ""

    /** Restores short sessions from the device grant; cancellation and takeover remain terminal. */
    suspend fun run(session: DisplaySession,
        status: (ConnectionStatus) -> Unit, onSessionRenewed: (DisplaySession) -> Unit = {},
        present: suspend () -> Unit) {
        var attempt = 0
        var active = session
        var renewRequired = false
        var retriedAuthorization = false
        while (currentCoroutineContext().isActive) {
            if (renewRequired || System.currentTimeMillis() >= active.expiresAt) {
                if (!active.canRefresh()) { status(ConnectionStatus("pairing_required", lastSeq)); return }
                status(ConnectionStatus("reconnecting", lastSeq))
                try {
                    active = refresh(active)
                    onSessionRenewed(active)
                    renewRequired = false
                } catch (error: CancellationException) { throw error }
                catch (error: Exception) {
                    if (error is PairingFailure && error.status in setOf(400, 401, 403, 404)) {
                        status(ConnectionStatus("pairing_required", lastSeq)); return
                    }
                    delay(if (error is PairingFailure && error.status == 429) 60_000L else retryDelay(attempt++))
                    continue
                }
            }
            status(ConnectionStatus(if (attempt == 0) "connecting" else "reconnecting", lastSeq))
            val events = Channel<Event>(128)
            var overflow = false
            fun emit(event: Event, socket: WebSocket) {
                if (events.trySend(event).isFailure) {
                    overflow = true
                    events.close(IOException("display_queue_full"))
                    socket.cancel()
                }
            }
            val ws = http.newWebSocket(Request.Builder().url(active.endpoint + "/ws").build(), object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) = emit(Event.Open, webSocket)
                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (text.toByteArray().size > DisplayProtocol.MAX_MESSAGE_BYTES) {
                        events.close(IOException("message_too_large")); webSocket.cancel()
                    } else emit(Event.Text(text), webSocket)
                }
                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    events.close(IOException("binary_message")); webSocket.cancel()
                }
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    emit(Event.Closed(code), webSocket); webSocket.close(code, null)
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { emit(Event.Closed(code), webSocket) }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { emit(Event.Closed(1006), webSocket) }
            })
            current = ws
            var authenticated = false
            var terminal = false
            try {
                while (currentCoroutineContext().isActive) {
                    when (val event = withTimeout(if (authenticated) 60_000L else 10_000L) { events.receive() }) {
                        Event.Open -> ws.send(DisplayProtocol.encode("auth", body = buildJsonObject {
                            put("session_token", active.token); put("last_seq", lastSeq)
                        }))
                        is Event.Closed -> {
                            if (event.code == 4401 && active.canRefresh() && !retriedAuthorization) {
                                renewRequired = true; retriedAuthorization = true
                            } else {
                                terminal = event.code in setOf(4401, 4410)
                                if (terminal) status(ConnectionStatus(if (event.code == 4410) "taken_over" else "pairing_required", lastSeq))
                            }
                            break
                        }
                        is Event.Text -> {
                            val message = DisplayProtocol.decode(event.text)
                            if (!authenticated) {
                                require(message.type == "auth_ok") { "auth_required" }
                                if (serverId.isNotEmpty() && serverId != message.session) lastSeq = 0
                                serverId = message.session
                                authenticated = true; attempt = 0; retriedAuthorization = false
                                status(ConnectionStatus("connected", lastSeq))
                            } else when (message.type) {
                                "ping" -> ws.send(DisplayProtocol.encode("pong"))
                                "pong", "interaction_ok", "interaction_rejected" -> Unit
                                in DisplayProtocol.commands -> {
                                    val ack = acknowledge(message, present)
                                    currentCoroutineContext().ensureActive()
                                    if (ack != null) check(ws.send(DisplayProtocol.encode("ack", ack))) { "ack_send" }
                                    status(ConnectionStatus("connected", lastSeq))
                                }
                                else -> error("unknown_message")
                            }
                        }
                    }
                }
            } catch (error: CancellationException) {
                if (error !is TimeoutCancellationException) throw error
            } catch (_: Exception) {
                // Parsing/rendering failure must not fall through to a cumulative ACK of later commands.
                terminal = true
                status(ConnectionStatus(if (overflow) "queue_full" else "render_failed", lastSeq))
            } finally {
                if (current === ws) current = null
                ws.cancel(); events.cancel()
            }
            if (terminal) return
            if (!renewRequired) delay(retryDelay(attempt++))
        }
    }

    private suspend fun acknowledge(message: Envelope, present: suspend () -> Unit): Long? {
        require(message.session == serverId) { "stale_server" }
        if (message.type != "snapshot") {
            if (message.seq <= lastSeq) return lastSeq
            require(message.seq == lastSeq + 1) { "sequence_gap" }
        }
        present()
        currentCoroutineContext().ensureActive()
        lastSeq = message.seq
        return if (message.type == "snapshot") null else lastSeq
    }

    private fun retryDelay(attempt: Int): Long =
        (((1000L shl attempt.coerceAtMost(5)).coerceAtMost(30_000L)) * Random.nextDouble(.8, 1.2)).toLong()

    fun interaction(kind: String, target: String) {
        require(kind in setOf("select", "activate"))
        require(Regex("[A-Za-z0-9_-]{1,64}").matches(target))
        current?.send(DisplayProtocol.encode("interaction", body = buildJsonObject {
            put("kind", kind); put("target_id", target)
        }, request = "i" + UUID.randomUUID().toString().replace("-", "")))
    }

    fun close() { current?.cancel(); current = null; http.dispatcher.cancelAll() }
}
