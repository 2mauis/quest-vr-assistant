package com.example.questvr.tunnelprobe

import android.net.Uri
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URI
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

/** Resolve glTF dependencies ourselves, then give the renderer only a self-contained local asset. */
class ModelStore(cache: File) {
    val directory = File(cache, "workspace-models").apply { mkdirs() }
    private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .callTimeout(20, TimeUnit.SECONDS).build()
    private val limit = 25 * 1024 * 1024

    suspend fun prepare(url: String, origins: Set<String>): Uri = withContext(Dispatchers.IO) {
        var remaining = limit
        suspend fun fetch(source: URI): ByteArray {
            currentCoroutineContext().ensureActive()
            require(source.scheme == "https" && source.host != null && source.userInfo == null && source.fragment == null)
            val origin = "https://${source.host}" + if (source.port in setOf(-1, 443)) "" else ":${source.port}"
            require(origin in origins) { "model_origin" }
            return http.newCall(Request.Builder().url(source.toASCIIString()).build()).execute().use { response ->
                require(response.isSuccessful) { "model_download" }
                val body = response.body ?: error("empty_model")
                require(body.contentLength() <= remaining) { "model_too_large" }
                val output = ByteArrayOutputStream()
                body.byteStream().use { input ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val n = input.read(buffer); if (n < 0) break
                        remaining -= n; require(remaining >= 0) { "model_too_large" }
                        output.write(buffer, 0, n)
                    }
                }
                output.toByteArray()
            }
        }
        val uri = URI(url)
        val bytes = fetch(uri)
        val isGlb = uri.path.endsWith(".glb")
        var binary: ByteArray? = null
        val json: JSONObject
        if (isGlb) {
            val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            require(bytes.size >= 20 && buffer.int == 0x46546c67 && buffer.int == 2 && buffer.int == bytes.size)
            val length = buffer.int
            require(buffer.int == 0x4e4f534a && length >= 0 && length <= buffer.remaining())
            val text = ByteArray(length); buffer.get(text)
            json = JSONObject(String(text, Charsets.UTF_8))
            if (buffer.hasRemaining()) {
                require(buffer.remaining() >= 8)
                val size = buffer.int
                require(buffer.int == 0x004e4942 && size == buffer.remaining())
                binary = ByteArray(size); buffer.get(binary)
            }
        } else json = JSONObject(String(bytes, Charsets.UTF_8))
        require(json.getJSONObject("asset").getString("version") == "2.0")
        // Unsupported required extensions must fail locally, never silently render a substitute.
        require(json.optJSONArray("extensionsRequired")?.length() ?: 0 == 0) { "model_extension" }
        var resources = 0
        for (kind in listOf("buffers", "images")) {
            val entries = json.optJSONArray(kind) ?: continue
            for (i in 0 until entries.length()) {
                val item = entries.getJSONObject(i)
                if (!item.has("uri")) continue
                val source = item.getString("uri")
                if (source.startsWith("data:")) {
                    require(source.startsWith("data:application/octet-stream;base64,") ||
                        source.startsWith("data:application/gltf-buffer;base64,") ||
                        source.startsWith("data:image/png;base64,") || source.startsWith("data:image/jpeg;base64,"))
                    continue
                }
                require(++resources <= 32) { "model_resources" }
                val data = fetch(uri.resolve(source))
                val mime = if (kind == "buffers") "application/octet-stream" else item.optString("mimeType").ifEmpty {
                    if (data.size >= 4 && data[0] == 0x89.toByte() && data[1] == 0x50.toByte()) "image/png"
                    else if (data.size >= 2 && data[0] == 0xff.toByte() && data[1] == 0xd8.toByte()) "image/jpeg"
                    else error("model_image_format")
                }
                require(mime in setOf("application/octet-stream", "image/png", "image/jpeg"))
                item.put("uri", "data:$mime;base64," + Base64.getEncoder().encodeToString(data))
            }
        }
        val text = json.toString().toByteArray(Charsets.UTF_8)
        val output = if (isGlb) {
            val size = (text.size + 3) and -4
            val bin = binary
            ByteBuffer.allocate(20 + size + (bin?.let { 8 + it.size } ?: 0)).order(ByteOrder.LITTLE_ENDIAN).apply {
                putInt(0x46546c67); putInt(2); putInt(capacity()); putInt(size); putInt(0x4e4f534a); put(text)
                repeat(size - text.size) { put(32.toByte()) }
                if (bin != null) { putInt(bin.size); putInt(0x004e4942); put(bin) }
            }.array()
        } else text
        val hash = MessageDigest.getInstance("SHA-256").digest(output).joinToString("") { "%02x".format(it) }
        val destination = File(directory, hash + if (isGlb) ".glb" else ".gltf")
        if (!destination.exists()) {
            directory.listFiles()?.sortedByDescending { it.lastModified() }?.drop(3)?.forEach { it.delete() }
            destination.writeBytes(output)
        }
        Uri.fromFile(destination)
    }
    fun close() { http.dispatcher.cancelAll() }
}
