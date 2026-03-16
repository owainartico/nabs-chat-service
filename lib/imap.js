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
      const uids = await client.search({ seen: false }, { uid: true });

      for (const uid of uids) {
        if (sinceUid && uid <= sinceUid) continue;

        const msg = await client.fetchOne(`${uid}`, {
          envelope: true,
          bodyStructure: true,
          source: true,
        }, { uid: true });

        if (!msg) continue;

        const source = msg.source ? msg.source : Buffer.alloc(0);
        const body = extractPlainText(source);

        emails.push({
          uid,
          from: msg.envelope?.from?.[0]
            ? `${msg.envelope.from[0].name || ''} <${msg.envelope.from[0].address}>`.trim()
            : 'Unknown',
          fromEmail: msg.envelope?.from?.[0]?.address || '',
          subject: decodeEncodedWords(msg.envelope?.subject || '(no subject)'),
          date: msg.envelope?.date || new Date(),
          body: sanitizeText(body.trim()).slice(0, 2000),
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

// Mark a list of UIDs as read in the inbox
async function markAsRead(username, uids) {
  if (!uids || uids.length === 0) return;
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: username, pass: IMAP_PASS },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      await client.messageFlagsAdd(uids.join(','), ['\\Seen'], { uid: true });
      console.log(`[imap] Marked ${uids.length} email(s) as read in ${username}`);
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error(`[imap] markAsRead failed for ${username}:`, err.message);
  } finally {
    await client.logout().catch(() => {});
  }
}

// Append a sent email to the Sent folder so it appears in webmail
async function appendToSent(username, { to, from, subject, text, date }) {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: username, pass: IMAP_PASS },
    logger: false,
  });
  try {
    await client.connect();
    const sentDate = date || new Date();
    const rawMessage = [
      `Date: ${sentDate.toUTCString()}`,
      `From: ${from || `"Name a Bright Star" <${username}>`}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      text || '',
    ].join('\r\n');

    await client.append('Sent', rawMessage, ['\\Seen'], sentDate);
    console.log(`[imap] Saved to Sent folder: "${subject}" → ${to}`);
  } catch (err) {
    console.error(`[imap] appendToSent failed:`, err.message);
  } finally {
    await client.logout().catch(() => {});
  }
}

function decodeEncodedWords(str) {
  if (!str) return str;
  return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (match, charset, encoding, encoded) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        return Buffer.from(encoded, 'base64').toString('utf8');
      } else {
        return encoded.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (m, hex) =>
          String.fromCharCode(parseInt(hex, 16))
        );
      }
    } catch (e) { return match; }
  });
}

function decodeQuotedPrintable(str) {
  return str
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function sanitizeText(str) {
  if (!str) return '';
  const mojibakeMap = [
    [/\u00e2\u20ac\u201c/g, '\u2014'], [/\u00e2\u20ac\u2013/g, '\u2013'],
    [/\u00e2\u20ac\u2122/g, '\u2019'], [/\u00e2\u20ac\u0153/g, '\u201c'],
    [/\u00e2\u20ac\u009d/g, '\u201d'], [/\u00e2\u20ac\u00a2/g, '\u2022'],
    [/\u00e2\u20ac\u00a6/g, '\u2026'], [/\u00c2\u00a0/g, ' '],
  ];
  let result = str;
  for (const [pattern, replacement] of mojibakeMap) {
    result = result.replace(pattern, replacement);
  }
  return result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function extractPlainText(source) {
  const raw = Buffer.isBuffer(source) ? source.toString('binary') : source;
  const headerEnd = raw.search(/\r?\n\r?\n/);
  if (headerEnd === -1) return sanitizeText(raw);
  const headerSection = raw.slice(0, headerEnd);
  const bodySection = raw.slice(headerEnd + (raw[headerEnd + 1] === '\n' ? 2 : 4));
  const contentType = getHeader(headerSection, 'content-type') || 'text/plain';
  const transferEncoding = (getHeader(headerSection, 'content-transfer-encoding') || '').toLowerCase().trim();
  const boundaryMatch = contentType.match(/boundary=["']?([^"';\s]+)["']?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = splitMultipart(bodySection, boundary);
    let plainText = '', htmlText = '';
    for (const part of parts) {
      const partText = extractPlainText(part);
      const partHeaders = part.slice(0, part.search(/\r?\n\r?\n/));
      const partCT = getHeader(partHeaders, 'content-type') || '';
      if (partCT.startsWith('text/plain') && !plainText) plainText = partText;
      if (partCT.startsWith('text/html') && !htmlText) htmlText = partText;
    }
    return plainText || htmlText || '';
  }
  let decoded = bodySection;
  if (transferEncoding === 'quoted-printable') {
    decoded = decodeQuotedPrintable(bodySection);
  } else if (transferEncoding === 'base64') {
    try { decoded = Buffer.from(bodySection.replace(/\s/g, ''), 'base64').toString('utf8'); }
    catch (e) { decoded = bodySection; }
  }
  if (contentType.startsWith('text/html')) {
    decoded = decoded
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n)))
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/\s{3,}/g, '\n\n').trim();
  }
  return decoded.trim();
}

function getHeader(headerSection, name) {
  const regex = new RegExp(`^${name}:\\s*(.+(?:\\r?\\n[ \\t].+)*)`, 'im');
  const match = headerSection.match(regex);
  if (!match) return null;
  return match[1].replace(/\r?\n[ \t]/g, ' ').trim();
}

function splitMultipart(body, boundary) {
  const delimiter = '--' + boundary;
  const parts = body.split(new RegExp(`\\r?\\n?${escapeRegex(delimiter)}(?:\\r?\\n|--)`));
  return parts.slice(1, -1).filter(p => p.trim());
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { fetchNewEmails, markAsRead, appendToSent };
