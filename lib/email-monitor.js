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

async function draftReply(email) {
  const systemPrompt = `You are a helpful support assistant for Name a Bright Star (nameabrightstar.com).
Draft a warm, professional reply to the following customer email.
Be concise (3-5 sentences max). Match their tone.
Sign off as "Name a Bright Star Support Team".
Only output the reply body — no subject line, no "Dear X:", just the body text.`;

  const userPrompt = `From: ${email.from}
Subject: ${email.subject}

${email.body}`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

async function postToDiscord(email, draft) {
  // Store pending reply
  const id = crypto.randomBytes(8).toString('hex');
  const token = crypto.randomBytes(16).toString('hex');
  state.pendingReplies.set(id, { email, draft, token });

  const replyUrl = `${SERVICE_URL}/email-reply?id=${id}&token=${token}`;
  const inbox = email.to === 'congratulations@nameabrightstar.com' ? '🎉 congratulations' : '📬 support';
  const preview = email.body.slice(0, 300).replace(/\n+/g, ' ');

  const content = [
    `**${inbox}@nameabrightstar.com — New Email**`,
    ``,
    `**From:** ${email.from}`,
    `**Subject:** ${email.subject}`,
    `**Preview:** ${preview}${email.body.length > 300 ? '...' : ''}`,
    ``,
    draft ? `**Suggested reply:**\n>>> ${draft.slice(0, 500)}${draft.length > 500 ? '...' : ''}` : '',
    ``,
    `✏️ **Review & send reply:** <${replyUrl}>`,
  ].filter(Boolean).join('\n');

  await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });

  return id;
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

      const draft = await draftReply(email);
      await postToDiscord(email, draft);
    }
  } catch (err) {
    console.error(`[email-monitor] Error polling ${inbox}:`, err.message);
  }
}

function startMonitor() {
  if (!process.env.IMAP_PASS) {
    console.log('[email-monitor] IMAP_PASS not set — skipping email monitoring');
    return;
  }

  console.log('[email-monitor] Starting email monitor...');

  // Initial poll
  INBOXES.forEach(pollInbox);

  // Regular interval
  setInterval(() => {
    INBOXES.forEach(pollInbox);
  }, POLL_INTERVAL_MS);
}

function getPendingReply(id) {
  return state.pendingReplies.get(id) || null;
}

function deletePendingReply(id) {
  state.pendingReplies.delete(id);
}

module.exports = { startMonitor, getPendingReply, deletePendingReply };
