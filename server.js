const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { chat, MODEL } = require('./lib/ai');
const db = require('./lib/db');
const discord = require('./lib/discord');
const approvals = require('./lib/approvals');
const { sendNewCode, sendSpellingFixConfirmation } = require('./lib/email');
const emailMonitor = require('./lib/email-monitor');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// â”€â”€ R2 / file upload setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'ee72db6a9045473c837785429f6678ee';
const R2_ACCESS_KEY  = process.env.R2_ACCESS_KEY  || '142497a0601962145e5bf62a34041a1f';
const R2_SECRET_KEY  = process.env.R2_SECRET_KEY  || '152fa0e24cb646f3390c3dd341e1e647d37f6b6b5e3edf35b26f156813fc1fa5';
const R2_BUCKET      = process.env.R2_BUCKET      || 'artico-catalog';
const R2_PUBLIC_URL  = process.env.R2_PUBLIC_URL  || 'https://pub-29d8c1b87a0a42be8e83792213f88022.r2.dev';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});

const ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/gif','image/webp','image/heic',
  'application/pdf',
]);
const EXT_MAP = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed. Please upload an image or PDF.'));
  },
});

// â”€â”€ Health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// â”€â”€ File upload endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const ext = EXT_MAP[req.file.mimetype] || 'bin';
  const key = `nabs-chat/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;

  try {
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    const url = `${R2_PUBLIC_URL}/${key}`;
    res.json({ url, name: req.file.originalname });
  } catch (err) {
    console.error('[UPLOAD] R2 error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 10MB)' });
  if (err.message === 'File type not allowed. Please upload an image or PDF.') return res.status(415).json({ error: err.message });
  res.status(500).json({ error: err.message });
});

// â”€â”€ Email reply form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/email-reply', (req, res) => {
  const { id, token } = req.query;
  const pending = emailMonitor.getPendingReply(id);

  if (!pending || pending.token !== token) {
    return res.status(404).send(page('Not Found', '<p>Reply not found or already sent.</p>'));
  }

  const { email, draft } = pending;
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reply - Name a Bright Star</title>
  <style>
    body { font-family: Georgia, serif; max-width: 700px; margin: 40px auto; padding: 20px; color: #1a1a2e; }
    h1 { font-size: 1.4em; }
    .meta { background: #f8f7f5; border-radius: 8px; padding: 16px; margin: 16px 0; font-size: 14px; line-height: 1.8; }
    .original { background: #f0eee9; border-left: 3px solid #c8a84b; padding: 12px 16px; margin: 16px 0; font-size: 13px; white-space: pre-wrap; max-height: 200px; overflow-y: auto; }
    textarea { width: 100%; height: 220px; font-family: Georgia, serif; font-size: 14px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box; line-height: 1.6; }
    button { background: #1a1a2e; color: #fff; border: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; cursor: pointer; margin-top: 12px; }
    button:hover { background: #16213e; }
  </style>
</head>
<body>
  <h1>âœ¦ Reply to Email</h1>
  <div class="meta">
    <strong>To:</strong> ${email.fromEmail}<br>
    <strong>From:</strong> ${email.to}<br>
    <strong>Subject:</strong> Re: ${email.subject}
  </div>
  <p style="font-size:13px; color:#666;">Original email:</p>
  <div class="original">${email.body.replace(/</g, '&lt;')}</div>
  <p style="font-size:13px; color:#666; margin-top:20px;">Your reply:</p>
  <form method="POST" action="/email-reply">
    <input type="hidden" name="id" value="${id}">
    <input type="hidden" name="token" value="${token}">
    <textarea name="body">${draft.replace(/</g, '&lt;')}</textarea>
    <br>
    <button type="submit">Send Reply âœ¦</button>
  </form>
</body>
</html>`);
});

app.use(express.urlencoded({ extended: true }));

app.post('/email-reply', async (req, res) => {
  const { id, token, body: replyBody } = req.body;
  const pending = emailMonitor.getPendingReply(id);

  if (!pending || pending.token !== token) {
    return res.status(404).send(page('Not Found', '<p>Reply not found or already sent.</p>'));
  }

  const { email } = pending;
  const { sendRawEmail } = require('./lib/email');

  try {
    await sendRawEmail({
      from: email.to,
      to: email.fromEmail,
      subject: `Re: ${email.subject}`,
      body: replyBody,
    });

    emailMonitor.deletePendingReply(id);
    res.send(page('Reply Sent âœ¦', `<p>Your reply to <strong>${email.fromEmail}</strong> has been sent.</p><p>You can close this tab.</p>`));
  } catch (err) {
    res.status(500).send(page('Error', `<p>Failed to send: ${err.message}</p>`));
  }
});

// â”€â”€ Approval handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/approve', async (req, res) => {
  const { id, action, token } = req.query;

  if (!id || !action || !token) {
    return res.status(400).send(page('Error', '<p>Invalid approval link.</p>'));
  }

  const approval = approvals.get(id);

  if (!approval) {
    return res.status(404).send(page('Not Found', '<p>This approval request was not found or has expired.</p>'));
  }

  if (approval.token !== token) {
    return res.status(403).send(page('Forbidden', '<p>Invalid token.</p>'));
  }

  if (approval.status !== 'pending') {
    return res.send(page('Already Resolved',
      `<p>This request was already <strong>${approval.status}d</strong>.</p>`));
  }

  approvals.resolve(id, action);

  let resultMessage = '';
  if (action === 'approve') {
    try {
      resultMessage = await executeApproval(approval);
    } catch (err) {
      console.error('Failed to execute approval:', err);
      return res.status(500).send(page('Error', `<p>Approval recorded but action failed: ${err.message}</p>`));
    }
  }

  notifyCustomer(approval.session_id, action, resultMessage);

  const actionLabel = action === 'approve' ? 'âœ“ Approved' : 'âœ— Rejected';
  res.send(page(actionLabel,
    `<p><strong>${actionLabel}</strong></p>
     <p>${approval.type.replace(/_/g, ' ')} for <em>${approval.email}</em></p>
     ${resultMessage ? `<p>Result: ${resultMessage}</p>` : ''}
     <p>You can close this tab.</p>`
  ));
});

// â”€â”€ Resend certificate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function resendCertificate(registrationId) {
  const NABS_URL = process.env.NABS_ADMIN_URL || 'https://name-a-bright-star.onrender.com';
  const auth = Buffer.from(`${process.env.NABS_ADMIN_USERNAME || 'admin'}:${process.env.NABS_ADMIN_PASSWORD}`).toString('base64');
  const res = await fetch(`${NABS_URL}/api/admin/resend/${registrationId}`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}` }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend failed: ${res.status} ${err}`);
  }
  return res.json();
}

async function executeApproval(approval) {
  switch (approval.type) {
    case 'new_code': {
      const code = await db.generateCode();
      await sendNewCode(approval.email, code).catch(e => console.error('sendNewCode failed:', e));
      return `New code sent to ${approval.email}`;
    }
    case 'fix_spelling': {
      if (!approval.registration_id) return 'No registration ID - manual fix required';
      const match = approval.details.match(/to[:\s]+(.+)$/i);
      if (match) {
        const newName = match[1].trim();
        await db.updateRegistration(approval.registration_id, { registrant_name: newName });
        const resendResult = await resendCertificate(approval.registration_id)
          .catch(e => { console.error('resendCertificate failed:', e); return null; });
        console.log('[APPROVAL] Resend result:', JSON.stringify(resendResult));
        return `Registration updated and certificate email resent to ${approval.email}`;
      }
      return 'Manual fix required - could not parse new name from details';
    }
    case 'reselect_star': {
      const code = await db.generateCode();
      await sendNewCode(approval.email, code).catch(e => console.error('sendNewCode failed:', e));
      return `New code for re-selection sent to ${approval.email}`;
    }
    default:
      return 'Action executed';
  }
}

function notifyCustomer(sessionId, action, result) {
  if (!sessionId) return;
  for (const client of wss.clients) {
    if (client.sessionId === sessionId && client.readyState === WebSocket.OPEN) {
      const msg = action === 'approve'
        ? { type: 'approval_result', status: 'approved', result }
        : { type: 'approval_result', status: 'rejected' };
      client.send(JSON.stringify(msg));
    }
  }
}

// â”€â”€ Test Discord (debug) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/test-discord', async (req, res) => {
  try {
    await discord.sendApprovalRequest({
      id: 'test-' + Date.now(),
      token: 'testtoken',
      type: 'new_code',
      email: 'test@example.com',
      details: 'Test approval from debug endpoint'
    });
    res.json({ ok: true, message: 'Discord message sent successfully' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// â”€â”€ WebSocket chat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
wss.on('connection', (ws) => {
  ws.sessionId = crypto.randomBytes(8).toString('hex');
  ws.history = [];
  ws.pendingApprovalId = null;
  ws.sessionTokens = 0;
  ws.compacts = 0;

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    // â”€â”€ File/image uploaded by customer â”€â”€
    if (msg.type === 'file') {
      const isImage = (msg.mime || '').startsWith('image/');
      const label = isImage ? '[Customer shared an image]' : `[Customer shared a file: ${msg.name}]`;
      ws.history.push({ role: 'user', content: `${label} URL: ${msg.url}` });

      // Echo a brief acknowledgement
      ws.send(JSON.stringify({
        type: 'chat',
        text: isImage
          ? "Thanks for sharing that image! I've noted it and our team can see it."
          : `Thanks for sharing that file (${msg.name}). Our team can see it.`,
      }));
      return;
    }

    if (msg.type !== 'chat') return;

    const userMessage = { role: 'user', content: msg.text };
    ws.history.push(userMessage);
    if (ws.history.length > 30) { ws.history = ws.history.slice(-30); ws.compacts++; }

    try {
      const result = await chat(ws.history, (name, args) => handleTool(ws, name, args));
      ws.history = result.messages;

      // Accumulate token usage and broadcast status
      const usage = result.usage || {};
      ws.sessionTokens += (usage.total_tokens || usage.prompt_tokens || 0);
      const CONTEXT_WINDOW = 1048576; // Gemini 2.5 Flash
      ws.send(JSON.stringify({
        type: 'status',
        model: MODEL,
        tokensUsed: ws.sessionTokens,
        contextWindow: CONTEXT_WINDOW,
        compacts: ws.compacts,
      }));

      ws.send(JSON.stringify({ type: 'chat', text: result.content }));
    } catch (err) {
      console.error('Chat error:', err);
      ws.send(JSON.stringify({
        type: 'chat',
        text: "I'm sorry, I'm having trouble right now. Please try again in a moment or email us at support@nameabrightstar.com",
      }));
    }
  });
});

async function handleTool(ws, name, args) {
  switch (name) {
    case 'lookup_registration': {
      try { return await db.lookupByEmail(args.email); }
      catch (err) { return { found: false, error: err.message }; }
    }
    case 'validate_code': {
      try { return await db.validateCode(args.code); }
      catch (err) { return { valid: false, error: err.message }; }
    }
    case 'request_approval': {
      console.log('[APPROVAL] Creating for', args.email, 'type:', args.type);

      const AUTO_CODE_EXPIRY = new Date('2026-04-15T00:00:00.000Z');
      if (args.type === 'new_code' && new Date() < AUTO_CODE_EXPIRY) {
        console.log('[APPROVAL] Auto-sending new code to', args.email);
        try {
          const code = await db.generateCode();
          await sendNewCode(args.email, code).catch(e => console.error('sendNewCode failed:', e));
          return { approved: true, auto: true, message: `New code sent! Tell the customer: their new code is on its way to ${args.email} - they should have it within a minute.` };
        } catch (err) {
          console.error('[APPROVAL] Auto new_code failed:', err.message);
        }
      }

      const approval = approvals.create(args.type, args.email, args.details, args.registration_id || null);
      approvals.linkSession(approval.id, ws.sessionId);
      ws.pendingApprovalId = approval.id;

      try {
        await discord.sendApprovalRequest(approval);
        return { requested: true, message: 'Approval request sent to operator' };
      } catch (err) {
        console.error('[APPROVAL] Discord failed:', err.message);
        return { requested: true, message: 'Approval request queued (notification failed)' };
      }
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function page(title, body) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title} - Name a Bright Star</title>
  <style>
    body { font-family: Georgia, serif; max-width: 500px; margin: 80px auto; padding: 20px; text-align: center; color: #333; }
    h1 { color: #1a1a2e; }
  </style>
</head>
<body>
  <h1>âœ¦ Name a Bright Star</h1>
  <h2>${title}</h2>
  ${body}
</body>
</html>`;
}

// â”€â”€ Start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`NABS Chat Service running on port ${PORT}`);
  emailMonitor.startMonitor();
});
