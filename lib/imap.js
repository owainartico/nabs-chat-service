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

        // Parse body from raw source — handles quoted-printable, base64, charset
        const source = msg.source ? msg.source : Buffer.alloc(0);
        const body = extractPlainText(source);

        // Extract real customer email from Shopify contact forms
        let rawFromEmail = msg.envelope?.from?.[0]?.address || '';
        let effectiveEmail = rawFromEmail;
        let effectiveName = msg.envelope?.from?.[0]?.name || '';
        if (rawFromEmail.includes('shopify') || rawFromEmail.includes('mailer@')) {
          const emailMatch = body.match(/email[:\s]+([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
          const nameMatch = body.match(/name[:\s]+([^\n\r]+)/i);
          if (emailMatch) effectiveEmail = emailMatch[1].trim();
          if (nameMatch) effectiveName = nameMatch[1].trim();
        }

        emails.push({
          uid,
          from: effectiveName ? `${effectiveName} <${effectiveEmail}>` : effectiveEmail,
          fromEmail: effectiveEmail,
          rawFromEmail,
          isShopifyForm: rawFromEmail.includes('shopify') || rawFromEmail.includes('mailer@'),
          subject: decodeEncodedWords(msg.envelope?.subject || '(no subject)'),
          date: msg.envelope?.date || new Date(),
          body: sanitizeText(body.trim()).slice(0, 2000),
          to: username,
        });

        // Mark as seen so we don't reprocess on next poll
        try {
          await client.messageFlagsAdd(`${uid}`, ['\\Seen'], { uid: true });
        } catch (e) { /* non-fatal */ }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return emails;
}

/**
 * Decode RFC 2047 encoded-word sequences in headers like:
 * =?UTF-8?Q?Hello_World?=  or  =?ISO-8859-1?B?SGVsbG8=?=
 */
function decodeEncodedWords(str) {
  if (!str) return str;
  return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (match, charset, encoding, encoded) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        const buf = Buffer.from(encoded, 'base64');
        return buf.toString('utf8');
      } else {
        // Q encoding: _ = space, =XX = hex byte
        const decoded = encoded.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (m, hex) =>
          String.fromCharCode(parseInt(hex, 16))
        );
        return decoded;
      }
    } catch (e) {
      return match;
    }
  });
}

/**
 * Decode quoted-printable content.
 * Handles soft line breaks (= at end of line) and =XX hex sequences.
 */
function decodeQuotedPrintable(str) {
  return str
    .replace(/=\r?\n/g, '')                                // soft line break
    .replace(/=([0-9A-Fa-f]{2})/g, (m, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

/**
 * Clean up common encoding artifacts and non-printable characters.
 * Handles Windows-1252 mojibake that appears when Latin-1 bytes are
 * mis-decoded as UTF-8 (e.g., â€" for —, â€˜ for ', etc.)
 */
function sanitizeText(str) {
  if (!str) return '';

  // Replace common Windows-1252 mojibake sequences
  const mojibakeMap = [
    [/â€"/g, '—'],
    [/â€"/g, '–'],
    [/â€˜/g, '\u2018'],
    [/â€™/g, '\u2019'],
    [/â€œ/g, '\u201C'],
    [/â€/g, '\u201D'],
    [/â€¢/g, '•'],
    [/â€¦/g, '…'],
    [/Â /g, ' '],
    [/Â£/g, '£'],
    [/Ã©/g, 'é'],
    [/Ã /g, 'à'],
    [/Ã¨/g, 'è'],
    [/Ã/g, 'À'],
  ];

  let result = str;
  for (const [pattern, replacement] of mojibakeMap) {
    result = result.replace(pattern, replacement);
  }

  // Strip non-printable control characters (but keep newlines/tabs)
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  return result;
}

/**
 * Extract plain text from a raw MIME email (Buffer or string).
 * Handles multipart, quoted-printable, and base64 encoding.
 */
function extractPlainText(source) {
  const raw = Buffer.isBuffer(source) ? source.toString('binary') : source;

  // Split headers from body
  const headerEnd = raw.search(/\r?\n\r?\n/);
  if (headerEnd === -1) return sanitizeText(raw);

  const headerSection = raw.slice(0, headerEnd);
  const bodySection = raw.slice(headerEnd + (raw[headerEnd + 1] === '\n' ? 2 : raw[headerEnd + 2] === '\n' ? 2 : 4));

  const contentType = getHeader(headerSection, 'content-type') || 'text/plain';
  const transferEncoding = (getHeader(headerSection, 'content-transfer-encoding') || '').toLowerCase().trim();

  // Multipart: recurse into parts
  const boundaryMatch = contentType.match(/boundary=["']?([^"';\s]+)["']?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = splitMultipart(bodySection, boundary);
    // Prefer text/plain, fall back to text/html
    let plainText = '';
    let htmlText = '';
    for (const part of parts) {
      const partText = extractPlainText(part);
      const partHeaders = part.slice(0, part.search(/\r?\n\r?\n/));
      const partCT = getHeader(partHeaders, 'content-type') || '';
      if (partCT.startsWith('text/plain') && !plainText) plainText = partText;
      if (partCT.startsWith('text/html') && !htmlText) htmlText = partText;
    }
    return plainText || htmlText || '';
  }

  // Decode transfer encoding
  let decoded = bodySection;
  if (transferEncoding === 'quoted-printable') {
    decoded = decodeQuotedPrintable(bodySection);
  } else if (transferEncoding === 'base64') {
    try {
      // base64 may have line breaks
      const b64 = bodySection.replace(/\s/g, '');
      decoded = Buffer.from(b64, 'base64').toString('utf8');
    } catch (e) {
      decoded = bodySection;
    }
  }

  // Strip HTML if content-type is text/html
  if (contentType.startsWith('text/html')) {
    decoded = decoded
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s{3,}/g, '\n\n')
      .trim();
  }

  return decoded.trim();
}

function getHeader(headerSection, name) {
  const regex = new RegExp(`^${name}:\\s*(.+(?:\\r?\\n[ \\t].+)*)`, 'im');
  const match = headerSection.match(regex);
  if (!match) return null;
  // Unfold and clean
  return match[1].replace(/\r?\n[ \t]/g, ' ').trim();
}

function splitMultipart(body, boundary) {
  const delimiter = '--' + boundary;
  const parts = body.split(new RegExp(`\\r?\\n?${escapeRegex(delimiter)}(?:\\r?\\n|--)`));
  // First part is preamble, last is epilogue
  return parts.slice(1, -1).filter(p => p.trim());
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { fetchNewEmails };
