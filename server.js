import app from "./app.js";
import { PORT } from "./env.js";
import { whatsappService } from "./services/whatsappService.js";
import { createServer } from "http";
import { initSocket } from "./services/socketService.js";
import { cleanStaleSessions } from "./services/cleanupService.js";

const httpServer = createServer(app);
initSocket(httpServer);

// Run cleanup on startup
cleanStaleSessions();

httpServer.listen(PORT, () => {
    console.log(`🚀 Tervux-Mini-Bot running on port ${PORT}`);
});

// Initialize WhatsApp con captura detallada de errores
whatsappService.init().catch(err => {
    console.error("🔥 FATAL WHATSAPP INIT ERROR DETAILS:");
    console.error("Message:", err.message);
    console.error("Stack:", err.stack);
});

// Global Error Handling
process.on("unhandledRejection", (reason, promise) => {
    console.error("🔥 Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
    console.error("🔥 Uncaught Exception:", err);
    if (
        err.message.includes("Unsupported state") ||
        err.message.includes("unable to authenticate") ||
        err.message.includes("fetch failed") ||
        err.code === "UND_ERR_CONNECT_TIMEOUT"
    ) {
        console.warn("⚠️ Ignored fatal network/decryption error to prevent process crash.");
    } else {
        console.error("🚀 Keeping server alive despite critical error.");
    }
});

// Graceful Shutdown
const shutdown = () => {
    console.log("🛑 Server shutting down...");
    setTimeout(() => {
        process.exit(0);
    }, 500);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

