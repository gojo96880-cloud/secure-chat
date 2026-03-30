const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PASSWORD = "shadow2024!";
let clients = new Map(); // Usiamo Map per performance migliori: ws -> clientData

// Genera ID univoco
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Trova partner disponibile (non autenticato o in attesa)
function findAvailableClient(excludeWs) {
    for (let [ws, data] of clients) {
        if (data.auth && !data.partner && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
            return { ws, data };
        }
    }
    return null;
}

wss.on('connection', (ws) => {
    const myId = generateId();
    
    console.log(`[${new Date().toLocaleTimeString()}] 🔌 Nuova connessione: ${myId}`);
    
    ws.on('message', (msg) => {
        try {
            const message = JSON.parse(msg);
            console.log(`[${myId}] 📩 Tipo: ${message.type}`);
            
            // AUTENTICAZIONE
            if (message.type === 'auth') {
                if (message.password === PASSWORD) {
                    const available = findAvailableClient(ws);
                    
                    if (available) {
                        // ✅ ACCOPPIAMENTO: entrambi sono ora partner
                        const myData = {
                            id: myId,
                            ws: ws,
                            auth: true,
                            partner: available.ws,    // Riferimento al WebSocket del partner
                            partnerId: available.data.id
                        };
                        
                        // Aggiorna il partner esistente
                        available.data.partner = ws;
                        available.data.partnerId = myId;
                        
                        // Salva ME nella mappa
                        clients.set(ws, myData);
                        
                        // Notifica ENTRAMBI
                        ws.send(JSON.stringify({
                            type: 'partner', 
                            msg: '✅ Connesso con un partner! Inizia a chattare.'
                        }));
                        
                        available.ws.send(JSON.stringify({
                            type: 'partner', 
                            msg: '✅ Nuovo partner connesso! Inizia a chattare.'
                        }));
                        
                        console.log(`[${myId}] ✅ Accoppiato con ${available.data.id}`);
                        
                    } else {
                        // ⏳ NESSUN PARTNER: metti in attesa
                        const myData = {
                            id: myId,
                            ws: ws,
                            auth: true,
                            partner: null,
                            partnerId: null
                        };
                        
                        clients.set(ws, myData);
                        
                        ws.send(JSON.stringify({
                            type: 'waiting', 
                            msg: '⏳ In attesa di un partner...'
                        }));
                        
                        console.log(`[${myId}] ⏳ In attesa`);
                    }
                } else {
                    ws.send(JSON.stringify({
                        type: 'error', 
                        msg: '❌ Password sbagliata!'
                    }));
                }
            }
            
            // INVIO MESSAGGIO
            if (message.type === 'msg') {
                const myData = clients.get(ws);
                
                if (!myData || !myData.auth) {
                    ws.send(JSON.stringify({type: 'error', msg: 'Non autenticato'}));
                    return;
                }
                
                if (!myData.partner) {
                    ws.send(JSON.stringify({type: 'error', msg: 'Nessun partner connesso'}));
                    return;
                }
                
                // Verifica che il partner sia ancora connesso
                if (myData.partner.readyState !== WebSocket.OPEN) {
                    ws.send(JSON.stringify({type: 'error', msg: 'Partner disconnesso'}));
                    myData.partner = null;
                    myData.partnerId = null;
                    return;
                }
                
                // Invia al partner
                myData.partner.send(JSON.stringify({
                    type: 'msg', 
                    text: message.text, 
                    from: 'other'
                }));
                
                // Conferma a me stesso
                ws.send(JSON.stringify({
                    type: 'sent', 
                    text: message.text
                }));
                
                console.log(`[${myId}] 💬 Messaggio: "${message.text.substring(0, 30)}..."`);
            }
            
            // TROVA NUOVO PARTNER
            if (message.type === 'find_new') {
                const myData = clients.get(ws);
                if (!myData || !myData.auth) return;
                
                // Scollega dal vecchio partner se esiste
                if (myData.partner && myData.partnerId) {
                    const oldPartnerData = clients.get(myData.partner);
                    if (oldPartnerData) {
                        oldPartnerData.partner = null;
                        oldPartnerData.partnerId = null;
                    }
                }
                
                myData.partner = null;
                myData.partnerId = null;
                
                // Cerca nuovo partner
                const available = findAvailableClient(ws);
                
                if (available) {
                    // Accoppia con nuovo
                    myData.partner = available.ws;
                    myData.partnerId = available.data.id;
                    available.data.partner = ws;
                    available.data.partnerId = myId;
                    
                    ws.send(JSON.stringify({
                        type: 'partner',
                        msg: '✅ Nuovo partner trovato!'
                    }));
                    
                    available.ws.send(JSON.stringify({
                        type: 'partner',
                        msg: '✅ Sei stato accoppiato con qualcuno!'
                    }));
                    
                    console.log(`[${myId}] 🔄 Nuovo accoppiamento con ${available.data.id}`);
                } else {
                    ws.send(JSON.stringify({
                        type: 'waiting',
                        msg: '⏳ In attesa di un nuovo partner...'
                    }));
                }
            }
            
        } catch (e) {
            console.error(`[${myId}] ❌ Errore:`, e);
        }
    });
    
    // DISCONNESSIONE
    ws.on('close', () => {
        console.log(`[${myId}] 🔌 Disconnesso`);
        
        const myData = clients.get(ws);
        
        if (myData && myData.partner) {
            // Notifica l'ex partner
            try {
                if (myData.partner.readyState === WebSocket.OPEN) {
                    myData.partner.send(JSON.stringify({
                        type: 'left',
                        msg: 'Partner uscito. Clicca "Trova Nuovo" per cercare un altro.'
                    }));
                }
                
                // Rimuovi il riferimento a me dal partner
                const partnerData = clients.get(myData.partner);
                if (partnerData) {
                    partnerData.partner = null;
                    partnerData.partnerId = null;
                    console.log(`[${partnerData.id}] 👋 Partner (${myId}) uscito`);
                }
            } catch(e) {
                console.error('Errore notifica partner:', e);
            }
        }
        
        // Rimuovi dai clients
        clients.delete(ws);
    });
    
    // Gestione errori
    ws.on('error', (err) => {
        console.error(`[${myId}] ❌ Errore WebSocket:`, err.message);
    });
});

// Crea cartella public se non esiste
if (!fs.existsSync('public')) {
    fs.mkdirSync('public');
}

// HTML del client (invariato, ma lo metto completo)
const htmlContent = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🔐 Chat Segreta</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    color: #fff;
    padding: 20px;
}

.box {
    background: rgba(255,255,255,0.1);
    backdrop-filter: blur(10px);
    padding: 30px;
    border-radius: 20px;
    width: 100%;
    max-width: 450px;
    border: 1px solid rgba(255,255,255,0.2);
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}

h2 { 
    text-align: center; 
    margin-bottom: 25px; 
    color: #00d4ff;
    font-size: 28px;
    text-shadow: 0 0 10px rgba(0,212,255,0.5);
}

input {
    width: 100%;
    padding: 15px;
    margin: 10px 0;
    border-radius: 10px;
    border: 2px solid rgba(255,255,255,0.2);
    background: rgba(0,0,0,0.3);
    color: #fff;
    font-size: 16px;
    transition: all 0.3s;
}

input:focus {
    outline: none;
    border-color: #00d4ff;
    box-shadow: 0 0 10px rgba(0,212,255,0.3);
}

input::placeholder {
    color: rgba(255,255,255,0.5);
}

button {
    width: 100%;
    padding: 15px;
    background: linear-gradient(45deg, #00d4ff, #0099cc);
    border: none;
    border-radius: 10px;
    color: #fff;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.3s;
    margin-top: 10px;
}

button:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 20px rgba(0,212,255,0.4);
}

button:disabled {
    background: #555;
    cursor: not-allowed;
    transform: none;
}

#chat { display: none; }

#status {
    text-align: center;
    color: #aaa;
    margin-bottom: 15px;
    padding: 10px;
    background: rgba(0,0,0,0.3);
    border-radius: 8px;
    font-size: 14px;
}

#messages {
    height: 350px;
    background: rgba(0,0,0,0.4);
    border-radius: 12px;
    padding: 15px;
    margin: 15px 0;
    overflow-y: auto;
    border: 1px solid rgba(255,255,255,0.1);
}

.msg {
    padding: 10px 15px;
    margin: 8px 0;
    border-radius: 18px;
    max-width: 75%;
    word-wrap: break-word;
    animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}

.msg.me {
    background: linear-gradient(45deg, #00d4ff, #0099cc);
    margin-left: auto;
    text-align: right;
    color: #fff;
}

.msg.other {
    background: rgba(255,255,255,0.15);
    color: #fff;
}

.msg.system {
    background: rgba(255,193,7,0.2);
    color: #ffc107;
    text-align: center;
    max-width: 100%;
    font-size: 13px;
    border: 1px solid rgba(255,193,7,0.3);
}

.input-area {
    display: flex;
    gap: 10px;
    margin-top: 10px;
}

.input-area input {
    flex: 1;
    margin: 0;
}

.input-area button {
    width: auto;
    padding: 15px 25px;
    margin: 0;
}

#findNewBtn {
    background: linear-gradient(45deg, #28a745, #20c997);
    margin-bottom: 10px;
}

#findNewBtn:hover {
    box-shadow: 0 5px 20px rgba(40,167,69,0.4);
}

.error {
    color: #ff4757;
    text-align: center;
    margin-top: 15px;
    font-weight: bold;
}

/* Scrollbar personalizzata */
#messages::-webkit-scrollbar {
    width: 8px;
}

#messages::-webkit-scrollbar-track {
    background: rgba(0,0,0,0.2);
    border-radius: 4px;
}

#messages::-webkit-scrollbar-thumb {
    background: rgba(0,212,255,0.5);
    border-radius: 4px;
}

#messages::-webkit-scrollbar-thumb:hover {
    background: rgba(0,212,255,0.8);
}
</style>
</head>
<body>

<div id="login" class="box">
    <h2>🔐 Chat Segreta</h2>
    <p style="text-align:center; color:#aaa; margin-bottom:20px;">
        Chat anonima 1-a-1 con password
    </p>
    <input type="password" id="pass" placeholder="Inserisci password..." onkeypress="if(event.key==='Enter')entra()">
    <button onclick="entra()">🔓 Accedi</button>
    <p id="err" class="error"></p>
</div>

<div id="chat" class="box">
    <h3>💬 Chat Anonima</h3>
    <div id="status">Connessione in corso...</div>
    <button id="findNewBtn" onclick="trovaNuovo()" style="display:none;">🔍 Trova Nuovo Partner</button>
    <div id="messages"></div>
    <div class="input-area">
        <input type="text" id="txt" placeholder="Scrivi un messaggio..." disabled onkeypress="if(event.key==='Enter')manda()">
        <button onclick="manda()" id="sendBtn" disabled>➤</button>
    </div>
</div>

<script>
let ws;
let connected = false;

// URL dinamico - funziona sia in locale che online
function getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return \`\${protocol}//\${host}\`;
}

function entra() {
    const p = document.getElementById('pass').value.trim();
    const errDiv = document.getElementById('err');
    
    if (!p) {
        errDiv.textContent = '❌ Inserisci la password!';
        return;
    }
    
    errDiv.textContent = '⏳ Connessione in corso...';
    
    const wsUrl = getWebSocketUrl();
    console.log('Connessione a:', wsUrl);
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket aperto');
        errDiv.textContent = '';
        ws.send(JSON.stringify({type: 'auth', password: p}));
    };
    
    ws.onmessage = (e) => {
        try {
            const d = JSON.parse(e.data);
            console.log('Ricevuto:', d);
            gestisciMessaggio(d);
        } catch(err) {
            console.error('Errore parsing messaggio:', err);
        }
    };
    
    ws.onerror = (err) => {
        console.error('WebSocket errore:', err);
        errDiv.textContent = '❌ Errore di connessione. Riprova.';
    };
    
    ws.onclose = () => {
        console.log('WebSocket chiuso');
        if (connected) {
            aggiungiMessaggio('system', '🔌 Connessione persa. Ricarica la pagina.');
            connected = false;
            disabilitaInput();
        }
    };
}

function gestisciMessaggio(d) {
    const statusDiv = document.getElementById('status');
    const findNewBtn = document.getElementById('findNewBtn');
    
    if (d.type === 'partner') {
        document.getElementById('login').style.display = 'none';
        document.getElementById('chat').style.display = 'block';
        
        statusDiv.textContent = d.msg;
        statusDiv.style.color = '#28a745';
        statusDiv.style.background = 'rgba(40,167,69,0.1)';
        
        connected = true;
        abilitaInput();
        findNewBtn.style.display = 'none';
        
        aggiungiMessaggio('system', '🎉 Sei connesso! Puoi iniziare a chattare.');
        
    } else if (d.type === 'waiting') {
        document.getElementById('login').style.display = 'none';
        document.getElementById('chat').style.display = 'block';
        
        statusDiv.textContent = d.msg;
        statusDiv.style.color = '#ffc107';
        statusDiv.style.background = 'rgba(255,193,7,0.1)';
        
        connected = false;
        disabilitaInput();
        findNewBtn.style.display = 'none';
        
    } else if (d.type === 'error') {
        document.getElementById('err').textContent = '❌ ' + d.msg;
        if (ws) ws.close();
        
    } else if (d.type === 'msg') {
        aggiungiMessaggio('other', d.text);
        
    } else if (d.type === 'sent') {
        aggiungiMessaggio('me', d.text);
        
    } else if (d.type === 'left') {
        statusDiv.textContent = d.msg;
        statusDiv.style.color = '#ff4757';
        statusDiv.style.background = 'rgba(255,71,87,0.1)';
        
        connected = false;
        disabilitaInput();
        findNewBtn.style.display = 'block';
        
        aggiungiMessaggio('system', '👋 Il partner ha lasciato la chat.');
    }
}

function aggiungiMessaggio(tipo, testo) {
    const div = document.createElement('div');
    div.className = 'msg ' + tipo;
    div.textContent = testo;
    document.getElementById('messages').appendChild(div);
    scrolla();
}

function manda() {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
        console.log('Non posso inviare: connected=' + connected + ', ws=' + (ws ? ws.readyState : 'null'));
        return;
    }
    
    const input = document.getElementById('txt');
    const t = input.value.trim();
    
    if (!t) return;
    
    ws.send(JSON.stringify({type: 'msg', text: t}));
    input.value = '';
    input.focus();
}

function trovaNuovo() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    document.getElementById('messages').innerHTML = '';
    document.getElementById('status').textContent = '🔍 Ricerca nuovo partner...';
    document.getElementById('findNewBtn').style.display = 'none';
    
    ws.send(JSON.stringify({type: 'find_new'}));
}

function abilitaInput() {
    document.getElementById('txt').disabled = false;
    document.getElementById('sendBtn').disabled = false;
    document.getElementById('txt').focus();
}

function disabilitaInput() {
    document.getElementById('txt').disabled = true;
    document.getElementById('sendBtn').disabled = true;
}

function scrolla() {
    const m = document.getElementById('messages');
    m.scrollTop = m.scrollHeight;
}

window.onload = () => {
    document.getElementById('pass').focus();
};
</script>

</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), htmlContent);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('=================================');
    console.log('  🔐 CHAT SEGRETA AVVIATA!');
    console.log('  URL: http://localhost:' + PORT);
    console.log('  Password: ' + PASSWORD);
    console.log('=================================');
});
