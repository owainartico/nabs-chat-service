const { ImapFlow } = require('imapflow');

const IMAP_HOST = process.env.IMAP_HOST || 'mail.privateemail.com';
const IMAP_PORT = parseInt(process.env.IMAP_PORT || '993');
const IMAP_PASS = process.env.IMAP_PASS;

async function fetchNewEmails(username, sinceUid) {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: username, pass: IMAP_PASS },
    logger: false,
  });

  const emails = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Search for unseen emails
      const uids = await client.search({ seen: false }, { uid: true });

      for (const uid of uids) {
        // Skip already processed
        if (sinceUid && uid <= sinceUid) continue;

        const msg = await client.fetchOne(`${uid}`, {
          envelope: true,
          bodyStructure: true,
          source: true,
        }, { uid: true });

        if (!msg) continue;

        // Parse plain text body from source
        const source = msg.source ? msg.source.toString() : '';
        const body = extractPlainText(source);

        emails.push({
          uid,
          from: msg.envelope?.from?.[0]
            ? `${msg.envelope.from[0].name || ''} <${msg.envelope.from[0].address}>`.trim()
            : 'Unknown',
          fromEmail: msg.envelope?.from?.[0]?.address || '',
          subject: msg.envelope?.subject || '(no subject)',
          date: msg.envelope?.date || new Date(),
          body: body.trim().slice(0, 2000),
          to: username,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return emails;
}

function extractPlainText(rawEmail) {
  // Remove headers (everything before first blank line)
  const parts = rawEmail.split(/\r?\n\r?\n/);
  if (parts.length < 2) return rawEmail;

  // Try to find plain text part
  const body = parts.slice(1).join('\n\n');

  // Strip HTML tags if present
  const stripped = body
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{3,}/g, '\n\n')
    .trim();

  return stripped || body;
}

module.exports = { fetchNewEmails };
