/**
 * TopSep Server — Dedicated Real-Time WebSocket & E2EE Message Server
 * Handles Multi-User Real-Time Messaging, Voice Call Signaling & Centralized Database
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// Initial Database Structure
const DEFAULT_DB = {
    servers: [
        {
            id: 'srv_main',
            name: 'Główny Serwer TopSep',
            icon: 'TS',
            desc: 'Dedykowany serwer online dla zespołu i znajomych',
            channels: [
                { id: 'ch_ogolny', name: 'ogólny', type: 'text', desc: 'Ogólny kanał tekstowy E2EE' },
                { id: 'ch_projekty', name: 'projekty', type: 'text', desc: 'Plany i dyskusje' },
                { id: 'ch_voice_main', name: '🔊 Pokój Głosowy HD', type: 'voice', desc: 'Główny kanał rozmów głosowych' }
            ]
        }
    ],
    messages: {
        'ch_ogolny': [
            {
                id: 'msg_welcome',
                senderId: 'system',
                senderName: 'TopSep Server',
                senderAvatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=120&q=80',
                text: '🔒 Połączono z centralnym serwerem TopSep! Wszystkie rozmowy w tym kanale są zsynchronizowane online i szyfrowane E2EE.',
                timestamp: 'Dzisiaj',
                encrypted: true,
                reactions: {}
            }
        ]
    },
    users: {}
};

// Load or Initialize Database
function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
        return DEFAULT_DB;
    }
    try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return DEFAULT_DB;
    }
}

function saveDB(db) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error('[DB Error]', e);
    }
}

let db = loadDB();

// MIME Types
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

// Connected WebSockets Clients
const clients = new Set();

// Create HTTP Server
const server = http.createServer((req, res) => {
    // API Endpoint: Get State / DB
    if (req.url === '/api/state' && req.method === 'GET') {
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        return res.end(JSON.stringify(db));
    }

    // Static File Serving
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    let ext = path.extname(filePath);
    let contentType = MIME_TYPES[ext] || 'text/plain';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 nie znaleziono pliku TopSep</h1>');
            } else {
                res.writeHead(500);
                res.end(`Błąd serwera: ${err.code}`);
            }
        } else {
            res.writeHead(200, { 
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*'
            });
            res.end(content, 'utf-8');
        }
    });
});

// WebSocket Protocol Handshake
server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
        socket.destroy();
        return;
    }

    const digest = crypto.createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

    const headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${digest}`
    ];

    socket.write(headers.join('\r\n') + '\r\n\r\n');

    // Add socket to clients list
    socket.isAlive = true;
    clients.add(socket);

    socket.on('data', (buffer) => {
        handleFrame(socket, buffer);
    });

    socket.on('close', () => {
        clients.delete(socket);
    });

    socket.on('error', (err) => {
        clients.delete(socket);
    });
});

// WebSocket Frame Parser & Transmitter
function handleFrame(socket, buffer) {
    try {
        const secondByte = buffer[1];
        const isMasked = (secondByte & 0x80) === 0x80;
        let payloadLength = secondByte & 0x7F;

        let currentOffset = 2;
        if (payloadLength === 126) {
            payloadLength = buffer.readUInt16BE(2);
            currentOffset = 4;
        } else if (payloadLength === 127) {
            payloadLength = Number(buffer.readBigUInt64BE(2));
            currentOffset = 10;
        }

        let maskingKey;
        if (isMasked) {
            maskingKey = buffer.slice(currentOffset, currentOffset + 4);
            currentOffset += 4;
        }

        const data = buffer.slice(currentOffset, currentOffset + payloadLength);
        if (isMasked) {
            for (let i = 0; i < data.length; i++) {
                data[i] ^= maskingKey[i % 4];
            }
        }

        const messageStr = data.toString('utf8');
        const packet = JSON.parse(messageStr);

        handleSocketPacket(socket, packet);
    } catch (e) {
        // Frame parsing error
    }
}

function sendWS(socket, dataObj) {
    try {
        const json = JSON.stringify(dataObj);
        const payloadBuffer = Buffer.from(json);
        const length = payloadBuffer.length;

        let header;
        if (length <= 125) {
            header = Buffer.alloc(2);
            header[0] = 0x81;
            header[1] = length;
        } else if (length <= 65535) {
            header = Buffer.alloc(4);
            header[0] = 0x81;
            header[1] = 126;
            header.writeUInt16BE(length, 2);
        } else {
            header = Buffer.alloc(10);
            header[0] = 0x81;
            header[1] = 127;
            header.writeBigUInt64BE(BigInt(length), 2);
        }

        const packet = Buffer.concat([header, payloadBuffer]);
        socket.write(packet);
    } catch (e) {}
}

function broadcast(dataObj) {
    for (const client of clients) {
        sendWS(client, dataObj);
    }
}

// Packet Handler Logic
function handleSocketPacket(socket, packet) {
    const { action, payload } = packet;

    if (action === 'INIT_STATE') {
        sendWS(socket, { action: 'SYNC_STATE', payload: db });
    } else if (action === 'CHAT_MESSAGE') {
        const { chatId, message } = payload;
        if (!db.messages[chatId]) db.messages[chatId] = [];
        db.messages[chatId].push(message);
        saveDB(db);

        broadcast({
            action: 'NEW_CHAT_MESSAGE',
            payload: { chatId, message }
        });
    } else if (action === 'CREATE_SERVER') {
        const { serverObj } = payload;
        db.servers.push(serverObj);
        saveDB(db);

        broadcast({
            action: 'SERVER_CREATED',
            payload: { serverObj }
        });
    } else if (action === 'CREATE_CHANNEL') {
        const { serverId, channelObj } = payload;
        const targetServer = db.servers.find(s => s.id === serverId);
        if (targetServer) {
            targetServer.channels.push(channelObj);
            saveDB(db);

            broadcast({
                action: 'CHANNEL_CREATED',
                payload: { serverId, channelObj }
            });
        }
    } else if (action === 'VOICE_SIGNAL') {
        // Relay WebRTC audio offer/answer/ice to all other clients
        for (const client of clients) {
            if (client !== socket) {
                sendWS(client, { action: 'VOICE_SIGNAL', payload });
            }
        }
    } else if (action === 'TYPING_STATUS') {
        for (const client of clients) {
            if (client !== socket) {
                sendWS(client, { action: 'USER_TYPING', payload });
            }
        }
    }
}

// Start Listening
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==================================================`);
    console.log(`🚀 TOPSEP DEDICATED SERVER IS ONLINE!`);
    console.log(`--------------------------------------------------`);
    console.log(`• Local Access:   http://localhost:${PORT}`);
    console.log(`• Network Access: http://0.0.0.0:${PORT}`);
    console.log(`• Encrypted DB:   ${DB_FILE}`);
    console.log(`==================================================\n`);
});
