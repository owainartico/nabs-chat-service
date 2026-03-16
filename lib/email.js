const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const fs = require('fs');
const path = require('path');

const SENT_LOG = path.join(__dirname, '..', 'sent.log');

// ─── Log every sent email to sent.log ────────────────────────────────────────
function logSent(to, subject, action) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    to: (to || '').toLowerCase(),
    subject,
    action,
  });
  try {
    fs.appendFileSync(SENT_LOG, entry + '\n', 'utf8');
  } catch (e) {
    console.error('[email] Failed to write sent.log:', e.message);
  }
}

// Check if we already sent to this address for this action within N hours
function alreadySent(to, action, withinHours = 4) {
  try {
    if (!fs.existsSync(SENT_LOG)) return false;
    const cutoff = Date.now() - withinHours * 3600 * 1000;
    const lines = fs.readFileSync(SENT_LOG, 'utf8').trim().split('\n').filter(Boolean);
    return lines.some(line => {
      try {
        const entry = JSON.parse(line);
        return (
          entry.to === (to || '').toLowerCase() &&
          entry.action === action &&
          new Date(entry.ts).getTime() > cutoff
        );
      } catch { return false; }
    });
  } catch { return false; }
}

// ─── Append email to IMAP Sent folder ────────────────────────────────────────
async function appendToSent(to, fromAddr, subject, textBody) {
  const imap_pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
  const imap_user = process.env.SMTP_USER || 'support@nameabrightstar.com';
  if (!imap_pass) return;

  const date = new Date().toUTCString();
  const safe = (s) => (s || '').replace(/[\r\n]/g, ' ');
  const raw = [
    `Date: ${date}`,
    `From: ${safe(fromAddr)}`,
    `To: ${safe(to)}`,
    `Subject: ${safe(subject)}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    textBody || '',
  ].join('\r\n');

  try {
    const client = new ImapFlow({
      host: process.env.IMAP_HOST || 'mail.privateemail.com',
      port: parseInt(process.env.IMAP_PORT || '993'),
      secure: true,
      auth: { user: imap_user, pass: imap_pass },
      logger: false,
    });
    await client.connect();
    await client.append('Sent', raw, ['\\Seen']);
    await client.logout().catch(() => {});
    console.log(`[email] Saved to Sent: "${subject}" → ${to}`);
  } catch (e) {
    console.error('[email] Failed to append to Sent folder:', e.message);
  }
}

// ─── Transporter factory ──────────────────────────────────────────────────────
function createTransporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ─── Core send helper (logs + appends to Sent) ───────────────────────────────
async function send({ from, to, subject, text, html, action }) {
  const transporter = createTransporter();
  const fromAddr = `"Name a Bright Star" <${from || 'support@nameabrightstar.com'}>`;

  if (!transporter) {
    console.log(`[DEV] Would send "${subject}" to ${to}`);
    return { dev: true };
  }

  const info = await transporter.sendMail({ from: fromAddr, to, subject, text, html });

  // Log to file and append to IMAP Sent (fire-and-forget, don't block)
  logSent(to, subject, action || 'email');
  appendToSent(to, fromAddr, subject, text || '').catch(() => {});

  return info;
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function sendNewCode(toEmail, code) {
  const registerUrl = 'https://register.nameabrightstar.com';

  const text = `Hi there,\n\nHere is your new registration code:\n\n  ${code}\n\nTo register your star:\n1. Visit ${registerUrl}\n2. Enter the code above\n3. Pick your star on the sky map\n4. Add your star name and dedication\n5. Download your certificate\n\nWarmest wishes,\nThe Name a Bright Star Team`;

  const html = `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a2e;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="font-size: 26px; color: #1a1a2e;">✨ Name a Bright Star</h1>
        <p style="color: #666; font-size: 14px;">Your new registration code</p>
      </div>
      <p>Hi there,</p>
      <p>Here is your new registration code as requested:</p>
      <div style="background: #f8f7f5; border: 2px dashed #c8a84b; border-radius: 12px; padding: 24px; text-align: center; margin: 28px 0;">
        <p style="font-size: 13px; color: #888; margin: 0 0 8px;">Your registration code</p>
        <p style="font-size: 32px; font-family: monospace; font-weight: bold; color: #1a1a2e; letter-spacing: 4px; margin: 0;">${code}</p>
      </div>
      <p>To register your star:</p>
      <ol style="line-height: 2; color: #333;">
        <li>Visit <a href="${registerUrl}" style="color: #c8a84b;">${registerUrl}</a></li>
        <li>Enter the code above</li>
        <li>Pick your star on the sky map</li>
        <li>Add your star name and dedication</li>
        <li>Download your certificate</li>
      </ol>
      <p style="margin-top: 32px; color: #888; font-size: 13px; border-top: 1px solid #eee; padding-top: 20px;">
        Need help? Reply to this email or visit our support chat at
        <a href="https://nameabrightstar.com" style="color: #c8a84b;">nameabrightstar.com</a>
      </p>
    </div>`;

  return send({ to: toEmail, subject: 'Your Name a Bright Star registration code ✨', text, html, action: 'new_code' });
}

async function sendSpellingFixConfirmation(toEmail, starName) {
  const text = `Hi there,\n\nYour star registration has been updated. The name on your certificate now reads:\n\n  ${starName}\n\nYou can view your updated certificate at https://register.nameabrightstar.com\n\nWarmest wishes,\nThe Name a Bright Star Team`;

  const html = `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a2e;">
      <h1 style="font-size: 26px; text-align: center;">✨ Name a Bright Star</h1>
      <p>Hi there,</p>
      <p>Your star registration has been updated. The name on your certificate now reads:</p>
      <div style="background: #f8f7f5; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
        <p style="font-size: 22px; font-weight: bold; color: #1a1a2e; margin: 0;">${starName}</p>
      </div>
      <p>You can download your updated certificate from your star page.</p>
      <p style="color: #888; font-size: 13px; border-top: 1px solid #eee; padding-top: 20px; margin-top: 32px;">
        Questions? Contact us at support@nameabrightstar.com
      </p>
    </div>`;

  return send({ to: toEmail, subject: 'Your star registration has been updated ✨', text, html, action: 'name_change' });
}

async function sendRawEmail({ from, to, subject, body }) {
  const text = body;
  const html = `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 20px;white-space:pre-wrap">${body.replace(/\n/g, '<br>')}</div>`;
  return send({ from, to, subject, text, html, action: 'raw' });
}

module.exports = { sendNewCode, sendSpellingFixConfirmation, sendRawEmail, logSent, alreadySent };
