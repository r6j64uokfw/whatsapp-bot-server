import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import pkg from "whatsapp-web.js";

const { Client, LocalAuth } = pkg;

dotenv.config();
const app = express();
app.use(express.json());

// ✅ Crea il client WhatsApp compatibile con Render
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

// ✅ Evento quando WhatsApp è pronto
client.on("ready", () => {
  console.log("✅ WhatsApp pronto!");
});

// ✅ Evento per ricezione messaggi
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

// ✅ Endpoint per inviare messaggi da Supabase → WhatsApp
app.post("/send", async (req, res) => {
  const { to, message } = req.body;
  try {
    await client.sendMessage(to, message);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Errore invio WhatsApp:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Endpoint per lo stato
app.get("/status", (req, res) => {
  const connected = !!client.info;
  res.json({
    connected,
    message: connected ? "WhatsApp connesso" : "WhatsApp non connesso",
  });
});

// ✅ Avvia server HTTP
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server attivo su porta ${PORT}`));

// ✅ Avvia client WhatsApp
client.initialize();
