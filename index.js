import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import pkg from "whatsapp-web.js";
import QRCode from "qrcode";

const { Client, LocalAuth } = pkg;

dotenv.config();
const app = express();
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL || "https://aglhxifimuwbzjmhqdac.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "<eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbGh4aWZpbXV3YnpqbWhxZGFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5OTUxODQsImV4cCI6MjA3NjU3MTE4NH0.I0H0uiap7H1ZH7jlXkhaVowS0yB0LGORqMV5g2bIG_0>";

console.log("SUPABASE_URL:", SUPABASE_URL);
console.log("SUPABASE_SERVICE_ROLE_KEY:", SUPABASE_SERVICE_ROLE_KEY);

let latestQrDataUrl = null;
let clientReady = false;

// Funzione per aggiornare lo stato su Supabase
async function updateStatusOnSupabase(status) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_status`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        status,
        updated_at: new Date().toISOString()
      }),
    });
    console.log(`✅ Stato '${status}' inviato a Supabase`);
  } catch (err) {
    console.error("❌ Errore invio stato a Supabase:", err);
  }
}

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

// QR code event
client.on("qr", async (qr) => {
  try {
    latestQrDataUrl = await QRCode.toDataURL(qr);
    console.log("📷 QR generato e salvato in memoria.");
  } catch (err) {
    console.error("❌ Errore generazione QR:", err);
    latestQrDataUrl = null;
  }
});

// WhatsApp ready event
client.on("ready", () => {
  clientReady = true;
  console.log("✅ WhatsApp pronto! Stato: connesso.");
  updateStatusOnSupabase("connected");
});

// WhatsApp disconnected event
client.on("disconnected", (reason) => {
  clientReady = false;
  console.log("⚠️ WhatsApp disconnesso! Motivo:", reason);
  updateStatusOnSupabase("disconnected");
});

// Message received event
client.on("message", async (msg) => {
  console.log("📩 Messaggio ricevuto:", msg.body);
  try {
    // Cerca la chat attiva in Supabase (in base al numero mittente)
    const chatResp = await fetch(`${SUPABASE_URL}/rest/v1/chats?numero=eq.${msg.from}`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });
    const chats = await chatResp.json();
    const chat_id = chats[0]?.id || null;

    // Salva il messaggio su Supabase
    const response = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id,
        sender: "whatsapp",
        message: msg.body,
        status: "received",
        created_at: new Date().toISOString()
      }),
    });
    console.log("✅ Messaggio inviato a Supabase. Status:", response.status);
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
  const { to, message, nome, cognome, chat_id } = req.body;
  console.log(`[API] Richiesta invio messaggio: to=${to}, message=${message}, nome=${nome}, cognome=${cognome}, chat_id=${chat_id}`);

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
    await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id,
        sender: "admin",
        message,
        status: "sent",
        nome,
        cognome,
        numero: to,
        created_at: new Date().toISOString()
      }),
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "send failed" });
  }
});

// GET /chats => restituisce solo le chat attive (senza messaggi)
app.get("/chats", async (req, res) => {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/chats?select=id,nome,cognome,numero,created_at,status`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });
    const chats = await resp.json();
    // Filtra solo le chat attive (status === 'active')
    const activeChats = chats.filter(chat => chat.status === "active");
    res.json(activeChats);
  } catch (err) {
    res.status(500).json({ error: err.message || "Errore recupero chat" });
  }
});

// GET /messages?chat_id=... => restituisce solo i messaggi della chat selezionata
app.get("/messages", async (req, res) => {
  const { chat_id } = req.query;
  if (!chat_id) {
    return res.status(400).json({ error: "chat_id richiesto" });
  }
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/messages?chat_id=eq.${chat_id}&order=created_at.asc`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });
    const messages = await resp.json();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message || "Errore recupero messaggi" });
  }
});

// GET /status
app.get("/status", (req, res) => {
  const connected = !!client.info && clientReady;
  res.json({
    connected,
    message: connected ? "WhatsApp connesso" : "WhatsApp non connesso",
    status: connected ? "connected" : "disconnected"
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
