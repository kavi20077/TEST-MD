import { makeWASocket, useMultiFileAuthState, DisconnectReason, delay } from '@whiskeysockets/baileys';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pino from 'pino';
import http from 'http';

// 1. Settings
const PAIRING_NUMBER = process.env.PHONE_NUMBER; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

// 2. Health Check
const port = process.env.PORT || 8000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is Alive!');
});
server.listen(port, () => console.log(`Server running on port ${port}`));

// --- Bot Logic ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false, // QR එපා
        // Browser එක කෙලින්ම Ubuntu කියලා දාමු
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        retryRequestDelayMs: 5000,
        connectTimeoutMs: 60000, // Connection එකට වැඩි වෙලාවක් දෙනවා
    });

    // 🔴 Pairing Logic (Slow & Steady)
    if (!sock.authState.creds.registered) {
        if (!PAIRING_NUMBER) {
            console.log("❌ Error: PHONE_NUMBER not set! Check Koyeb Settings.");
        } else {
            // නම්බර් එක හරියට තියෙනවද බලන්න Log එකක් (අග ඉලක්කම් 4 විතරක් පෙන්නනවා)
            const maskedNum = PAIRING_NUMBER.slice(-4);
            console.log(`⏳ Waiting 15 seconds to pair with ...${maskedNum}`);
            
            // තත්පර 15ක් ඉන්නවා Connection එක Stable වෙනකම්
            setTimeout(async () => {
                try {
                    console.log("🚀 Requesting Pairing Code Now...");
                    const pairingCode = await sock.requestPairingCode(PAIRING_NUMBER);
                    console.log(`\n\n🟢 YOUR PAIRING CODE: ${pairingCode} 🟢\n\n`);
                } catch (err) {
                    console.log("⚠️ Pairing Failed:", err.message);
                    console.log("Restarting to try again...");
                    // Error ආවොත් විතරක් process එක නවත්තනවා, එතකොට Koyeb එක ආයේ පටන් ගනී
                    process.exit(1); 
                }
            }, 15000); // 15 Seconds Delay
        }
    }
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
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

// Crash Handler
process.on('uncaughtException', function (err) {
    console.log('Caught exception: ' + err);
});

connectToWhatsApp();
