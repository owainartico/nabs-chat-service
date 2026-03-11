const { fetchNewEmails } = require('./imap');
const crypto = require('crypto');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '1480793131405283429';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SERVICE_URL = process.env.SERVICE_URL || 'https://nabs-chat-service.onrender.com';

const INBOXES = [
  'support@nameabrightstar.com',
  'congratulations@nameabrightstar.com',
];

const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

// Track last seen UID per inbox and pending reply drafts
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
  // Build triage via AI — classify each as red/yellow/noise and get one-line summary
  const prompt = `You are triaging customer support emails for Name a Bright Star (nameabrightstar.com).

For each email below, classify it as:
- RED: urgent — certificate broken, angry customer, multiple follow-ups, payment issue
- YELLOW: worth noting — general question, registration issue, name change request
- NOISE: marketing, auto-replies, Shopify system notifications, out-of-office

Output JSON array, one object per email, in same order:
[{"index":0,"level":"RED"|"YELLOW"|"NOISE","summary":"Sender name — one line description"}]

Emails:
${emails.map((e, i) => `[${i}] From: ${e.from}\nSubject: ${e.subject}\nBody: ${e.body.slice(0, 200)}`).join('\n\n')}`;

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
  } catch {
    // Fallback: all yellow
    return emails.map((_, i) => ({ index: i, level: 'YELLOW', summary: `${emails[i].from} — ${emails[i].subject}` }));
  }
}

async function storePendingReply(email) {
  const id = crypto.randomBytes(8).toString('hex');
  const token = crypto.randomBytes(16).toString('hex');
  state.pendingReplies.set(id, { email, draft: '', token });
  return `${SERVICE_URL}/email-reply?id=${id}&token=${token}`;
}

async function postTriageToDiscord(emails, triage) {
  const red = [], yellow = [], noise = [];

  for (const t of triage) {
    const email = emails[t.index];
    if (!email) continue;
    const replyUrl = await storePendingReply(email);
    const line = `${t.summary}  ✏️ [Reply](<${replyUrl}>)`;
    if (t.level === 'RED') red.push(`🔴 **${line}**`);
    else if (t.level === 'YELLOW') yellow.push(`🟡 ${line}`);
    else noise.push(t.summary.split(' — ')[0]);
  }

  if (red.length === 0 && yellow.length === 0) return; // nothing to post

  const lines = ['📬 **NABS — new emails**', ''];
  lines.push(...red, ...yellow);
  if (noise.length) {
    lines.push('', `**Noise (not actioned):** ${noise.join(', ')}`);
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
  if (allEmails.length > 0) {
    const triage = await triageEmails(allEmails);
    await postTriageToDiscord(allEmails, triage);
  }
}

function startMonitor() {
  if (!process.env.IMAP_PASS) {
    console.log('[email-monitor] IMAP_PASS not set — skipping email monitoring');
    return;
  }

  console.log('[email-monitor] Starting email monitor...');

  // Initial poll
  runPoll();

  // Regular interval
  setInterval(runPoll, POLL_INTERVAL_MS);
}

function getPendingReply(id) {
  return state.pendingReplies.get(id) || null;
}

function deletePendingReply(id) {
  state.pendingReplies.delete(id);
}

module.exports = { startMonitor, getPendingReply, deletePendingReply };
