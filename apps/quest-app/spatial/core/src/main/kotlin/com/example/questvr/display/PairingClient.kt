package com.example.questvr.display

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resumeWithException

/** The relay answered with a non-2xx status. */
class PairingRejected(
    val status: Int,
) : IOException("pairing_$status")

/** The relay answered 2xx with a body that is not a valid session. */
class InvalidPairingResponse(
    reason: String,
) : IOException(reason)

/**
 * Device pairing and renewal against `/api/device/{pair,refresh}`.
 * Redirects are refused so a credential is never re-sent to another origin; TLS checks stay on.
 */
class PairingClient(
    private val http: OkHttpClient = defaultHttpClient(),
    private val clock: () -> Long = System::currentTimeMillis,
) {
    suspend fun pair(
        endpoint: DisplayEndpoint,
        pairingToken: String,
    ): DisplaySession {
        require(pairingToken.length in MIN_PAIRING_TOKEN..MAX_PAIRING_TOKEN) { "pairing_token" }
        val body =
            buildJsonObject {
                put("token", pairingToken)
                put("remember", true)
            }
        return requestSession(endpoint, "/api/device/pair", body)
    }

    suspend fun refresh(session: DisplaySession): DisplaySession {
        val refreshToken = session.refreshToken
        require(refreshToken != null && session.canRefresh(clock())) { "refresh_unavailable" }
        return requestSession(session.endpoint, "/api/device/refresh", buildJsonObject { put("refresh_token", refreshToken) })
    }

    private suspend fun requestSession(
        endpoint: DisplayEndpoint,
        path: String,
        body: JsonObject,
    ): DisplaySession {
        val request =
            Request
                .Builder()
                .url(endpoint.apiUrl(path))
                .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                .build()
        val text =
            http.newCall(request).await().use { response ->
                if (!response.isSuccessful) throw PairingRejected(response.code)
                withContext(Dispatchers.IO) { response.body?.string() } ?: throw InvalidPairingResponse("empty_body")
            }
        return parseSession(endpoint, text, clock())
    }

    companion object {
        private const val MIN_PAIRING_TOKEN = 32
        private const val MAX_PAIRING_TOKEN = 512
        private const val MAX_SESSION_SECONDS = 86_400L
        private const val MAX_REFRESH_SECONDS = 31_536_000L
        private const val MAX_RESPONSE_CHARS = 16_384
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()

        fun defaultHttpClient(): OkHttpClient =
            OkHttpClient
                .Builder()
                .followRedirects(false)
                .followSslRedirects(false)
                .connectTimeout(10, TimeUnit.SECONDS)
                .callTimeout(20, TimeUnit.SECONDS)
                .build()

        internal fun parseSession(
            endpoint: DisplayEndpoint,
            text: String,
            now: Long,
        ): DisplaySession {
            if (text.length > MAX_RESPONSE_CHARS) throw InvalidPairingResponse("response_too_large")
            val json =
                try {
                    Json.parseToJsonElement(text).jsonObject
                } catch (error: SerializationException) {
                    throw InvalidPairingResponse("response_json").apply { initCause(error) }
                } catch (error: IllegalArgumentException) {
                    throw InvalidPairingResponse("response_json").apply { initCause(error) }
                }
            val token = json.string("session_token")
            if (token == null || !DisplaySession.isSessionToken(token)) throw InvalidPairingResponse("session_token")
            val seconds = json.long("expires_in")
            if (seconds == null || seconds !in 1..MAX_SESSION_SECONDS) throw InvalidPairingResponse("expires_in")
            val refresh = json.string("refresh_token")
            val refreshSeconds = json.long("refresh_expires_in")
            if (refresh != null) {
                if (refresh.length !in 32..1024) throw InvalidPairingResponse("refresh_token")
                if (refreshSeconds == null || refreshSeconds !in 1..MAX_REFRESH_SECONDS) {
                    throw InvalidPairingResponse("refresh_expires_in")
                }
            }
            return DisplaySession(
                endpoint = endpoint,
                token = token,
                expiresAt = now + seconds * 1000,
                refreshToken = refresh,
                refreshExpiresAt = if (refresh == null || refreshSeconds == null) 0 else now + refreshSeconds * 1000,
            )
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

        private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull
    }
}

/** Enqueues the call so cancelling the coroutine cancels the socket instead of blocking a thread. */
private suspend fun Call.await(): Response =
    suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { cancel() }
        enqueue(
            object : Callback {
                override fun onResponse(
                    call: Call,
                    response: Response,
                ) {
                    continuation.resume(response) { _, value, _ -> value.close() }
                }

                override fun onFailure(
                    call: Call,
                    e: IOException,
                ) {
                    continuation.resumeWithException(e)
                }
            },
        )
    }
