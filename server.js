const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Armazenamento em memória
const inboxes = new Map();

app.use(express.json());

// Rota principal: serve o index.html direto da raiz do projeto
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('<h1>Erro: index.html nao encontrado na raiz do projeto</h1>');
  }
});

// --- API DE GERENCIAMENTO ---

app.post('/api/generate', (req, res) => {
  const { domain } = req.body;
  if (!domain) {
    return res.status(400).json({ error: 'Dominio nao informado' });
  }

  const username = uuidv4().substring(0, 8);
  const email = `${username}@${domain}`.toLowerCase();
  
  inboxes.set(email, []);
  res.json({ email });
});

app.get('/api/inbox/:email', (req, res) => {
  const email = req.params.email.toLowerCase();
  const messages = inboxes.get(email) || [];
  res.json({ messages });
});

// --- WEBHOOK PARA RECEBER OS E-MAILS DO CLOUDFLARE ---
app.post('/api/webhook/email', (req, res) => {
  const { recipient, sender, subject, text, html } = req.body;

  if (!recipient) {
    return res.status(400).json({ error: 'Destinatario nao informado' });
  }

  const emailAddress = recipient.toLowerCase();

  if (inboxes.has(emailAddress)) {
    const message = {
      id: uuidv4(),
      from: sender || 'Desconhecido',
      subject: subject || '(Sem assunto)',
      text: text || '',
      html: html || '',
      date: new Date()
    };

    inboxes.get(emailAddress).unshift(message);
    console.log(`[WEBHOOK] E-mail recebido para: ${emailAddress} | Assunto: ${subject}`);
  }

  res.status(200).json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
