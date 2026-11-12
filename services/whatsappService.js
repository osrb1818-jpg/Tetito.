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

            // FORZAR PAIRING CODE SI NO HAY SESION
            if (!hasSession && !this.client.authState.creds.registered) {
                const phoneNumber = "50671531073"; // Tu número configurado
                console.log(`📱 Solicitando código de emparejamiento para el número: ${phoneNumber}`);
                
                // Esperar un par de segundos a que la conexión esté lista para pedir el código
                setTimeout(async () => {
                    try {
                        const code = await this.client.requestPairingCode(phoneNumber);
                        console.log(`✨ TU CÓDIGO DE EMPAREJAMIENTO ES: ${code}`);
                    } catch (err) {
                        console.error("Error al solicitar el código de emparejamiento:", err);
                    }
                }, 4000);
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
