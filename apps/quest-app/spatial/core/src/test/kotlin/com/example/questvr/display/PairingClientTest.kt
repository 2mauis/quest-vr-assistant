package com.example.questvr.display

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import java.net.InetAddress
import java.util.concurrent.TimeUnit
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class PairingClientTest {
    private val server = MockWebServer()
    private val now = 1_000_000L
    private val session = "0123456789abcdef".repeat(4)
    private val grant = "g".repeat(64)
    private lateinit var endpoint: DisplayEndpoint
    private val client = PairingClient(clock = { now })

    @BeforeTest fun start() {
        server.start(InetAddress.getByName("localhost"), 0)
        endpoint = DisplayEndpoint.parse("http://localhost:${server.port}", allowLocal = true)
    }

    @AfterTest fun stop() = server.shutdown()

    private fun sessionBody(refresh: Boolean = true) =
        if (refresh) {
            """{"session_token":"$session","expires_in":900,"refresh_token":"$grant","refresh_expires_in":86400}"""
        } else {
            """{"session_token":"$session","expires_in":900}"""
        }

    @Test fun pairPostsOnlyTokenAndRememberAndParsesSession() =
        runBlocking<Unit> {
            server.enqueue(MockResponse().setBody(sessionBody()))
            val result = client.pair(endpoint, "p".repeat(32))
            assertEquals(session, result.token)
            assertEquals(now + 900_000, result.expiresAt)
            assertEquals(grant, result.refreshToken)
            assertEquals(now + 86_400_000, result.refreshExpiresAt)
            val request = server.takeRequest()
            assertEquals("/api/device/pair", request.path)
            val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
            assertEquals(setOf("token", "remember"), body.keys)
        }

    @Test fun refreshSendsOnlyTheGrant() =
        runBlocking<Unit> {
            server.enqueue(MockResponse().setBody(sessionBody(refresh = false)))
            val stored = DisplaySession(endpoint, session, now - 1, grant, now + 1000)
            val renewed = client.refresh(stored)
            assertNull(renewed.refreshToken)
            val request = server.takeRequest()
            assertEquals("/api/device/refresh", request.path)
            assertEquals(setOf("refresh_token"), Json.parseToJsonElement(request.body.readUtf8()).jsonObject.keys)
        }

    @Test fun refreshWithoutGrantFailsLocally() =
        runBlocking<Unit> {
            assertFailsWith<IllegalArgumentException> { client.refresh(DisplaySession(endpoint, session, now + 1000)) }
            assertEquals(0, server.requestCount)
        }

    @Test fun rejectionCarriesStatus() =
        runBlocking<Unit> {
            server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"unauthorized"}"""))
            assertEquals(401, assertFailsWith<PairingRejected> { client.pair(endpoint, "p".repeat(32)) }.status)
        }

    @Test fun redirectsAreNotFollowed() =
        runBlocking<Unit> {
            server.enqueue(MockResponse().setResponseCode(307).setHeader("location", "https://other.example.com/"))
            assertEquals(307, assertFailsWith<PairingRejected> { client.pair(endpoint, "p".repeat(32)) }.status)
            assertEquals(1, server.requestCount)
        }

    @Test fun malformedSessionsAreRejected() =
        runBlocking<Unit> {
            val bodies =
                listOf(
                    "",
                    "[]",
                    "not json",
                    """{"expires_in":900}""",
                    """{"session_token":"short","expires_in":900}""",
                    """{"session_token":"$session","expires_in":"900"}""",
                    """{"session_token":"$session","expires_in":0}""",
                    """{"session_token":"$session","expires_in":900,"refresh_token":"$grant"}""",
                    """{"session_token":"$session","expires_in":900,"refresh_token":"x","refresh_expires_in":10}""",
                )
            for (body in bodies) {
                server.enqueue(MockResponse().setBody(body))
                assertFailsWith<InvalidPairingResponse>(body) { client.pair(endpoint, "p".repeat(32)) }
            }
        }

    @Test fun cancellationAbortsTheCall() =
        runBlocking<Unit> {
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            val call = async(Dispatchers.IO) { client.pair(endpoint, "p".repeat(32)) }
            assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
            call.cancel()
            assertFailsWith<CancellationException> { withTimeout(2000) { call.await() } }
        }
}
