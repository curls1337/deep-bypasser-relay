/**
 * ============================================================================
 * DEEP BYPASSER - RELAY SERVER
 * Pengganti: https://db-auth-svc-v2.testdeep.workers.dev
 *
 * Endpoint yang digunakan extension:
 *   GET  /notification          → Banner notifikasi ke extension
 *   GET  /version               → Cek update versi
 *   POST /ext/pulse             → Terima telemetry (payment events)
 *   POST /risk/evaluate         → Risk score evaluation
 *   GET  /analytics/rules       → Rules untuk analytics bypass
 *   POST /relay/3ds2            → Relay request 3DS ke Stripe
 * ============================================================================
 */

const express = require("express");
const app = express();

// ============================================================================
// KONFIGURASI
// ============================================================================

const CONFIG = {
  // Versi extension
  CURRENT_VERSION: "2.7",
  LATEST_VERSION:  "2.7",   // Ganti ke versi baru jika ada update
  DOWNLOAD_URL:    null,     // URL download jika ada update
  CHANGELOG:       null,     // Catatan perubahan

  // Banner notifikasi (null = tidak ada)
  // Contoh aktif:
  // NOTIFICATION: {
  //   message: "Server aktif! Semua fitur berjalan normal.",
  //   type: "info",        // "info" | "success" | "warning" | "error"
  //   dismissible: true,
  //   id: "notif-001"
  // }
  NOTIFICATION: null,
};

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Parse JSON body
app.use(express.json({ limit: "2mb" }));
// Parse binary body (untuk /ext/pulse yang mengirim AES-GCM terenkripsi)
app.use(express.raw({ type: "application/octet-stream", limit: "2mb" }));

// CORS — wajib agar Chrome extension bisa akses
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Req-Id, X-DB-Stats, X-DB-License, X-DB-Timestamp, X-DB-Signature, X-DB-Session, X-Original-Origin, X-Original-Referer, Idempotency-Key"
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// Logger sederhana
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// ENDPOINT: GET /
// Health check
// ============================================================================
app.get("/", (req, res) => {
  res.json({
    ok: true,
    status: "online",
    name: "Deep Bypasser Relay",
    version: CONFIG.CURRENT_VERSION,
    ts: Date.now(),
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "online", ts: Date.now() });
});

// ============================================================================
// ENDPOINT: GET /notification
// Extension mengambil banner notifikasi dari sini.
// Response: { notification: null } atau { notification: { message, type, ... } }
// ============================================================================
app.get("/notification", (req, res) => {
  res.json({
    ok: true,
    notification: CONFIG.NOTIFICATION,
  });
});

// ============================================================================
// ENDPOINT: GET /version
// Cek apakah ada update extension.
// Query param: ?v=2.7 (versi extension yang sedang dipakai user)
// Response: { updateAvailable, latest, downloadUrl, changelog }
// ============================================================================
app.get("/version", (req, res) => {
  const clientVersion = String(req.query.v || "0");
  const updateAvailable =
    CONFIG.LATEST_VERSION !== CONFIG.CURRENT_VERSION &&
    CONFIG.LATEST_VERSION > clientVersion;

  res.json({
    ok: true,
    current: clientVersion,
    latest: CONFIG.LATEST_VERSION,
    updateAvailable: updateAvailable,
    downloadUrl: updateAvailable ? CONFIG.DOWNLOAD_URL : null,
    changelog: updateAvailable ? CONFIG.CHANGELOG : null,
  });
});

// ============================================================================
// ENDPOINT: POST /ext/pulse
// Menerima telemetry terenkripsi dari extension.
// Body: binary AES-GCM (application/octet-stream)
// Headers: X-Req-Id, X-DB-Stats
// Response: { ok: true, received: true }
// ============================================================================
app.post("/ext/pulse", (req, res) => {
  const reqId = req.headers["x-req-id"] || "-";
  const bodyLen = Buffer.isBuffer(req.body) ? req.body.length : 0;
  console.log(`  [pulse] reqId=${reqId} bytes=${bodyLen}`);
  res.json({ ok: true, received: true });
});

// ============================================================================
// ENDPOINT: POST /risk/evaluate
// Risk evaluation — extension kirim data session untuk dapat risk score.
// Body: JSON { riskAuth: { licenseKey, sessionId, accessToken, ... }, ... }
// Response: { riskScore, riskLevel, recommendedAction, reasons, rateLimit }
// ============================================================================
app.post("/risk/evaluate", (req, res) => {
  const idempotencyKey = req.headers["idempotency-key"] || "";

  res.json({
    ok: true,
    riskScore: 12,
    riskLevel: "low",
    recommendedAction: "allow",
    evaluationId: "eval-" + Date.now().toString(36),
    idempotencyKey: idempotencyKey || undefined,
    reasons: [],
    rateLimit: {
      limit: 100,
      remaining: 97,
      resetAt: Date.now() + 3600000,
    },
    ts: Date.now(),
  });
});

// ============================================================================
// ENDPOINT: GET /analytics/rules
// Extension mengambil aturan bypass analytics.
// Headers: Authorization: Bearer <accessToken>, X-DB-Session: <sessionId>
// Response: { rules: [...], fetchedAt }
// ============================================================================
app.get("/analytics/rules", (req, res) => {
  const auth = req.headers["authorization"] || "";
  const session = req.headers["x-db-session"] || "";

  // Rules kosong = tidak ada pembatasan analytics
  res.json({
    ok: true,
    trusted: true,
    rules: [],
    fetchedAt: new Date().toISOString(),
    ts: Date.now(),
  });
});

// ============================================================================
// ENDPOINT: POST /relay/3ds2
// Relay request 3DS ke Stripe untuk bypass.
// Headers: X-DB-License, X-DB-Timestamp, X-DB-Signature,
//          X-Original-Origin, X-Original-Referer
// Body: form-urlencoded (diteruskan ke Stripe)
// Response: JSON dari Stripe (state, ares.transStatus, error)
// ============================================================================
app.post("/relay/3ds2", async (req, res) => {
  const licenseKey = req.headers["x-db-license"] || "";
  const targetUrl  = req.headers["x-target-url"] || "";

  // Validasi URL target (harus ke Stripe)
  const urlToForward = targetUrl || "https://api.stripe.com/v1/payment_intents";

  if (!urlToForward.includes("stripe.com")) {
    return res.status(400).json({
      ok: false,
      error: "Invalid target: only stripe.com allowed",
    });
  }

  try {
    const forwardHeaders = {
      "Content-Type": req.headers["content-type"] || "application/x-www-form-urlencoded",
    };

    // Teruskan origin & referer asli jika ada
    if (req.headers["x-original-origin"]) {
      forwardHeaders["Origin"] = req.headers["x-original-origin"];
    }
    if (req.headers["x-original-referer"]) {
      forwardHeaders["Referer"] = req.headers["x-original-referer"];
    }

    // Body bisa string atau buffer
    const bodyToSend =
      typeof req.body === "string"
        ? req.body
        : Buffer.isBuffer(req.body)
        ? req.body
        : JSON.stringify(req.body);

    const stripeResponse = await fetch(urlToForward, {
      method: "POST",
      headers: forwardHeaders,
      body: bodyToSend,
    });

    const responseText = await stripeResponse.text();

    let responseData = null;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      // Bukan JSON, kembalikan as-is
    }

    res.status(stripeResponse.status).json(
      responseData || { raw: responseText }
    );
  } catch (error) {
    console.error("  [relay/3ds2] Error:", error.message);
    res.status(502).json({
      ok: false,
      error: "Relay failed: " + error.message,
    });
  }
});

// ============================================================================
// 404 fallback
// ============================================================================
app.use((req, res) => {
  console.log(`  [404] ${req.method} ${req.path}`);
  res.status(404).json({ ok: false, error: "Not found" });
});

// ============================================================================
// ERROR HANDLER
// ============================================================================
app.use((err, req, res, next) => {
  console.error("  [error]", err.message);
  res.status(500).json({ ok: false, error: "Internal server error" });
});

// ============================================================================
// START
// ============================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`====================================`);
  console.log(`Deep Bypasser Relay Server`);
  console.log(`Port    : ${PORT}`);
  console.log(`Version : ${CONFIG.CURRENT_VERSION}`);
  console.log(`====================================`);
});
