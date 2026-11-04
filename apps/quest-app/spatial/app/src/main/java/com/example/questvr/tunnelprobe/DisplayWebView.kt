package com.example.questvr.tunnelprobe

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import com.example.questvr.display.DisplayEndpoint
import com.example.questvr.display.DisplaySession
import com.example.questvr.display.SessionInjection

/**
 * Owns the one display WebView inside [container], which the spatial panel hosts.
 * Navigation is confined to the display origin, and the session token is handed only to a
 * page that is on that origin. Main thread only.
 */
class DisplayWebView(
    private val context: Context,
    private val endpoint: DisplayEndpoint,
    private val container: FrameLayout,
) {
    private val handler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private var token: String? = null
    private var attempts = 0
    private var destroyed = false
    private val retry = Runnable { inject() }

    fun load() {
        check(!destroyed) { "display_destroyed" }
        val view = webView ?: create().also { webView = it }
        view.loadUrl(endpoint.pageUrl)
    }

    /** Hands [sessionToken] to the page now if it is ready, otherwise once it has loaded. */
    fun offer(sessionToken: String) {
        if (destroyed || !DisplaySession.isSessionToken(sessionToken)) return
        token = sessionToken
        attempts = 0
        handler.removeCallbacks(retry)
        inject()
    }

    fun onResume() = webView?.onResume()

    fun onPause() = webView?.onPause()

    fun destroy() {
        if (destroyed) return
        destroyed = true
        token = null
        handler.removeCallbacks(retry)
        release()
    }

    /** After a renderer crash the instance only supports removal and [WebView.destroy]. */
    private fun release(rendererAlive: Boolean = true) {
        val view = webView ?: return
        webView = null
        container.removeView(view)
        if (rendererAlive) {
            view.stopLoading()
            view.webViewClient = WebViewClient()
        }
        view.destroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun create(): WebView {
        val view = WebView(context)
        with(view.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
        }
        view.webViewClient = Client()
        container.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        return view
    }

    private fun inject() {
        val view = webView ?: return
        val current = token ?: return
        if (destroyed || !endpoint.owns(view.url)) return
        view.evaluateJavascript(SessionInjection.script(current)) { result ->
            if (destroyed || webView !== view || token != current) return@evaluateJavascript
            if (result != SessionInjection.ACCEPTED && attempts++ < MAX_ATTEMPTS) {
                handler.postDelayed(retry, RETRY_DELAY_MS)
            }
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest,
        ): Boolean {
            val allowed = endpoint.owns(request.url.toString())
            if (!allowed && BuildConfig.DEBUG) Log.i(TAG, "navigation_blocked")
            return !allowed
        }

        override fun onPageStarted(
            view: WebView,
            url: String?,
            favicon: Bitmap?,
        ) {
            handler.removeCallbacks(retry)
        }

        override fun onPageFinished(
            view: WebView,
            url: String?,
        ) {
            if (view !== webView) return
            attempts = 0
            inject()
        }

        /** Without this the WebView's renderer crash takes the whole app process down. */
        override fun onRenderProcessGone(
            view: WebView,
            detail: RenderProcessGoneDetail,
        ): Boolean {
            Log.w(TAG, "display_renderer_gone crashed=${detail.didCrash()}")
            if (view === webView) {
                handler.removeCallbacks(retry)
                release(rendererAlive = false)
                if (!destroyed) load()
            } else {
                view.destroy()
            }
            return true
        }
    }

    private companion object {
        const val TAG = "QvrWorkspace"
        const val MAX_ATTEMPTS = 24
        const val RETRY_DELAY_MS = 250L
    }
}
