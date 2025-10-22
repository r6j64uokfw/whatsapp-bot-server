import express from "express";
import venom from "venom-bot";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();
const app = express();
app.use(express.json());

let client = null;

// ✅ Avvia Venom
venom
  .create({
    session: "session-whatsapp",
    multidevice: true,
  })
  .then((c) => start(c))
  .catch((err) => console.error("Errore Venom:", err));

function start(c) {
  client = c;

  console.log("✅ Venom pronto!");

  // Quando arriva un messaggio su WhatsApp
  client.onMessage(async (msg) => {
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
}

// ✅ Endpoint per inviare messaggi da Supabase → WhatsApp
app.post("/send", async (req, res) => {
  const { to, message } = req.body;
  if (!client) return res.status(500).json({ error: "WhatsApp non connesso" });

  try {
    await client.sendText(to, message);
    res.json({ success: true });
  } catch (err) {
    console.error("Errore invio WhatsApp:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Endpoint per mostrare stato o QR
app.get("/status", async (req, res) => {
  if (!client) {
    return res.json({ connected: false, message: "WhatsApp non inizializzato" });
  }

  const state = await client.getConnectionState().catch(() => "DISCONNECTED");
  res.json({ connected: state === "CONNECTED" });
});

// ✅ Avvia server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server attivo su porta ${PORT}`));
