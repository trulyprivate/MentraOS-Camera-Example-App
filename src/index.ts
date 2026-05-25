/**
 * MentraOS Camera App - Fullstack Entry Point
 *
 * Uses Bun.serve() with HTML imports for the frontend
 * and Hono-based AppServer for the backend + MentraOS SDK.
 * WebSocket /ws/voice-agent proxies to the Python Qwen3-TTS server.
 */

import { CameraApp } from "./server/CameraApp";
import { api } from "./server/routes/routes";
import { createMentraAuthRoutes } from "@mentra/sdk";
import indexHtml from "./frontend/index.html";

// Configuration from environment
const PORT = parseInt(process.env.PORT || "3000", 10);
const PACKAGE_NAME = process.env.PACKAGE_NAME;
const API_KEY = process.env.MENTRAOS_API_KEY;
const COOKIE_SECRET = process.env.COOKIE_SECRET || API_KEY;
const PYTHON_VOICE_URL = process.env.PYTHON_VOICE_URL || "ws://localhost:8000";

// Validate required environment variables
if (!PACKAGE_NAME) {
  console.error("PACKAGE_NAME environment variable is not set");
  process.exit(1);
}

if (!API_KEY) {
  console.error("MENTRAOS_API_KEY environment variable is not set");
  process.exit(1);
}

console.log("📸 Starting Camera App\n");
console.log(`   Package: ${PACKAGE_NAME}`);
console.log(`   Port: ${PORT}`);
console.log(`   Voice Agent: ${PYTHON_VOICE_URL}`);
console.log("");

// Initialize App (extends Hono via AppServer)
const app = new CameraApp({
  packageName: PACKAGE_NAME,
  apiKey: API_KEY,
  port: PORT,
  cookieSecret: COOKIE_SECRET,
});

// Mount Mentra auth routes for frontend token exchange
app.route(
  "/api/mentra/auth",
  createMentraAuthRoutes({
    apiKey: API_KEY,
    packageName: PACKAGE_NAME,
    cookieSecret: COOKIE_SECRET || "",
  }),
);

// Mount API routes
// @ts-ignore - Hono type compatibility
app.route("/api", api);

// Start the SDK app (registers SDK routes, checks version)
await app.start();

console.log(`✅ Camera app running at http://localhost:${PORT}`);
console.log(`   • Webview: http://localhost:${PORT}`);
console.log(`   • API: http://localhost:${PORT}/api/health`);
console.log("");

const isDevelopment = process.env.NODE_ENV === "development";
const publicPath = `${process.cwd()}/src/public/assets`;

// WebSocket proxy: forwards /ws/voice-agent <-> Python Qwen3-TTS server
const voiceWsHandler = {
  open(ws: import("bun").ServerWebSocket<{ pythonWs: WebSocket | null; sid: string }>) {
    const pythonUrl = `${PYTHON_VOICE_URL}/ws/voice-agent?sid=${encodeURIComponent(ws.data.sid)}`;
    try {
      const pythonWs = new WebSocket(pythonUrl);
      pythonWs.binaryType = "arraybuffer";
      ws.data.pythonWs = pythonWs;

      pythonWs.onopen = () => {
        console.log(`[WS Proxy] Connected to Python backend for sid=${ws.data.sid}`);
      };

      pythonWs.onmessage = (event: MessageEvent) => {
        try {
          if (typeof event.data === "string") {
            ws.send(event.data);
          } else if (event.data instanceof ArrayBuffer) {
            ws.send(event.data);
          } else if (event.data instanceof Buffer) {
            ws.send(event.data.buffer as ArrayBuffer);
          }
        } catch (e) {
          console.error("[WS Proxy] send error:", e);
        }
      };

      pythonWs.onerror = () => {
        console.error(`[WS Proxy] Python backend error for sid=${ws.data.sid}`);
        try {
          ws.send(
            JSON.stringify({
              type: "status",
              status: "error",
              message: `Python voice backend unreachable at ${PYTHON_VOICE_URL}. Start it with: cd python && python server.py`,
            }),
          );
        } catch {}
      };

      pythonWs.onclose = () => {
        try {
          ws.close();
        } catch {}
      };
    } catch (e) {
      console.error("[WS Proxy] Failed to connect to Python backend:", e);
      try {
        ws.close();
      } catch {}
    }
  },

  message(
    ws: import("bun").ServerWebSocket<{ pythonWs: WebSocket | null }>,
    message: string | ArrayBuffer | Uint8Array,
  ) {
    const pythonWs = ws.data.pythonWs;
    if (pythonWs?.readyState === WebSocket.OPEN) {
      if (typeof message === "string") {
        pythonWs.send(message);
      } else {
        pythonWs.send(message);
      }
    }
  },

  close(
    ws: import("bun").ServerWebSocket<{ pythonWs: WebSocket | null }>,
  ) {
    const pythonWs = ws.data.pythonWs;
    if (pythonWs) {
      try {
        pythonWs.close();
      } catch {}
    }
  },
};

// Start Bun server with HMR support
Bun.serve({
  port: PORT,
  idleTimeout: 120,
  development: isDevelopment && {
    hmr: true,
    console: true,
  },
  websocket: voiceWsHandler,
  routes: {
    "/": indexHtml,
    "/webview": indexHtml,
    "/webview/*": indexHtml,
  },
  fetch(request, server) {
    const url = new URL(request.url);

    // Upgrade WebSocket connections for voice agent proxy
    if (
      url.pathname === "/ws/voice-agent" &&
      request.headers.get("upgrade")?.toLowerCase() === "websocket"
    ) {
      const sid =
        url.searchParams.get("sid") ||
        Math.random().toString(36).slice(2, 10);
      const upgraded = server.upgrade(request, {
        data: { pythonWs: null, sid },
      });
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }

    // Serve static assets from /assets/
    if (url.pathname.startsWith("/assets/")) {
      const filePath = `${publicPath}${url.pathname.replace("/assets", "")}`;
      const file = Bun.file(filePath);
      return new Response(file);
    }

    // All other requests through Hono app
    return app.fetch(request);
  },
});

if (isDevelopment) {
  console.log("🔥 HMR enabled for development");
}
console.log("");

// Graceful shutdown
const shutdown = async () => {
  console.log("\n🛑 Shutting down Camera App...");
  await app.stop();
  console.log("👋 Goodbye!");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
