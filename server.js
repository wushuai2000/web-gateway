// Entry point. Listens on the platform-provided PORT (default 3000).
// Plain HTTP requests get a boring 404/200 page; WebSocket upgrades on the
// secret path are piped to a local Xray VLESS+WS inbound. TLS is terminated
// by the platform edge (443), so the hop to xray is plain WS.
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = parseInt(process.env.PORT || "3000", 10);
const INNER_PORT = parseInt(process.env.XRAY_PORT || "10000", 10);
const UUID = process.env.UUID || "";
const WS_PATH = process.env.WS_PATH || "/ws";
const XRAY_BIN = path.join(__dirname, "bin", "xray");

function writeConfig() {
  const cfg = {
    log: { loglevel: "warning" },
    inbounds: [
      {
        listen: "127.0.0.1",
        port: INNER_PORT,
        protocol: "vless",
        settings: {
          clients: [{ id: UUID, level: 0 }],
          decryption: "none",
        },
        streamSettings: {
          network: "ws",
          wsSettings: { path: WS_PATH },
        },
      },
    ],
    outbounds: [
      { protocol: "freedom", tag: "direct" },
      { protocol: "blackhole", tag: "block" },
    ],
  };
  fs.writeFileSync(path.join(__dirname, "config.json"), JSON.stringify(cfg, null, 2));
}

function startXray() {
  const p = spawn(XRAY_BIN, ["run", "-config", path.join(__dirname, "config.json")], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  p.on("exit", (code) => {
    console.error("xray exited with", code);
    setTimeout(() => process.exit(1), 1000);
  });
  const stop = () => p.kill("SIGTERM");
  process.on("SIGTERM", () => { stop(); process.exit(0); });
  process.on("SIGINT", () => { stop(); process.exit(0); });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("OK");
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.on("upgrade", (req, socket, head) => {
  let pathname;
  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch (_) {
    return socket.destroy();
  }
  if (pathname !== WS_PATH) return socket.destroy();
  const upstream = net.connect(INNER_PORT, "127.0.0.1", () => {
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const done = () => { upstream.destroy(); socket.destroy(); };
  upstream.on("error", done);
  socket.on("error", done);
  upstream.on("close", () => socket.destroy());
  socket.on("close", () => upstream.destroy());
});

(async () => {
  if (!UUID) {
    console.error("FATAL: UUID env var is required");
    process.exit(1);
  }
  if (!fs.existsSync(XRAY_BIN)) {
    console.log("binary missing at runtime, downloading now...");
    const { runSetup } = require("./setup");
    await runSetup();
  }
  writeConfig();
  startXray();
  server.listen(PORT, () => console.log("gateway listening on port", PORT));
})();
