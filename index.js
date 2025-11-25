import { makeWASocket, useMultiFileAuthState, DisconnectReason, delay } from '@whiskeysockets/baileys';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pino from 'pino';
import http from 'http';

const PAIRING_NUMBER = process.env.PHONE_NUMBER; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

// Health Check Server
const port = process.env.PORT || 8000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is Alive!');
});
server.listen(port, () => console.log(`Server running on port ${port}`));

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        // Connection එක stable තියාගන්න settings
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        retryRequestDelayMs: 2000,
    });

    // 🔴 Pairing Code Logic (Updated with DELAY)
    if (!sock.authState.creds.registered) {
        if (!PAIRING_NUMBER) {
            console.log("❌ Error: PHONE_NUMBER variable not found!");
        } else {
            // මෙතන අපි තත්පර 10ක් ඉන්නවා connection එක stable වෙනකම්
            console.log("⏳ Waiting 10 seconds for stable connection...");
            setTimeout(async () => {
                try {
                    const pairingCode = await sock.requestPairingCode(PAIRING_NUMBER);
                    console.log(`\n\n🟢 YOUR PAIRING CODE: ${pairingCode} 🟢\n\n`);
                } catch (err) {
                    console.log("⚠️ Pairing Failed (Retrying in 5s...):", err.message);
                    // Error ආවොත් බොට්ව මරන්නේ නෑ
                }
            }, 10000); // 10000ms = 10 seconds
        }
    }
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("🔄 Reconnecting...");
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Bot Connected Successfully!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const m = messages[0];
            if (!m.message) return;

            const key = m.key;
            const from = key.remoteJid;
            const isMe = key.fromMe;

            if (from === 'status@broadcast') {
                await sock.readMessages([key]);
                return;
            }

            if (from.endsWith('@g.us')) return;

            const messageContent = m.message.conversation || m.message.extendedTextMessage?.text;
            if (!messageContent || isMe) return;

            if(!GEMINI_API_KEY) return;
            
            const model = genAI.getGenerativeModel({ model: "gemini-pro"});
            const result = await model.generateContent(messageContent);
            const response = await result.response;
            const text = response.text();

            await sock.sendMessage(from, { text: text }, { quoted: m });

        } catch (err) {
            console.log("Error:", err);
        }
    });
}

// Global Error Handler
process.on('uncaughtException', function (err) {
    console.log('Caught exception: ' + err);
});

connectToWhatsApp();
