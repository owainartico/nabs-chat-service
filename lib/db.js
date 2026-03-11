const NABS_URL = process.env.NABS_ADMIN_URL || 'https://name-a-bright-star.onrender.com';
const ADMIN_USER = process.env.NABS_ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.NABS_ADMIN_PASSWORD;

function authHeader() {
  const token = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
  return `Basic ${token}`;
}

async function lookupByEmail(email) {
  const url = `${NABS_URL}/api/admin/registrations?search=${encodeURIComponent(email)}&limit=10`;
  const res = await fetch(url, {
    headers: { Authorization: authHeader() }
  });

  if (!res.ok) throw new Error(`Admin API error: ${res.status}`);
  const data = await res.json();

  if (!data.registrations || data.registrations.length === 0) {
    return { found: false };
  }

  return {
    found: true,
    registrations: data.registrations.map(r => ({
      id: r.id,
      star_name: r.custom_star_name,
      registrant: r.registrant_name,
      recipient: r.recipient_name,
      dedication: r.dedication,
      email: r.email,
      registered_at: r.registered_at,
      certificate_url: `${NABS_URL}/api/certificate/${r.id}`,
      constellation: r.constellation,
      code: r.code
    }))
  };
}

async function validateCode(code) {
  const res = await fetch(`${NABS_URL}/api/validate-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.toUpperCase() })
  });

  if (res.status === 404) return { valid: false, reason: 'not_found' };
  if (res.status === 409) return { valid: false, reason: 'already_used' };
  if (!res.ok) throw new Error(`Validate code error: ${res.status}`);

  const data = await res.json();
  return { valid: true, tier: data.tier };
}

async function generateCode() {
  const res = await fetch(`${NABS_URL}/api/admin/codes/generate?count=1`, {
    method: 'POST',
    headers: { Authorization: authHeader() }
  });

  if (!res.ok) throw new Error(`Generate code error: ${res.status}`);
  const data = await res.json();
  return data.codes[0].code;
}

async function updateRegistration(id, fields) {
  const res = await fetch(`${NABS_URL}/api/admin/registration/${id}`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(fields)
  });

  if (!res.ok) throw new Error(`Update registration error: ${res.status}`);
  return res.json();
}

module.exports = { lookupByEmail, validateCode, generateCode, updateRegistration };
