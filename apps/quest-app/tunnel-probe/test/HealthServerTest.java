package com.example.questvr.tunnelprobe;

import java.io.ByteArrayOutputStream;
import java.net.Socket;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class HealthServerTest {
    private static int assertions;
    private static void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }
    private static String send(HealthServer server, String request) throws Exception {
        try (Socket socket = new Socket(server.host(), server.port())) {
            socket.setSoTimeout(3000);
            socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
            ByteArrayOutputStream response = new ByteArrayOutputStream();
            byte[] bytes = new byte[512];
            int count;
            while ((count = socket.getInputStream().read(bytes)) != -1) response.write(bytes, 0, count);
            return response.toString(StandardCharsets.UTF_8.name());
        }
    }
    public static void main(String[] args) throws Exception {
        List<String> receipts = Collections.synchronizedList(new ArrayList<>());
        HealthServer server = new HealthServer(receipts::add);
        server.start();
        String nonce = "0123456789abcdef0123456789abcdef";
        String header = "X-QVR-Probe-Nonce: " + nonce + "\r\n";
        String response = send(server, "GET /healthz HTTP/1.1\r\n" + header + "\r\n");
        check(response.startsWith("HTTP/1.1 200"), "health status");
        check(response.contains("\"run_nonce\":\"" + server.runNonce() + "\""), "run binding");
        check(response.contains("\"request_nonce\":\"" + nonce + "\""), "request binding");
        check(receipts.size() == 1 && receipts.get(0).equals(nonce), "receipt matches response");
        for (String path : new String[]{"/", "/mcp", "/ws", "/api/device/pair", "/healthz?x=1", "/healthz/"}) {
            check(send(server, "GET " + path + " HTTP/1.1\r\n" + header + "\r\n").startsWith("HTTP/1.1 404"), "deny " + path);
        }
        check(send(server, "POST /healthz HTTP/1.1\r\n" + header + "\r\n").startsWith("HTTP/1.1 404"), "method denied");
        check(send(server, "GET /healthz HTTP/1.1\r\n\r\n").startsWith("HTTP/1.1 400"), "nonce required");
        check(send(server, "GET /healthz HTTP/1.1\r\n" + header + header + "\r\n").startsWith("HTTP/1.1 400"), "duplicate nonce rejected");
        check(send(server, "GET /healthz HTTP/1.1\r\nX-QVR-Probe-Nonce: invalid\r\n\r\n").startsWith("HTTP/1.1 400"), "nonce shape");
        check(send(server, "GET /healthz HTTP/1.1\r\nInvalid\r\n" + header + "\r\n").startsWith("HTTP/1.1 400"), "malformed header");
        check(send(server, "GET /healthz HTTP/1.1\r\nX: " + String.join("", Collections.nCopies(4100, "x"))).startsWith("HTTP/1.1 431"), "bounded header");
        check(receipts.size() == 1, "rejections create no receipts");
        try (HealthServer second = new HealthServer(value -> {})) {
            check(!server.runNonce().equals(second.runNonce()), "new run has fresh nonce");
        }
        String host = server.host(); int port = server.port();
        try (Socket slow = new Socket(host, port)) {
            slow.getOutputStream().write("GET /".getBytes(StandardCharsets.US_ASCII));
            Thread.sleep(100);
            server.close();
            slow.setSoTimeout(2000);
            check(slow.getInputStream().read() == -1, "stop closes in-flight client");
        }
        try (Socket stopped = new Socket()) {
            try { stopped.connect(new InetSocketAddress(host, port), 1000); throw new AssertionError("listener survived stop"); }
            catch (java.io.IOException expected) { assertions++; }
        }
        System.out.println("HealthServer: " + assertions + " assertions passed");
    }
}
