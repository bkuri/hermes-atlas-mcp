#!/usr/bin/env node
/**
 * Lightweight stdio-to-HTTP bridge for MCP servers.
 * Usage: node bridge.cjs -- <command> [args...]
 * Port/host via env vars: PORT=8080 HOST=0.0.0.0
 */
const http = require("node:http");
const { spawn } = require("node:child_process");

const PORT = parseInt(process.env.PORT || "8080");
const HOST = process.env.HOST || "0.0.0.0";

// Everything after -- is the subprocess command
const argIdx = process.argv.indexOf("--");
const COMMAND = argIdx >= 0 ? process.argv.slice(argIdx + 1) : process.argv.slice(2);
if (COMMAND.length === 0) {
  console.error("Usage: node bridge.cjs -- <command> [args...]");
  process.exit(1);
}

let buffer = "";
const pending = new Map();
let nextId = 1;

const proc = spawn(COMMAND[0], COMMAND.slice(1), {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});

proc.stderr.on("data", (chunk) => {
  const line = chunk.toString().trim();
  if (line) console.error("[mcp stderr]", line);
});

proc.on("exit", (code) => {
  console.error(`MCP process exited with code ${code}`);
  process.exit(code || 1);
});

function send(msg) {
  proc.stdin.write(JSON.stringify(msg) + "\n");
}

proc.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  while (true) {
    const idx = buffer.indexOf("\n");
    if (idx === -1) break;
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line || !line.startsWith("{")) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        const req = pending.get(msg.id);
        clearTimeout(req.timer);
        pending.delete(msg.id);
        req.resolve(msg);
      }
    } catch { /* skip */ }
  }
});

function sendMcp(message, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = message.id ?? nextId++;
    message.id = id;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    send(message);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", name: "mcp-hermes-atlas" }));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let message;
  try { message = JSON.parse(Buffer.concat(chunks).toString()); }
  catch { res.writeHead(400); res.end("Invalid JSON"); return; }
  try {
    const response = await sendMcp(message, 60000);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  } catch (err) {
    res.writeHead(504);
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`MCP bridge listening on http://${HOST}:${PORT}/mcp`);
  console.log(`Command: ${COMMAND.join(" ")}`);
});
