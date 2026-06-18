#!/usr/bin/env node
/**
 * hermes-atlas-install — Downloads the Hermes Atlas embeddings for local RAG queries.
 *
 * Usage:
 *   npx hermes-atlas-mcp install-embeddings
 *   npx hermes-atlas-install
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data", "embeddings");
const CHUNKS_URL = "https://raw.githubusercontent.com/ksimback/hermes-ecosystem/main/data/chunks.json";

async function main() {
  console.log("🧠 Hermes Atlas — Installing local embeddings\n");

  await mkdir(DATA_DIR, { recursive: true });
  const outPath = join(DATA_DIR, "chunks.json");

  // Check if already installed
  try {
    await access(outPath);
    console.log("⚠️  Embeddings already installed at:");
    console.log(`   ${outPath}`);
    console.log("\n   Delete the file to re-install.");
    process.exit(0);
  } catch {
    // Not installed — proceed
  }

  const url = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : CHUNKS_URL;

  console.log(`📥 Downloading chunks.json (~70MB) from GitHub...`);
  console.log(`   ${url}\n`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`❌ Download failed: HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const contentLength = Number(res.headers.get("content-length") || 0);
  const totalMB = (contentLength / (1024 * 1024)).toFixed(1);
  if (totalMB !== "0.0") {
    console.log(`   Size: ${totalMB} MB\n`);
  }

  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  process.stdout.write("   ");

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const mb = (received / (1024 * 1024)).toFixed(1);
    process.stdout.write(`\r   ${totalMB !== "0.0" ? `${mb}/${totalMB}` : `${mb}`} MB`);
  }

  const buffer = Buffer.concat(chunks);
  await writeFile(outPath, buffer);

  process.stdout.write("\r");
  console.log(`   ${(buffer.length / (1024 * 1024)).toFixed(1)} MB ✓`);
  console.log(`\n✅ Embeddings installed successfully!`);
  console.log(`   Location: ${outPath}`);
  console.log(`\n   The MCP server will automatically detect and use these embeddings.`);
  console.log(`   Run the server with: npx hermes-atlas-mcp`);
}

main().catch(err => {
  console.error("❌ Installation failed:", err.message);
  process.exit(1);
});
