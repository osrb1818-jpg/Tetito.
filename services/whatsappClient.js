import { default as makeWASocket, DisconnectReason, Browsers, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { commands } from "../commands/index.js";
import { getCachedConfig, updateConfig, invalidateConfigCache, AUTH_INFO_PATH } from "./configService.js";
import { getRepoStats as getCachedRepoStats } from "../utils/githubStats.js";
import { handleGroupParticipantsUpdate, handleGroupMessage } from "./groupEventHandler.js";
import { addAutoReaction, getRandomEmoji } from "../utils/reactionUtils.js";

export const messageCache = new Map();

// Memoized logo & video for efficiency
let logoBuffer = null;
let welcomeVideoBuffer = null;
try {
    logoBuffer = readFileSync(join(process.cwd(), "assets", "tervux-logo.png"));
    welcomeVideoBuffer = readFileSync(join(process.cwd(), "assets", "tervux-welcome-video.mp4"));
} catch (e) {
    console.error("❌ Failed to load assets:", e.message);
}

// Memory monitoring
setInterval(() => {
    const memory = process.memoryUsage();
    const rssMB = (memory.rss / 1024 / 1024).toFixed(1);
    const heapUsedMB = (memory.heapUsed / 1024 / 1024).toFixed(1);
    console.log(`📊 [Memory] RSS: ${rssMB}MB | Heap: ${heapUsedMB}MB`);

    if (memory.rss > 420 * 1024 * 1024 && global.gc) {
        console.warn(`🧹 CRITICAL: Memory RSS high. Triggering Manual GC...`);
        global.gc();
    }
}, 30000);

// Single client instance (single-user bot)
let activeClient = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

export async function createWhatsAppClient() {
    const config = getCachedConfig();

    // Session Restoration Logic for Cloud Platforms (Heroku/Railway/Render)
    const credsPath = join(AUTH_INFO_PATH, "creds.json");
    if (process.env.SESSION_ID && !existsSync(credsPath)) {
        const sessionId = process.env.SESSION_ID.trim();
        if (sessionId.startsWith("Tervux-")) {
            try {
                console.log("🔄 Restoring session from environment variable...");
                mkdirSync(AUTH_INFO_PATH, { recursive: true });
                const code = sessionId.replace("Tervux-", "");
                const decoded = Buffer.from(code, "base64").toString();

                try {
                    const sessionObj = JSON.parse(decoded);
                    const creds = sessionObj.creds ? JSON.stringify(sessionObj.creds) : decoded;
                    writeFileSync(join(AUTH_INFO_PATH, "creds.json"), creds);
                } catch (e) {
                    writeFileSync(join(AUTH_INFO_PATH, "creds.json"), decoded);
                }
                console.log("✅ Session restored successfully!");
            } catch (e) {
                console.error("❌ Failed to restore session:", e.message);
            }
        }
    }

    // Use Baileys built-in file-based auth
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_INFO_PATH);

    console.log(`🔌 Creating WhatsApp socket...`);

    const sock = makeWASocket({
        logger: pino({ level: "silent" }),
        auth: state,
        browser: Browsers.ubuntu("Chrome"),
        syncFullHistory: false,
        defaultQueryTimeoutMs: 180000,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 3000,
        qrTimeout: 60000,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        getMessage: async (key) => {
            const msg = messageCache.get(key.id);
            return msg?.message;
        }
    });

    // Apply Global Auto-Reaction
    addAutoReaction(sock);

    sock.ev.on("creds.update", async () => {
        await saveCreds();
    });

    // Pairing Code Logic - Forzado con tu número fijo
    const hasValidSession = state.creds?.registered || state.creds?.me?.id;
    const targetPhone = "50671531073"; // Tu número configurado
    
    if (!hasValidSession) {
        console.log(`\n📱 Usando número forzado para Pairing Code: ${targetPhone}`);
        console.log(`🔄 Switching to Pairing Code mode...`);
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(targetPhone);
                console.log(`\n📞 𝗣𝗔𝗜𝗥𝗜𝗡𝗚 𝗖𝗢𝗗𝗘: ${code}`);
                console.log(`👉 Ingresa este código en WhatsApp > Dispositivos vinculados > Vincular dispositivo > Vincular con el número de teléfono\n`);
            } catch (e) {
                console.error("❌ Failed to request pairing code:", e.message);
            }
        }, 5000);
    }

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === "connecting") {
            console.log(`🔌 Connecting to WhatsApp...`);
        }

        if (connection === "close") {
            if (sock.onlineInterval) clearInterval(sock.onlineInterval);

            const error = lastDisconnect?.error;
            const statusCode = error?.output?.statusCode;
            const errorMessage = error?.message || "";

            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            const isConflict = errorMessage.includes("conflict") ||
                statusCode === DisconnectReason.connectionReplaced;

            console.log(`❌ Connection closed. Code: ${statusCode}, Error: ${errorMessage}`);

            if (isLoggedOut) {
                console.log(`🔓 Logged out! Please check your connection.`);
                reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
            } else if (isConflict) {
                console.log(`⚠️ Session active on another device.`);
            } else if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(5000 * Math.pow(1.5, reconnectAttempts), 60000);
                console.log(`🔄 Reconnecting in ${delay / 1000}s (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                setTimeout(() => {
                    createWhatsAppClient().then(client => {
                        activeClient = client;
                    });
                }, delay);
            } else {
                console.log(`❌ Max reconnection attempts reached. Please restart manually.`);
            }
        }

        if (connection === "open") {
            console.log(`✅ WhatsApp connected successfully!`);
            reconnectAttempts = 0;

            const phoneNumber = sock.user?.id?.split(":")[0] || sock.user?.id?.split("@")[0];
            if (phoneNumber) {
                updateConfig({ phone: phoneNumber, name: sock.user?.name || "Bot User" });
                invalidateConfigCache();
            }

            try {
                const config = getCachedConfig();
                const botJid = (sock.user.id.split("@")[0].split(":")[0]) + "@s.whatsapp.net";
                const stats = await getCachedRepoStats();

                const githubSection = stats ?
                    `╭───『 📊 *𝔾𝕀𝕋ℍ𝕌𝔹 𝕊𝕋𝔸𝕋𝕊* 』───╮
│ ⭐ *Stars:* ${stats.stars}
│ 🍴 *Forks:* ${stats.forks}
│ 🐞 *Issues:* ${stats.issues}
│ 📅 *Created:* ${stats.createdAt}
│ 🔄 *Updated:* ${stats.updatedAt}
╰──────────────────────────────╯` : "";

                const p = config.prefix || "!";

                const welcomeMsg = `╭─━─━━━━━━━━━━━━━━━━━━─━─╮
   🚀 *𝕋𝔼ℝ𝕍𝕌𝕏 𝕋𝔼ℂℍℕ𝕆𝕃𝕆𝔾𝕀𝔼𝕊* 🚀
╰─━─━━━━━━━━━━━━━━━━━━─━─╯

✨ *Welcome to the Digital Future!* ✨
Your high-performance Tervux AI Assistant is now active.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 *𝔹𝕆𝕋 ℂ𝔸ℙ𝔸𝔹𝕀𝕃𝕀𝕋𝕀𝔼𝕊*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ *Multimedia* - Music, Videos, Memes, & Lyrics
🤖 *Ai Power* - Intelligent Chat & Image Generation
🛡️ *Security* - Advanced Anti-Delete & Antilink
🎮 *Entertainment* - Games, Jokes, & Trivia
⚙️ *Utilities* - Unit conversion, QR, & Weather

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏢 *𝔸𝔹𝕆𝕌𝕋 𝕋𝔼ℝ𝕍𝕌𝕏 ℂ𝕆𝕄ℙ𝔸ℕ𝕐*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Transforming Business With Elegant Technology.*
We turn your ideas into powerful digital products.

🌐 *Website:* https://www.tervux.com
📧 *Contact:* info@tervux.com

🛠️ *𝕆𝕦𝕣 𝔼𝕩𝕡𝕖𝕣𝕥𝕚𝕤𝕖:*
💻 *Web Apps* - Lightning-fast modern frameworks
📱 *Mobile* - Native & Hybrid iOS/Android apps
🎨 *Design* - Premium UI/UX experiences
☁️ *Cloud* - Robust & scalable infrastructure
📊 *Data* - AI/ML & Advanced Analytics
💡 *Consulting* - Strategic Tech Advisory

🏆 *𝕎𝕙𝕪 ℙ𝕒𝕣𝕥𝕟𝕖𝕣 𝕎𝕚𝕥𝕙 𝕌𝕤?*
✅ *Lightning Fast* performance
✅ *Secure & Reliable* systems
✅ *Modular Design* for future growth
✅ *Global Scale* infrastructure

${githubSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 *Type [ ${p}help ] to explore all features!*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

                if (welcomeVideoBuffer) {
                    await sock.sendMessage(botJid, {
                        video: welcomeVideoBuffer,
                        caption: welcomeMsg,
                        gifPlayback: false
                    });
                } else if (logoBuffer) {
                    await sock.sendMessage(botJid, {
                        image: logoBuffer,
                        caption: welcomeMsg
                    });
                } else {
                    await sock.sendMessage(botJid, { text: welcomeMsg });
                }
                console.log(`📬 Welcome message sent!`);
            } catch (e) {
                console.error("Failed to send welcome:", e.message);
            }

            if (sock.onlineInterval) clearInterval(sock.onlineInterval);
            sock.onlineInterval = setInterval(async () => {
                const config = getCachedConfig();
                if (config.alwaysOnline && sock.ws?.readyState === 1) {
                    try {
                        await sock.sendPresenceUpdate("available");
                    } catch (e) { }
                }
            }, 30000);
        }
    });

    // Anti-Call Logic
    sock.ev.on("call", async (node) => {
        const config = getCachedConfig();
        if (config.antiCall) {
            for (const call of node) {
                if (call.status === "offer") {
                    try {
                        await sock.rejectCall(call.id, call.from);
                        await sock.sendMessage(call.from, {
                            text: "📵 *Tervux Bot*\n\nCalls are automatically rejected. Please send a text message instead."
                        });
                        console.log(`📵 Rejected call from ${call.from}`);
                    } catch (err) {
                        console.error("Anti-Call error:", err.message);
                    }
                }
            }
        }
    });

    sock.ev.on("group-participants.update", async (update) => {
        await handleGroupParticipantsUpdate(sock, update);
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        for (const m of messages) {
            if (m.key.remoteJid === "status@broadcast" && !m.key.fromMe) {
                if (m.message?.protocolMessage || m.message?.reactionMessage) continue;

                const config = getCachedConfig();
                const participant = m.key.participant || m.participant;

                try {
                    if (config.autoViewStatus) {
                        await sock.readMessages([m.key]);
                    }

                    if (config.autoLikeStatus) {
                        const randomEmoji = getRandomEmoji();
                        await sock.sendMessage(m.key.remoteJid, {
                            react: { text: randomEmoji, key: m.key }
                        }, { statusJidList: [participant] });
                    }
                } catch (err) {
                    console.error("Status Auto-Action Error:", err.message);
                }
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        for (const m of messages) {
            if (!m.message) continue;
            if (m.message.protocolMessage) continue;
            if (m.message.reactionMessage) continue;
            if (m.message.pollUpdateMessage) continue;

            const msgType = Object.keys(m.message)[0];
            const validTypes = [
                'conversation', 'extendedTextMessage', 'imageMessage',
                'videoMessage', 'audioMessage', 'documentMessage',
                'stickerMessage', 'contactMessage', 'locationMessage',
                'viewOnceMessage', 'viewOnceMessageV2', 'ephemeralMessage'
            ];

            if (validTypes.includes(msgType)) {
                messageCache.set(m.key.id, m);
            }

            if (messageCache.size > 500) {
                const firstKey = messageCache.keys().next().value;
                messageCache.delete(firstKey);
            }
        }
    });

    return sock;
}
