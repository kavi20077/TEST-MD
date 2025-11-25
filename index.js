import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pino from 'pino';
import http from 'http';

// 1. Phone number එක මෙතන දාන්න (country code සමග, + නැතුව)
const PAIRING_NUMBER = "YOUR_PHONE_NUMBER_HERE"; // උදා: "9471xxxxxxx"

// 2. Koyeb Health Check
const port = process.env.PORT || 8000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is Alive! WhatsApp is running.');
});

server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

// --- Bot Logic ---

const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['Koyeb Bot', 'Chrome', '1.0.0'], // Browser info for pairing
    });

    // 🔴 නව Pairing Code Logic එක
    if (!sock.authState.creds.registered) {
        const pairingCode = await sock.requestPairingCode(PAIRING_NUMBER);
        console.log(`\n\n🟢 YOUR PAIRING CODE IS: ${pairingCode} 🟢\n\n`);
    }
    // ---------------------------------
    
    sock.ev.on('connection.update', (update) => {
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

    // ... (rest of the message processing logic remains the same) ...
    // ... (the rest of the code is the same as before, only the sock initialization part changed) ...

    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const m = messages[0];
            if (!m.message) return;

            const key = m.key;
            const from = key.remoteJid;
            const isMe = key.fromMe;

            // 1. Auto Status Read
            if (from === 'status@broadcast') {
                await sock.readMessages([key]);
                return;
            }

            // 2. Inbox Only
            if (from.endsWith('@g.us')) return;

            const messageContent = m.message.conversation || m.message.extendedTextMessage?.text;
            if (!messageContent || isMe) return;

            // 3. Gemini AI Reply
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

connectToWhatsApp();
