package com.example.questvr.tunnelprobe;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Locale;

/** Fixed, non-sensitive health endpoint. No MCP, files, proxying or command input. */
public final class HealthServer implements AutoCloseable {
    public interface Receipt { void accept(String requestNonce) throws IOException; }
    private final ServerSocket server;
    private final Receipt receipt;
    private final String runNonce;
    private volatile boolean closed;
    private volatile Socket current;
    private Thread worker;

    public HealthServer(Receipt receipt) throws IOException {
        this.receipt = receipt;
        byte[] random = new byte[16];
        new SecureRandom().nextBytes(random);
        StringBuilder hex = new StringBuilder();
        for (byte b : random) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
        runNonce = hex.toString();
        server = new ServerSocket(0, 8, InetAddress.getLoopbackAddress());
    }

    public String runNonce() { return runNonce; }
    public int port() { return server.getLocalPort(); }
    public String host() { return server.getInetAddress().getHostAddress(); }

    public synchronized void start() {
        if (worker != null || closed) throw new IllegalStateException("already started or closed");
        worker = new Thread(() -> {
            while (!closed) {
                try (Socket socket = server.accept()) {
                    current = socket;
                    if (closed) break;
                    socket.setSoTimeout(1500);
                    serve(socket);
                } catch (IOException ignored) {
                    // Malformed, disconnected or timed-out clients do not kill the listener.
                } finally { current = null; }
            }
        }, "probe-health");
        worker.setDaemon(true);
        worker.start();
    }

    private void serve(Socket socket) throws IOException {
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        int suffix = 0;
        while (header.size() < 4096 && suffix != 0x0d0a0d0a) {
            int b = socket.getInputStream().read();
            if (b == -1) return;
            header.write(b);
            suffix = (suffix << 8) | b;
        }
        if (suffix != 0x0d0a0d0a) { respond(socket, 431, "{}"); return; }
        String[] lines = header.toString(StandardCharsets.US_ASCII.name()).split("\r\n");
        String[] request = lines[0].split(" ", -1);
        if (request.length != 3 || !(request[2].equals("HTTP/1.1") || request[2].equals("HTTP/1.0"))) {
            respond(socket, 400, "{}"); return;
        }
        if (!request[0].equals("GET") || !request[1].equals("/healthz")) {
            respond(socket, 404, "{}"); return;
        }
        String nonce = null;
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon <= 0) { respond(socket, 400, "{}"); return; }
            if (lines[i].substring(0, colon).equalsIgnoreCase("X-QVR-Probe-Nonce")) {
                if (nonce != null) { respond(socket, 400, "{}"); return; }
                nonce = lines[i].substring(colon + 1).trim();
            }
        }
        if (nonce == null || !nonce.matches("[0-9a-f]{32}")) { respond(socket, 400, "{}"); return; }
        receipt.accept(nonce);
        respond(socket, 200, "{\"ok\":true,\"run_nonce\":\"" + runNonce + "\",\"request_nonce\":\"" + nonce + "\"}");
    }

    private void respond(Socket socket, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String reason = status == 200 ? "OK" : status == 404 ? "Not Found" : "Bad Request";
        socket.getOutputStream().write(("HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: application/json\r\n"
            + "Cache-Control: no-store\r\nConnection: close\r\nContent-Length: " + bytes.length + "\r\n\r\n")
            .getBytes(StandardCharsets.US_ASCII));
        socket.getOutputStream().write(bytes);
        socket.getOutputStream().flush();
    }

    @Override public synchronized void close() throws IOException {
        closed = true;
        server.close();
        Socket socket = current;
        if (socket != null) socket.close();
    }
}
