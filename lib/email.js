const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Persistent sent log — survives restarts
const LOG_FILE = path.join(__dirname, '..', 'data', 'sent-log.json');

function loadLog() {
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch { return []; }
}

function saveLog(entries) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    // Keep last 2000 entries to avoid unbounded growth
    const trimmed = entries.slice(-2000);
    fs.writeFileSync(LOG_FILE, JSON.stringify(trimmed, null, 2));
  } catch (e) {
    console.error('[email] Failed to save sent log:', e.message);
  }
}

function alreadySent(toEmail, action, withinHours = 24) {
  const entries = loadLog();
  const cutoff = Date.now() - withinHours * 60 * 60 * 1000;
  return entries.some(e =>
    e.to.toLowerCase() === toEmail.toLowerCase() &&
    e.action === action &&
    new Date(e.sentAt).getTime() > cutoff
  );
}

function logSent(toEmail, subject, action) {
  const entries = loadLog();
  entries.push({ to: toEmail, subject, action, sentAt: new Date().toISOString() });
  saveLog(entries);
  console.log(`[email] Logged sent: ${action} → ${toEmail} | ${subject}`);
}

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

async function sendNewCode(toEmail, code) {
  const transporter = createTransporter();
  const from = `"Name a Bright Star" <${process.env.SMTP_USER || 'support@nameabrightstar.com'}>`;
  const registerUrl = 'https://register.nameabrightstar.com';

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
      <p>To register your star, visit <a href="${registerUrl}" style="color: #c8a84b;">${registerUrl}</a>, enter your code, and follow the steps to name your star and download your certificate.</p>
      <p style="margin-top: 32px; color: #888; font-size: 13px; border-top: 1px solid #eee; padding-top: 20px;">
        Need help? Reply to this email or visit our support chat at <a href="https://nameabrightstar.com" style="color: #c8a84b;">nameabrightstar.com</a>
      </p>
    </div>`;

  const text = `Hi there,\n\nYour new registration code is: ${code}\n\nVisit ${registerUrl} to register your star.\n\nWarmest wishes,\nThe Name a Bright Star Team`;

  if (!transporter) {
    console.log(`[DEV] Would email new code ${code} to ${toEmail}`);
    return { dev: true };
  }

  const info = await transporter.sendMail({ from, to: toEmail, subject: `Your Name a Bright Star registration code ✨`, html, text });
  logSent(toEmail, 'New registration code', 'new_code');
  return info;
}

async function sendSpellingFixConfirmation(toEmail, starName) {
  const transporter = createTransporter();
  const from = `"Name a Bright Star" <${process.env.SMTP_USER || 'support@nameabrightstar.com'}>`;

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

  if (!transporter) {
    console.log(`[DEV] Would email spelling fix confirmation to ${toEmail}`);
    return { dev: true };
  }

  const info = await transporter.sendMail({ from, to: toEmail, subject: `Your star registration has been updated ✨`, html });
  logSent(toEmail, `Registration update: ${starName}`, 'spelling_fix');
  return info;
}

async function sendRawEmail({ from, to, subject, body }) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[DEV] Would send email to ${to}: ${subject}`);
    return { dev: true };
  }

  const info = await transporter.sendMail({
    from: `"Name a Bright Star" <${from}>`,
    to,
    subject,
    text: body,
    html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 20px;white-space:pre-wrap">${body.replace(/\n/g, '<br>')}</div>`,
  });
  logSent(to, subject, 'raw_email');

  // Save to IMAP Sent folder for audit trail
  try {
    const { appendToSent } = require('./imap');
    await appendToSent(from || process.env.SMTP_USER, { to, from, subject, text: body });
  } catch (e) {
    console.error('[email] appendToSent failed:', e.message);
  }

  return info;
}

function hasReceivedReply(toEmail) {
  const entries = loadLog();
  return entries.some(e => e.to.toLowerCase() === toEmail.toLowerCase());
}

module.exports = { sendNewCode, sendSpellingFixConfirmation, sendRawEmail, alreadySent, logSent, hasReceivedReply };
