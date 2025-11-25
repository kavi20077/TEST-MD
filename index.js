import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pino from 'pino';

// Koyeb Environment Variable එකෙන් API Key එක ගන්නවා
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true, // QR එක Log එකේ පෙන්නන්න
        auth: state,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if(qr) {
            console.log("Scan this QR Code from Koyeb Logs:");
        }

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

            // 1. Auto Status Read
            if (from === 'status@broadcast') {
                await sock.readMessages([key]);
                console.log(`👀 Auto Read Status`);
                return;
            }

            // 2. Inbox Only
            if (from.endsWith('@g.us')) return;

            const messageContent = m.message.conversation || m.message.extendedTextMessage?.text;
            if (!messageContent || isMe) return;

            console.log(`📩 Chat: ${messageContent}`);

            // 3. Gemini AI Reply
            if(!GEMINI_API_KEY) {
                console.log("Error: Gemini API Key not found!");
                return;
            }
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
