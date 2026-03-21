const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PASSWORD = "shadow2024!";
const clients = [];

wss.on('connection', (ws) => {
    let auth = false;
    let myPartner = null;
    
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            
            if (data.type === 'auth') {
                if (data.password === PASSWORD) {
                    auth = true;
                    
                    // Cerca partner disponibile
                    const available = clients.find(c => c.auth && !c.partner && c.ws !== ws);
                    
                    if (available) {
                        // Collega i due
                        myPartner = available.ws;
                        available.partner = ws;
                        
                        // Notifica entrambi
                        ws.send(JSON.stringify({type: 'partner', msg: 'Connesso!'}));
                        available.ws.send(JSON.stringify({type: 'partner', msg: 'Nuovo partner!'}));
                    } else {
                        ws.send(JSON.stringify({type: 'waiting', msg: 'In attesa...'}));
                    }
                    
                    // Aggiungi alla lista
                    clients.push({ws, auth, partner: myPartner});
                } else {
                    ws.send(JSON.stringify({type: 'error', msg: 'Password sbagliata'}));
                }
            }
            
            if (data.type === 'msg' && auth && myPartner) {
                // Invia al partner
                myPartner.send(JSON.stringify({type: 'msg', text: data.text, from: 'other'}));
                // Conferma a me stesso
                ws.send(JSON.stringify({type: 'sent', text: data.text}));
            }
            
        } catch (e) {
            console.log('Errore:', e);
        }
    });
    
    ws.on('close', () => {
        // Trova e rimuovi dalla lista
        const idx = clients.findIndex(c => c.ws === ws);
        if (idx > -1) {
            const me = clients[idx];
            if (me.partner) {
                // Notifica l'ex partner
                try {
                    me.partner.send(JSON.stringify({type: 'left', msg: 'Partner uscito'}));
                } catch(e) {}
            }
            clients.splice(idx, 1);
        }
    });
});

// Crea cartella e file HTML
if (!fs.existsSync('public')) fs.mkdirSync('public');

fs.writeFileSync('public/index.html', `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: Arial, sans-serif;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    color: #fff;
}
.box {
    background: rgba(255,255,255,0.1);
    padding: 30px;
    border-radius: 15px;
    width: 400px;
}
h2 { text-align: center; margin-bottom: 20px; color: #00d4ff; }
input {
    width: 100%;
    padding: 12px;
    margin: 10px 0;
    border-radius: 8px;
    border: none;
    font-size: 16px;
}
button {
    width: 100%;
    padding: 12px;
    background: #00d4ff;
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 16px;
    cursor: pointer;
}
#chat { display: none; }
#messages {
    height: 300px;
    background: rgba(0,0,0,0.3);
    border-radius: 8px;
    padding: 10px;
    margin: 10px 0;
    overflow-y: auto;
}
.msg {
    padding: 8px 12px;
    margin: 5px 0;
    border-radius: 8px;
    max-width: 80%;
}
.msg.me {
    background: #00d4ff;
    margin-left: auto;
    text-align: right;
}
.msg.other {
    background: rgba(255,255,255,0.2);
}
#status {
    text-align: center;
    color: #aaa;
    margin-bottom: 10px;
}
</style>
</head>
<body>

<div id="login" class="box">
    <h2>🔐 Chat Sicura</h2>
    <input type="password" id="pass" placeholder="Password">
    <button onclick="entra()">Entra</button>
    <p id="err" style="color:#ff4757; text-align:center; margin-top:10px"></p>
</div>

<div id="chat" class="box">
    <h3>💬 Chat</h3>
    <div id="status">In attesa...</div>
    <div id="messages"></div>
    <div style="display:flex; gap:10px">
        <input type="text" id="txt" style="flex:1" placeholder="Scrivi...">
        <button onclick="manda()" style="width:80px">Invia</button>
    </div>
</div>

<script>
let ws;
let connected = false;

function entra() {
    const p = document.getElementById('pass').value;
    ws = new WebSocket('ws://localhost:3000');
    
    ws.onopen = () => {
        ws.send(JSON.stringify({type: 'auth', password: p}));
    };
    
    ws.onmessage = (e) => {
        const d = JSON.parse(e.data);
        console.log('Ricevuto:', d);
        
        if (d.type === 'partner') {
            document.getElementById('login').style.display = 'none';
            document.getElementById('chat').style.display = 'block';
            document.getElementById('status').textContent = '✅ Connesso con partner!';
            connected = true;
        }
        
        if (d.type === 'waiting') {
            document.getElementById('login').style.display = 'none';
            document.getElementById('chat').style.display = 'block';
            document.getElementById('status').textContent = '⏳ In attesa di un partner...';
        }
        
        if (d.type === 'error') {
            document.getElementById('err').textContent = d.msg;
        }
        
        if (d.type === 'msg') {
            // Messaggio dall'altro
            const div = document.createElement('div');
            div.className = 'msg other';
            div.textContent = d.text;
            document.getElementById('messages').appendChild(div);
            scrolla();
        }
        
        if (d.type === 'sent') {
            // Mio messaggio confermato
            const div = document.createElement('div');
            div.className = 'msg me';
            div.textContent = d.text;
            document.getElementById('messages').appendChild(div);
            scrolla();
        }
        
        if (d.type === 'left') {
            document.getElementById('status').textContent = '❌ ' + d.msg;
            connected = false;
        }
    };
    
    ws.onerror = () => {
        document.getElementById('err').textContent = 'Errore di connessione';
    };
}

function manda() {
    if (!connected) return;
    const t = document.getElementById('txt').value.trim();
    if (!t) return;
    ws.send(JSON.stringify({type: 'msg', text: t}));
    document.getElementById('txt').value = '';
}

function scrolla() {
    const m = document.getElementById('messages');
    m.scrollTop = m.scrollHeight;
}

// Invia con Enter
document.getElementById('txt').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') manda();
});
</script>

</body>
</html>`);

app.use(express.static('public'));

server.listen(3000, () => {
    console.log('=================================');
    console.log('  CHAT SERVER AVVIATO!');
    console.log('  http://localhost:3000');
    console.log('=================================');
});
