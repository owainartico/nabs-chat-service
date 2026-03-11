const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { chat } = require('./lib/ai');
const db = require('./lib/db');
const discord = require('./lib/discord');
const approvals = require('./lib/approvals');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check ─────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

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
      return `New code generated: ${code}`;
    }
    case 'fix_spelling': {
      if (!approval.registration_id) return 'No registration ID — manual fix required';
      // Parse new value from details: "Change X to Y"
      const match = approval.details.match(/to[:\s]+(.+)$/i);
      if (match) {
        await db.updateRegistration(approval.registration_id, {
          registrant_name: match[1].trim()
        });
        return `Registration updated`;
      }
      return 'Manual fix required — could not parse new value';
    }
    case 'reselect_star': {
      const code = await db.generateCode();
      return `New code issued for re-selection: ${code}`;
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
      const approval = approvals.create(
        args.type,
        args.email,
        args.details,
        args.registration_id || null
      );
      approvals.linkSession(approval.id, ws.sessionId);
      ws.pendingApprovalId = approval.id;

      try {
        await discord.sendApprovalRequest(approval);
        return {
          requested: true,
          message: 'Approval request sent to operator'
        };
      } catch (err) {
        console.error('Discord notification failed:', err);
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
});
