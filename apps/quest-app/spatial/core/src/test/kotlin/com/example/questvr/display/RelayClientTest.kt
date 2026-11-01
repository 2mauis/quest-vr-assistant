package com.example.questvr.display

import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.mockwebserver.*

class RelayClientTest {
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
                client.run(DisplaySession(server.url("/").toString().trimEnd('/'), "<TEST_SESSION>", System.currentTimeMillis()+60_000),
                    DisplayEngine(), { phases += it.phase }) { fail("no scene expected") }
            }
            assertEquals("auth", auth.await()["type"]!!.jsonPrimitive.content)
            assertEquals("taken_over", phases.last())
            assertEquals(1, server.requestCount)
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
                    DisplayEngine(), {}) { delay(20); drawn = true }
            }
            assertTrue(drawn)
            assertEquals(1, acknowledged.await())
        } finally { client.close(); server.shutdown() }
    }
}
