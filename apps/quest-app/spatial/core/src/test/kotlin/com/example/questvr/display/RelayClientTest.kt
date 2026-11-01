package com.example.questvr.display

import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.mockwebserver.*

class RelayClientTest {
    @Test fun startupConfigurationRecoversAfterTransientServiceFailure() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(MockResponse().setBody("""{"asset_origins":["https://assets.example.com"]}"""))
        server.start()
        val client = RelayClient()
        var retries = 0
        try {
            val origins = withTimeout(5000) {
                client.assetOrigins(server.url("/").toString().trimEnd('/')) { retries++ }
            }
            assertEquals(setOf("https://assets.example.com"), origins)
            assertEquals(1, retries)
            assertEquals(2, server.requestCount)
        } finally { client.close(); server.shutdown() }
    }

    @Test fun takeoverTerminatesWithoutAnAutomaticReconnect() = runBlocking {
        val server = MockWebServer()
        val auth = CompletableDeferred<JsonObject>()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(ws: WebSocket, text: String) {
                val message = Json.parseToJsonElement(text).jsonObject
                if (message["type"]!!.jsonPrimitive.content == "auth") {
                    auth.complete(message)
                    ws.send("""{"v":1,"session_id":"server_a","request_id":"","seq":0,"type":"auth_ok","body":{}}""")
                    ws.close(4410, "replaced")
                }
            }
        }))
        server.start()
        val client = RelayClient()
        val phases = CopyOnWriteArrayList<String>()
        try {
            withTimeout(8000) {
                client.run(DisplaySession(server.url("/").toString().trimEnd('/'), "<TEST_SESSION>", System.currentTimeMillis()+60_000,
                    "r".repeat(64), System.currentTimeMillis()+120_000),
                    { phases += it.phase }) { fail("no scene expected") }
            }
            assertEquals("auth", auth.await()["type"]!!.jsonPrimitive.content)
            assertEquals("taken_over", phases.last())
            assertEquals(1, server.requestCount)
        } finally { client.close(); server.shutdown() }
    }

    @Test fun expiredStoredSessionRenewsBeforeOpeningSocket() = runBlocking {
        val server = MockWebServer()
        val fresh = "s".repeat(64)
        server.enqueue(MockResponse().setBody("""{"session_token":"$fresh","expires_in":900,"refresh_token":"${"r".repeat(64)}","refresh_expires_in":86400}"""))
        val auth = CompletableDeferred<String>()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(ws: WebSocket, text: String) {
                val message = Json.parseToJsonElement(text).jsonObject
                auth.complete(message["body"]!!.jsonObject["session_token"]!!.jsonPrimitive.content)
                ws.send("""{"v":1,"session_id":"server_a","request_id":"","seq":0,"type":"auth_ok","body":{}}""")
                ws.close(4410, "replaced")
            }
        }))
        server.start()
        val client = RelayClient()
        var saved: DisplaySession? = null
        try {
            val expired = DisplaySession(server.url("/").toString().trimEnd('/'), "old", 0,
                "r".repeat(64), System.currentTimeMillis()+120_000)
            assertTrue(expired.canRestore())
            withTimeout(8000) { client.run(expired, {}, { saved = it }) {} }
            assertEquals(fresh, auth.await())
            assertEquals(fresh, saved?.token)
            assertTrue(saved!!.expiresAt > System.currentTimeMillis())
            val request = server.takeRequest()
            assertEquals("/api/device/refresh", request.path)
            assertEquals(setOf("refresh_token"), Json.parseToJsonElement(request.body.readUtf8()).jsonObject.keys)
            assertEquals(2, server.requestCount)
        } finally { client.close(); server.shutdown() }
    }

    @Test fun rejectedDeviceAuthorizationStopsWithoutPairingLoop() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.start()
        val client = RelayClient()
        val phases = CopyOnWriteArrayList<String>()
        try {
            withTimeout(8000) {
                client.run(DisplaySession(server.url("/").toString().trimEnd('/'), "old", 0,
                    "r".repeat(64), System.currentTimeMillis()+120_000), { phases += it.phase }) {}
            }
            assertEquals("pairing_required", phases.last())
            assertEquals(1, server.requestCount)
        } finally { client.close(); server.shutdown() }
    }

    @Test fun rejectedSocketSessionRecoversOnceWithDeviceAuthorization() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(ws: WebSocket, text: String) { ws.close(4401, "auth") }
        }))
        server.enqueue(MockResponse().setBody("""{"session_token":"${"s".repeat(64)}","expires_in":900,"refresh_token":"${"r".repeat(64)}","refresh_expires_in":86400}"""))
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(ws: WebSocket, text: String) { ws.close(4401, "auth") }
        }))
        server.start()
        val client = RelayClient()
        val phases = CopyOnWriteArrayList<String>()
        var saved = false
        try {
            withTimeout(8000) {
                client.run(DisplaySession(server.url("/").toString().trimEnd('/'), "old", System.currentTimeMillis()+60_000,
                    "r".repeat(64), System.currentTimeMillis()+120_000), { phases += it.phase }, { saved = true }) {}
            }
            assertTrue(saved)
            assertEquals("pairing_required", phases.last())
            assertEquals(3, server.requestCount)
        } finally { client.close(); server.shutdown() }
    }

    @Test fun onlySuccessfullyPresentedCommandsReachWireAsAck() = runBlocking {
        val server = MockWebServer()
        val acknowledged = CompletableDeferred<Long>()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(ws: WebSocket, text: String) {
                val obj = Json.parseToJsonElement(text).jsonObject
                when (obj["type"]!!.jsonPrimitive.content) {
                    "auth" -> {
                        ws.send("""{"v":1,"session_id":"server_a","request_id":"","seq":0,"type":"auth_ok","body":{}}""")
                        ws.send("""{"v":1,"session_id":"server_a","request_id":"request_1","seq":1,"type":"clear","body":{"scope":"all"}}""")
                    }
                    "ack" -> {
                        acknowledged.complete(obj["seq"]!!.jsonPrimitive.long)
                        ws.close(4410, "replaced")
                    }
                }
            }
        }))
        server.start()
        val client = RelayClient()
        var drawn = false
        try {
            withTimeout(8000) {
                client.run(DisplaySession(server.url("/").toString().trimEnd('/'), "<TEST_SESSION>", System.currentTimeMillis()+60_000),
                    {}) { delay(20); drawn = true }
            }
            assertTrue(drawn)
            assertEquals(1, acknowledged.await())
        } finally { client.close(); server.shutdown() }
    }

    @Test fun displayEndpointAndMessagesFailClosed() {
        assertEquals("http://localhost:8787", DisplayProtocol.endpoint("http://localhost:8787/", true))
        for (url in listOf("http://display.example.com/", "https://user@display.example.com/",
            "https://display.example.com/mcp", "https://display.example.com/?token=sample")) {
            assertFails { DisplayProtocol.endpoint(url, true) }
        }
        assertFails { DisplayProtocol.endpoint("http://localhost:8787", false) }
        assertFails { DisplayProtocol.decode("{}") }
    }
}
