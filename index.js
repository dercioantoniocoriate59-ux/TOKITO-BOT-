import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore, jidNormalizedUser, downloadMediaMessage
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import fs from "node:fs";
import path from "node:path";
import { BOT, AUTH_DIR, DATA_DIR } from "./config.js";
import { handleMessage } from "./src/handler.js";
import { onGroupParticipantsUpdate } from "./src/events.js";

fs.mkdirSync(AUTH_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const logger = pino({ level: process.env.LOG_LEVEL || "silent" });

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); }
  catch { version = undefined; }

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    browser: [BOT.name, "Chrome", "1.0.0"],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\nLeia este QR no WhatsApp: Dispositivos conectados > Conectar dispositivo");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") console.log(`✅ ${BOT.name} conectado.`);
    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log("Ligação interrompida. A tentar reconectar...");
        setTimeout(startBot, 3000);
      } else {
        console.log("Sessão terminada. Apague a pasta auth e ligue novamente para emparelhar.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try { await handleMessage(sock, msg); }
      catch (err) { console.error("Erro ao processar mensagem:", err?.message || err); }
    }
  });

  sock.ev.on("group-participants.update", async update => {
    try { await onGroupParticipantsUpdate(sock, update); }
    catch (err) { console.error("Erro de evento do grupo:", err?.message || err); }
  });
}

startBot().catch(err => {
  console.error("Falha ao iniciar:", err);
  process.exit(1);
});
