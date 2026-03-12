const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { chat } = require('./lib/ai');
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

// ── Health check ─────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Email reply form ──────────────────────────────────────────────
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
  <title>Reply — Name a Bright Star</title>
  <style>
    body { font-family: Georgia, serif; max-width: 700px; margin: 40px auto; padding: 20px; color: #1a1a2e; }
    h1 { font-size: 1.4em; }
    .meta { background: #f8f7f5; border-radius: 8px; padding: 16px; margin: 16px 0; font-size: 14px; line-height: 1.8; }
    .original { background: #f0eee9; border-left: 3px solid #c8a84b; padding: 12px 16px; margin: 16px 0; font-size: 13px; white-space: pre-wrap; max-height: 200px; overflow-y: auto; }
    textarea { width: 100%; height: 220px; font-family: Georgia, serif; font-size: 14px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box; line-height: 1.6; }
    button { background: #1a1a2e; color: #fff; border: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; cursor: pointer; margin-top: 12px; }
    button:hover { background: #16213e; }
    .sent { color: green; font-weight: bold; padding: 20px; text-align: center; }
  </style>
</head>
<body>
  <h1>⭐ Reply to Email</h1>
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
    <button type="submit">Send Reply ✉️</button>
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
    res.send(page('Reply Sent ✅', `<p>Your reply to <strong>${email.fromEmail}</strong> has been sent.</p><p>You can close this tab.</p>`));
  } catch (err) {
    res.status(500).send(page('Error', `<p>Failed to send: ${err.message}</p>`));
  }
});

// ── Approval handler (Owain clicks link from Discord) ─────────────
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

  // Resolve the approval
  approvals.resolve(id, action);

  // Execute if approved
  let resultMessage = '';
  if (action === 'approve') {
    try {
      resultMessage = await executeApproval(approval);
    } catch (err) {
      console.error('Failed to execute approval:', err);
      return res.status(500).send(page('Error', `<p>Approval recorded but action failed: ${err.message}</p>`));
    }
  }

  // Notify the customer via their WebSocket session
  notifyCustomer(approval.session_id, action, resultMessage);

  const actionLabel = action === 'approve' ? '✅ Approved' : '❌ Rejected';
  res.send(page(actionLabel,
    `<p><strong>${actionLabel}</strong></p>
     <p>${approval.type.replace(/_/g, ' ')} for <em>${approval.email}</em></p>
     ${resultMessage ? `<p>Result: ${resultMessage}</p>` : ''}
     <p>You can close this tab.</p>`
  ));
});

async function executeApproval(approval) {
  switch (approval.type) {
    case 'new_code': {
      const code = await db.generateCode();
      await sendNewCode(approval.email, code).catch(e => console.error('Email failed:', e));
      return `New code sent to ${approval.email}`;
    }
    case 'fix_spelling': {
      if (!approval.registration_id) return 'No registration ID — manual fix required';
      const match = approval.details.match(/to[:\s]+(.+)$/i);
      if (match) {
        const newName = match[1].trim();
        await db.updateRegistration(approval.registration_id, { registrant_name: newName });
        await sendSpellingFixConfirmation(approval.email, newName).catch(e => console.error('Email failed:', e));
        return `Registration updated and confirmation sent to ${approval.email}`;
      }
      return 'Manual fix required — could not parse new value';
    }
    case 'reselect_star': {
      const code = await db.generateCode();
      await sendNewCode(approval.email, code).catch(e => console.error('Email failed:', e));
      return `New code for re-selection sent to ${approval.email}`;
    }
    default:
      return 'Action executed';
  }
}

function notifyCustomer(sessionId, action, result) {
  if (!sessionId) return;

  // Find the WebSocket session and send a message
  for (const client of wss.clients) {
    if (client.sessionId === sessionId && client.readyState === WebSocket.OPEN) {
      const msg = action === 'approve'
        ? { type: 'approval_result', status: 'approved', result }
        : { type: 'approval_result', status: 'rejected' };

      client.send(JSON.stringify(msg));
    }
  }
}


// ── Test Discord posting (debug) ─────────────────────────────────
app.get('/test-discord', async (req, res) => {
  try {
    await discord.sendApprovalRequest({
      id: 'test-' + Date.now(),
      token: 'testtoken',
      type: 'new_code',
      email: 'test@example.com',
      details: 'Test approval from Render debug endpoint'
    });
    res.json({ ok: true, message: 'Discord message sent successfully' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── WebSocket chat ───────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.sessionId = Math.random().toString(36).slice(2);
  ws.history = [];
  ws.pendingApprovalId = null;

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.type !== 'chat') return;

    const userMessage = { role: 'user', content: msg.text };
    ws.history.push(userMessage);

    // Keep history bounded
    if (ws.history.length > 30) ws.history = ws.history.slice(-30);

    try {
      const toolHandler = async (name, args) => {
        return handleTool(ws, name, args);
      };

      const result = await chat(ws.history, toolHandler);
      ws.history = result.messages;

      ws.send(JSON.stringify({ type: 'chat', text: result.content }));

    } catch (err) {
      console.error('Chat error:', err);
      ws.send(JSON.stringify({
        type: 'chat',
        text: "I'm sorry, I'm having trouble right now. Please try again in a moment or email us at support@nameabrightstar.com"
      }));
    }
  });
});

async function handleTool(ws, name, args) {
  switch (name) {
    case 'lookup_registration': {
      try {
        return await db.lookupByEmail(args.email);
      } catch (err) {
        return { found: false, error: err.message };
      }
    }

    case 'validate_code': {
      try {
        return await db.validateCode(args.code);
      } catch (err) {
        return { valid: false, error: err.message };
      }
    }

    case 'request_approval': {
      console.log('[APPROVAL] Creating approval request for', args.email, 'type:', args.type);
      const approval = approvals.create(
        args.type,
        args.email,
        args.details,
        args.registration_id || null
      );
      approvals.linkSession(approval.id, ws.sessionId);
      ws.pendingApprovalId = approval.id;

      try {
        console.log('[APPROVAL] Posting to Discord, channel:', process.env.DISCORD_CHANNEL_ID);
        await discord.sendApprovalRequest(approval);
        console.log('[APPROVAL] Discord post successful');
        return {
          requested: true,
          message: 'Approval request sent to operator'
        };
      } catch (err) {
        console.error('[APPROVAL] Discord notification failed:', err.message, err.stack);
        return {
          requested: true,
          message: 'Approval request queued (notification failed)'
        };
      }
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// Helper: minimal HTML page for approval responses
function page(title, body) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title} — Name a Bright Star</title>
  <style>
    body { font-family: Georgia, serif; max-width: 500px; margin: 80px auto; padding: 20px; text-align: center; color: #333; }
    h1 { color: #1a1a2e; }
  </style>
</head>
<body>
  <h1>⭐ Name a Bright Star</h1>
  <h2>${title}</h2>
  ${body}
</body>
</html>`;
}

// ── Start ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`NABS Chat Service running on port ${PORT}`);
  emailMonitor.startMonitor();
});
