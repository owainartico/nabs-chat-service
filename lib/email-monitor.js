const { fetchNewEmails, markAsRead, appendToSent } = require('./imap');
const db = require('./db');
const crypto = require('crypto');
const { sendRawEmail, alreadySent, logSent, hasReceivedReply } = require('./email');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '1480793131405283429';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SERVICE_URL = process.env.SERVICE_URL || 'https://nabs-chat-service.onrender.com';

const INBOXES = [
  'support@nameabrightstar.com',
  'congratulations@nameabrightstar.com',
];

const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

const state = {
  lastUid: {},
  pendingReplies: new Map(),
};

const NOISE_PATTERNS = [
  /noreply@/i, /no-reply@/i, /mailer@shopify/i, /shopify\.com/i,
  /judge\.me/i, /promify/i, /facebook\.com/i, /klaviyo/i,
  /payout/i, /newsletter/i, /unsubscribe/i,
];

function isNoise(email) {
  return NOISE_PATTERNS.some(p => p.test(email.fromEmail) || p.test(email.subject));
}

async function triageEmails(emails) {
  const prompt = `You are triaging customer support emails for Name a Bright Star (nameabrightstar.com).

For each email, output a classification and auto-action:

LEVEL:
- RED: urgent — certificate broken, angry/frustrated customer, multiple follow-ups, long wait
- YELLOW: routine — simple question, wants cert link, name change request, asking where star is
- NOISE: marketing, Shopify system, auto-replies, out-of-office

ACTION (for non-NOISE):
- "send_cert": customer needs their certificate link, asking where their star is, registration not received, cert not working
- "name_change": customer wants a name/spelling change. Extract the exact new name from the email into extracted_name.
- "new_code": customer's code doesn't work, is lost, already used, not found, or is from the old system
- "manual": needs human review — refund request, dispute, complex/unclear situation

IMPORTANT: For name_change, extracted_name must be the exact name the customer wants on the certificate.
If name is ambiguous or unclear, use action "manual" instead.

Output a JSON array (same order as input):
[{"index":0,"level":"RED"|"YELLOW"|"NOISE","action":"send_cert"|"name_change"|"manual","summary":"Sender name — one line description","extracted_name":"Exact New Name or null"}]

Emails:
${emails.map((e, i) => `[${i}] From: ${e.from}\nEmail: ${e.fromEmail}\nSubject: ${e.subject}\nBody: ${e.body.slice(0, 400)}`).join('\n\n')}`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '[]';
    const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]');
    return parsed;
  } catch (err) {
    console.error('[email-monitor] Triage failed:', err.message);
    return emails.map((_, i) => ({ index: i, level: 'YELLOW', action: 'manual', summary: `${emails[i].from} — ${emails[i].subject}`, extracted_name: null }));
  }
}

async function sendReply({ to, from, subject, text, html }) {
  await sendRawEmail({ from: from || 'support@nameabrightstar.com', to, subject, body: text || html || '' });
}

// AUTO: send cert link to customer
async function autoHandleSendCert(email, triage) {
  if (alreadySent(email.fromEmail, 'send_cert', 24)) {
    console.log(`[auto] Skipping duplicate send_cert to ${email.fromEmail}`);
    return false;
  }
  try {
    const result = await db.lookupByEmail(email.fromEmail);
    if (!result.found || !result.registrations?.length) {
      console.log(`[auto] No registration for ${email.fromEmail} — escalating`);
      return false;
    }

    const reg = result.registrations[0];
    const firstName = (reg.registrant || email.fromEmail.split('@')[0]).split(' ')[0];
    const starName = reg.star_name || 'your star';
    const certUrl = reg.certificate_url;

    const text = `Hi ${firstName},\n\nHere is your certificate link for ${starName}:\n\n${certUrl}\n\nWarmest wishes,\nThe Name a Bright Star Team`;
    const html = `<p>Hi ${firstName},</p>
<p>Here is your certificate link for <strong>${starName}</strong>:</p>
<p><a href="${certUrl}">View Certificate âœ¨</a></p>
<p>Warmest wishes,<br>The Name a Bright Star Team</p>`;

    await sendReply({ to: email.fromEmail, from: email.to, subject: `Re: ${email.subject}`, text, html });
    logSent(email.fromEmail, email.subject, 'send_cert');
    console.log(`[auto] Cert link sent to ${email.fromEmail} (star: ${starName})`);
    return true;
  } catch (err) {
    console.error(`[auto] send_cert failed for ${email.fromEmail}:`, err.message);
    return false;
  }
}

// AUTO: generate a new code and email it
async function autoHandleNewCode(email, triage) {
  if (alreadySent(email.fromEmail, 'new_code', 24)) {
    console.log(`[auto] Skipping duplicate new_code to ${email.fromEmail}`);
    return false;
  }
  try {
    const newCode = await db.generateCode();
    const firstName = email.from.split(/[\s<]/)[0] || 'there';
    const registerUrl = 'https://register.nameabrightstar.com';

    const text = `Hi ${firstName},\n\nNo problem — we've generated a fresh registration code for you:\n\n${newCode}\n\nJust head to ${registerUrl}, click "Register Your Star", and enter this code to get started.\n\nWarmest wishes,\nThe Name a Bright Star Team`;
    const html = `<p>Hi ${firstName},</p>
<p>No problem — we've generated a fresh registration code for you:</p>
<p style="font-size:24px;font-weight:bold;letter-spacing:2px;text-align:center;padding:16px;background:#f8f7f5;border-radius:8px;">${newCode}</p>
<p>Just head to <a href="${registerUrl}">${registerUrl}</a>, click <strong>"Register Your Star"</strong>, and enter this code to get started. âœ¨</p>
<p>Warmest wishes,<br>The Name a Bright Star Team</p>`;

    await sendReply({ to: email.fromEmail, from: email.to, subject: `Re: ${email.subject}`, text, html });
    logSent(email.fromEmail, email.subject, 'new_code');
    console.log(`[auto] New code ${newCode} sent to ${email.fromEmail}`);
    return true;
  } catch (err) {
    console.error(`[auto] new_code failed for ${email.fromEmail}:`, err.message);
    return false;
  }
}

// AUTO: update name on registration and resend cert
async function autoHandleNameChange(email, triage) {
  const newName = triage.extracted_name;
  if (!newName) return false;
  if (alreadySent(email.fromEmail, 'name_change', 24)) {
    console.log(`[auto] Skipping duplicate name_change to ${email.fromEmail}`);
    return false;
  }

  try {
    const result = await db.lookupByEmail(email.fromEmail);
    if (!result.found || !result.registrations?.length) {
      console.log(`[auto] No registration for ${email.fromEmail} — escalating name change`);
      return false;
    }

    const reg = result.registrations[0];

    // Update in DB via admin API
    await db.updateRegistration(reg.id, { registrant_name: newName, recipient_name: newName });

    // Resend certificate email
    const NABS_URL = process.env.NABS_ADMIN_URL || 'https://name-a-bright-star.onrender.com';
    const auth = Buffer.from(`${process.env.NABS_ADMIN_USERNAME || 'admin'}:${process.env.NABS_ADMIN_PASSWORD}`).toString('base64');
    await fetch(`${NABS_URL}/api/admin/resend/${reg.id}`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}` },
    });

    const starName = reg.star_name || 'your star';
    const certUrl = reg.certificate_url;

    const text = `Hi,\n\nDone — we've updated the certificate for ${starName} to show the name "${newName}".\n\nHere's your updated certificate link:\n${certUrl}\n\nWarmest wishes,\nThe Name a Bright Star Team`;
    const html = `<p>Done — we've updated the certificate for <strong>${starName}</strong> to show the name <strong>"${newName}"</strong>.</p>
<p><a href="${certUrl}">View Updated Certificate âœ¨</a></p>
<p>Warmest wishes,<br>The Name a Bright Star Team</p>`;

    await sendReply({ to: email.fromEmail, from: email.to, subject: `Re: ${email.subject}`, text, html });
    logSent(email.fromEmail, email.subject, 'name_change');
    console.log(`[auto] Name changed to "${newName}" for ${email.fromEmail} (reg ${reg.id})`);
    return true;
  } catch (err) {
    console.error(`[auto] name_change failed for ${email.fromEmail}:`, err.message);
    return false;
  }
}

async function storePendingReply(email) {
  const id = crypto.randomBytes(8).toString('hex');
  const token = crypto.randomBytes(16).toString('hex');
  state.pendingReplies.set(id, { email, draft: '', token });
  return `${SERVICE_URL}/email-reply?id=${id}&token=${token}`;
}

async function postManualToDiscord(items) {
  if (!items.length) return;
  const OWAIN_ID = '1116172746162982983';
  const urgentItems = items.filter(i => i.triage.urgent);
  const normalItems = items.filter(i => !i.triage.urgent);

  // Urgent: repeat contacts — ping Owain individually
  for (const { triage, email } of urgentItems) {
    const replyUrl = await storePendingReply(email);
    const content = `<@${OWAIN_ID}> 🚨 **REPEAT CONTACT — needs your attention**\n`
      + `**${triage.summary}**\n`
      + `✉️ From: ${email.from}\n`
      + `✏️ [Reply](<${replyUrl}>)`;
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }

  // Normal: digest format
  if (normalItems.length) {
    const lines = ['📬 **NABS — needs your attention**', ''];
    for (const { triage, email } of normalItems) {
      const replyUrl = await storePendingReply(email);
      const line = `${triage.summary}  ✏️ [Reply](<${replyUrl}>)`;
      if (triage.level === 'RED') lines.push(`🔴 **${line}**`);
      else lines.push(`🟡 ${line}`);
    }
    const content = lines.join('\n').slice(0, 2000);
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }
}


async function postAutoSummaryToDiscord(handled) {
  if (!handled.length) return;
  const lines = ['✅ **NABS — auto-handled**', ''];
  for (const { summary, action } of handled) {
    const icon = action === 'name_change' ? '✏️' : '📨';
    lines.push(`${icon} ${summary}`);
  }
  const content = lines.join('\n').slice(0, 2000);
  await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

async function pollInbox(inbox) {
  try {
    const sinceUid = state.lastUid[inbox] || 0;
    const emails = await fetchNewEmails(inbox, sinceUid);
    for (const email of emails) {
      if (email.uid > (state.lastUid[inbox] || 0)) {
        state.lastUid[inbox] = email.uid;
      }
      console.log(`[email-monitor] New email in ${inbox}: "${email.subject}" from ${email.fromEmail}`);
    }
    return emails;
  } catch (err) {
    console.error(`[email-monitor] Error polling ${inbox}:`, err.message);
    return [];
  }
}

async function runPoll() {
  const allEmails = [];
  for (const inbox of INBOXES) {
    const emails = await pollInbox(inbox);
    allEmails.push(...emails);
  }

  if (allEmails.length === 0) return;

  const triage = await triageEmails(allEmails);
  const manualItems = [];
  const autoHandled = [];

  for (const t of triage) {
    const email = allEmails[t.index];
    if (!email) continue;
    if (t.level === 'NOISE') continue;

    let handled = false;

    if (t.action === 'send_cert') {
      handled = await autoHandleSendCert(email, t);
    } else if (t.action === 'new_code') {
      handled = await autoHandleNewCode(email, t);
    } else if (t.action === 'name_change' && t.extracted_name) {
      handled = await autoHandleNameChange(email, t);
    }

    if (handled) {
      autoHandled.push({ summary: t.summary, action: t.action });
    } else {
      manualItems.push({ triage: t, email });
    }
  }

  if (autoHandled.length > 0) await postAutoSummaryToDiscord(autoHandled);
  if (manualItems.length > 0) await postManualToDiscord(manualItems);

  // Mark ALL processed emails as read — prevents re-processing on next poll
  const byInbox = {};
  for (const email of allEmails) {
    if (!byInbox[email.to]) byInbox[email.to] = [];
    byInbox[email.to].push(email.uid);
  }
  for (const [inbox, uids] of Object.entries(byInbox)) {
    await markAsRead(inbox, uids).catch(e => console.error('[email-monitor] markAsRead failed:', e.message));
  }
}

function startMonitor() {
  if (!process.env.IMAP_PASS) {
    console.log('[email-monitor] IMAP_PASS not set — skipping email monitoring');
    return;
  }
  console.log('[email-monitor] Starting with auto-reply enabled...');
  runPoll();
  setInterval(runPoll, POLL_INTERVAL_MS);
}

function getPendingReply(id) {
  return state.pendingReplies.get(id) || null;
}

function deletePendingReply(id) {
  state.pendingReplies.delete(id);
}

module.exports = { startMonitor, getPendingReply, deletePendingReply };
