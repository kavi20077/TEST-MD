import { makeWASocket, useMultiFileAuthState, DisconnectReason, delay } from '@whiskeysockets/baileys';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pino from 'pino';
import http from 'http';

// 1. Phone number එක
const PAIRING_NUMBER = process.env.PHONE_NUMBER; 

// 2. Health Check Server
const port = process.env.PORT || 8000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is Alive!');
});
server.listen(port, () => console.log(`Server running on port ${port}`));

// --- Bot Logic ---

const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false, // QR ඕනේ නෑ
        // 🛑 වැදගත්ම වෙනස: Browser එක මෙහෙම දාන්න
        browser: ["Ubuntu", "Chrome", "20.0.04"], 
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false, // History එක sync වෙන එක නවත්තනවා (Speed එක වැඩි කරන්න)
        retryRequestDelayMs: 5000, 
    });

    if (!sock.authState.creds.registered) {
        if (!PAIRING_NUMBER) {
            console.log("❌ Error: PHONE_NUMBER not set!");
        } else {
            try {
                // තත්පර 4ක් ඉඳලා code එක ඉල්ලනවා
                await delay(4000);
                const pairingCode = await sock.requestPairingCode(PAIRING_NUMBER);
                // Code එක පැහැදිලිව පෙන්වන්න
                console.log(`\n\n🟢 YOUR PAIRING CODE: ${pairingCode} 🟢\n\n`);
            } catch (err) {
                console.log("⚠️ Pairing Error:", err.message);
            }
        }
    }
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            // Connection වැටුනොත් ඉක්මනට එන්න කියනවා
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Bot Connected Successfully!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('
