            // Create client
            this.client = await createWhatsAppClient();

            // FORZAR PAIRING CODE CON ESPERA SEGURA
            if (!hasSession) {
                const phoneNumber = "50671531073";
                console.log(`📱 Preparando enlace para el número: ${phoneNumber}`);
                
                // Esperar a que el socket abra la conexión de red correctamente antes de pedir el código
                this.client.ev.on('connection.update', async (update) => {
                    const { connection } = update;
                    if (connection === 'open') {
                        console.log("✅ ¡Conexión establecida con éxito!");
                    }
                });

                setTimeout(async () => {
                    try {
                        if (!this.client.authState.creds.registered) {
                            console.log(`✨ Solicitando código de emparejamiento para ${phoneNumber}...`);
                            const code = await this.client.requestPairingCode(phoneNumber);
                            console.log(`🔑 ==========================================`);
                            console.log(`🔑 TU CÓDIGO DE EMPAREJAMIENTO ES: ${code}`);
                            console.log(`🔑 ==========================================`);
                        }
                    } catch (err) {
                        console.error("❌ Error al solicitar el código de emparejamiento:", err);
                    }
                }, 6000); // 6 segundos de gracia para evitar el cierre 428
            }
