import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { Client, LocalAuth } from "whatsapp-web.js";

dotenv.config();
const app = express();
app.use(express.json());

// ✅ Crea il client WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "session-whatsapp" }),
  puppeteer: { headless: true } // senza interfaccia grafica
});

// ✅ Quando il client è pronto
client.on("ready", () => {
  console.log("✅ WhatsApp pronto!");
});

// ✅ Quando arriva un messaggio
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
    console.error("Errore invio messaggio a Supabase:", err);
  }
});

// ✅ Endpoint per inviare messaggi da Supabase → WhatsApp
app.post("/send", async (req, res) => {
  const { to, message } = req.body;
  try {
    await client.sendMessage(to, message);
    res.json({ success: true });
  } catch (err) {
    console.error("Errore invio WhatsApp:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Endpoint per mostrare stato o QR
app.get("/status", async (req, res) => {
  const state = client.info?.pushname ? "CONNECTED" : "DISCONNECTED";
  if (state === "DISCONNECTED") {
    // Genera QR se non connesso
    client.generateQR().then(qr => {
      res.json({ connected: false, qr });
    }).catch(() => {
      res.json({ connected: false, message: "Impossibile generare QR" });
    });
  } else {
    res.json({ connected: true });
  }
});

// ✅ Avvia server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server attivo su porta ${PORT}`));

// ✅ Avvia client WhatsApp
client.initialize();
