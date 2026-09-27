const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- CONFIGURAÇÃO DO BANCO DE DADOS SQLITE ---
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Erro ao abrir o banco de dados', err.message);
  } else {
    console.log('Conectado ao banco de dados SQLite.');
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS inboxes (
    email TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    sender TEXT,
    subject TEXT,
    text TEXT,
    html TEXT,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(email) REFERENCES inboxes(email)
  )`);
});

// Limpa e-mails expirados a cada 1 minuto
setInterval(() => {
  const now = Date.now();
  db.run(`DELETE FROM inboxes WHERE expires_at > 0 AND expires_at < ?`, [now], function(err) {
    if (this && this.changes > 0) {
      console.log(`[LIMPEZA] ${this.changes} e-mails expirados removidos.`);
    }
  });
}, 60000);

// --- ROTAS DA API ---

app.post('/api/create', (req, res) => {
  const { domain, password, durationMinutes } = req.body;
  
  if (!domain || !password) {
    return res.status(400).json({ error: 'Domínio e senha são obrigatórios.' });
  }

  const username = uuidv4().substring(0, 8);
  const email = `${username}@${domain}`.toLowerCase();
  
  let expires_at = 0;
  if (durationMinutes && Number(durationMinutes) > 0) {
    expires_at = Date.now() + Number(durationMinutes) * 60 * 1000;
  }

  db.run(
    `INSERT INTO inboxes (email, password, expires_at) VALUES (?, ?, ?)`,
    [email, password, expires_at],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao criar e-mail no banco de dados.' });
      }
      res.json({ success: true, email });
    }
  );
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Informe o e-mail e a senha.' });
  }

  db.get(
    `SELECT * FROM inboxes WHERE email = ? AND password = ?`,
    [email.toLowerCase(), password],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Erro interno no servidor.' });
      }
      if (!row) {
        return res.status(401).json({ error: 'E-mail ou senha incorretos, ou conta expirada.' });
      }

      if (row.expires_at > 0 && Date.now() > row.expires_at) {
        return res.status(401).json({ error: 'Este e-mail já expirou.' });
      }

      res.json({ success: true, email: row.email });
    }
  );
});

app.get('/api/inbox/:email', (req, res) => {
  const email = req.params.email.toLowerCase();

  db.all(
    `SELECT * FROM messages WHERE email = ? ORDER BY date DESC`,
    [email],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao buscar mensagens.' });
      }
      res.json({ messages: rows });
    }
  );
});

app.delete('/api/inbox/:email', (req, res) => {
  const email = req.params.email.toLowerCase();
  db.run(`DELETE FROM inboxes WHERE email = ?`, [email], function(err) {
    db.run(`DELETE FROM messages WHERE email = ?`, [email]);
    res.json({ success: true });
  });
});

// --- WEBHOOK PARA RECEBER E-MAILS DO CLOUDFLARE ---
app.post('/api/webhook/email', (req, res) => {
  const { recipient, sender, subject, text, html } = req.body;

  if (!recipient) {
    return res.status(400).json({ error: 'Destinatario nao informado' });
  }

  const emailAddress = recipient.toLowerCase();

  db.get(`SELECT * FROM inboxes WHERE email = ?`, [emailAddress], (err, inbox) => {
    if (inbox) {
      if (inbox.expires_at > 0 && Date.now() > inbox.expires_at) {
        return res.status(200).json({ success: false, reason: 'Expired' });
      }

      const msgId = uuidv4();
      db.run(
        `INSERT INTO messages (id, email, sender, subject, text, html) VALUES (?, ?, ?, ?, ?, ?)`,
        [msgId, emailAddress, sender || 'Desconhecido', subject || '(Sem assunto)', text || '', html || ''],
        (err) => {
          if (!err) {
            console.log(`[WEBHOOK] E-mail salvo para: ${emailAddress} | Assunto: ${subject}`);
          }
        }
      );
    }
  });

  res.status(200).json({ success: true });
});

app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  res.sendFile(indexPath);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
