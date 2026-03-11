const nodemailer = require('nodemailer');

function createTransporter() {
  if (!process.env.SMTP_HOST) {
    return null; // dev mode
  }
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
  const from = `"Name a Bright Star" <${process.env.SMTP_FROM || 'support@nameabrightstar.com'}>`;
  const registerUrl = `https://name-a-bright-star.onrender.com`;

  const html = `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a2e;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="font-size: 26px; color: #1a1a2e;">⭐ Name a Bright Star</h1>
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
        Need help? Reply to this email or visit our support chat at <a href="https://name-a-bright-star.onrender.com" style="color: #c8a84b;">nameabrightstar.com</a>
      </p>
    </div>
  `;

  if (!transporter) {
    console.log(`[DEV] Would email new code ${code} to ${toEmail}`);
    return { dev: true };
  }

  return transporter.sendMail({
    from,
    to: toEmail,
    subject: `Your Name a Bright Star registration code ⭐`,
    html,
  });
}

async function sendSpellingFixConfirmation(toEmail, starName) {
  const transporter = createTransporter();
  const from = `"Name a Bright Star" <${process.env.SMTP_FROM || 'support@nameabrightstar.com'}>`;

  const html = `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a2e;">
      <h1 style="font-size: 26px; text-align: center;">⭐ Name a Bright Star</h1>
      <p>Hi there,</p>
      <p>Your star registration has been updated. The name on your certificate now reads:</p>
      <div style="background: #f8f7f5; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
        <p style="font-size: 22px; font-weight: bold; color: #1a1a2e; margin: 0;">${starName}</p>
      </div>
      <p>You can download your updated certificate from your star page.</p>
      <p style="color: #888; font-size: 13px; border-top: 1px solid #eee; padding-top: 20px; margin-top: 32px;">
        Questions? Contact us at support@nameabrightstar.com
      </p>
    </div>
  `;

  if (!transporter) {
    console.log(`[DEV] Would email spelling fix confirmation to ${toEmail}`);
    return { dev: true };
  }

  return transporter.sendMail({
    from,
    to: toEmail,
    subject: `Your star registration has been updated ⭐`,
    html,
  });
}

module.exports = { sendNewCode, sendSpellingFixConfirmation };
