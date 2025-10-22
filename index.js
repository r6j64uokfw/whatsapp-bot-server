import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import pkg from "whatsapp-web.js";
import QRCode from "qrcode"; // new dependency

const { Client, LocalAuth } = pkg;

dotenv.config();
const app = express();
app.use(express.json());

// memory holder
let latestQrDataUrl = null;
let clientReady = false;

// Create WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "session-whatsapp" }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process",
    ],
  },
});

client.on("qr", async (qr) => {
  try {
    latestQrDataUrl = await QRCode.toDataURL(qr);
    console.log("📷 QR generato e salvato in memoria.");
  } catch (err) {
    console.error("❌ Errore generazione QR:", err);
    latestQrDataUrl = null;
  }
});

client.on("ready", () => {
  clientReady = true;
  console.log("✅ WhatsApp pronto!");
});

// persist received messages to Supabase (same as before)
client.on("message", async (msg) => {
  console.log("📩 Messaggio ricevuto:", msg.body);
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/messages`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: msg.from,
        sender: "whatsapp",
        message: msg.body,
        status: "received",
      }),
    });
  } catch (err) {
    console.error("❌ Errore invio messaggio a Supabase:", err);
  }
});

// helper: normalize phone -> JID
function toJid(raw) {
  if (!raw) return null;
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  return `${digits}@c.us`;
}

// POST /send => send to WhatsApp
app.post("/send", async (req, res) => {
  const { to, message } = req.body;

  if (!clientReady) {
    return res.status(503).json({ error: "WhatsApp client not ready" });
  }
  if (!to || !message) {
    return res.status(400).json({ error: "Missing 'to' or 'message'" });
  }

  const jid = toJid(to);
  if (!jid) {
    return res.status(400).json({ error: "Invalid 'to' format" });
  }

  try {
    await client.sendMessage(jid, message);
    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Errore invio WhatsApp:", err);
    return res.status(500).json({ error: err.message || "send failed" });
  }
});

// GET /status
app.get("/status", (req, res) => {
  const connected = !!client.info && clientReady;
  res.json({
    connected,
    message: connected ? "WhatsApp connesso" : "WhatsApp non connesso",
  });
});

// GET /qr -> returns { qr: 'data:image/png;base64,...' } or 404
app.get("/qr", (req, res) => {
  if (latestQrDataUrl) {
    return res.json({ qr: latestQrDataUrl });
  } else {
    return res.status(404).json({ message: "Nessun QR disponibile al momento" });
  }
});

// start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server attivo su porta ${PORT}`));

// initialize
client.initialize();
