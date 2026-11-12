import { createWhatsAppClient, getClient, clearSession } from "./whatsappClient.js";
import { existsSync } from "fs";
import { AUTH_INFO_PATH } from "./configService.js";

export const whatsappService = {
    client: null,

    async init() {
        try {
            console.log("🔄 Initializing WhatsApp Bot...");

            // Check if auth exists
            const hasSession = existsSync(AUTH_INFO_PATH) &&
                existsSync(`${AUTH_INFO_PATH}/creds.json`);

            // Create client
            this.client = await createWhatsAppClient();

            // Solicitar código de emparejamiento de forma segura si no hay sesión
            if (!hasSession) {
                const phoneNumber = "50671531073";
                console.log(`📱 Preparando enlace para el número: ${phoneNumber}`);
                
                setTimeout(async () => {
                    try {
                        if (this.client && typeof this.client.requestPairingCode === 'function') {
                            console.log(`✨ Solicitando código de emparejamiento para ${phoneNumber}...`);
                            const code = await this.client.requestPairingCode(phoneNumber);
                            console.log(`🔑 ==========================================`);
                            console.log(`🔑 TU CÓDIGO DE EMPAREJAMIENTO ES: ${code}`);
                            console.log(`🔑 ==========================================`);
                        }
                    } catch (err) {
                        console.error("❌ Error al solicitar el código:", err.message);
                    }
                }, 5000);
            }

            return this.client;
        } catch (error) {
            console.error("❌ Failed to initialize WhatsApp service:", error);
            throw error;
        }
    },

    getClient() {
        return getClient();
    },

    async logout() {
        const client = getClient();
        if (client) {
            try {
                await client.logout();
            } catch (e) {
                console.error("Logout error:", e);
            }
        }
        return clearSession();
    },

    async restart() {
        console.log("🔄 Restarting WhatsApp connection...");
        const client = getClient();
        if (client) {
            try {
                client.end();
            } catch (e) { }
        }
        return this.init();
    }
};

