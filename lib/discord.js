const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '1480793131405283429';
const SERVICE_URL = process.env.SERVICE_URL || 'https://nabs-chat.onrender.com';

async function sendApprovalRequest(approval) {
  const approveUrl = `${SERVICE_URL}/approve?id=${approval.id}&action=approve&token=${approval.token}`;
  const rejectUrl  = `${SERVICE_URL}/approve?id=${approval.id}&action=reject&token=${approval.token}`;

  const typeLabels = {
    new_code: '🔑 Generate New Code',
    fix_spelling: '✏️ Fix Spelling',
    reselect_star: '⭐ Allow Star Re-selection'
  };

  const content = [
    `🌟 **NABS Support — Approval Needed**`,
    ``,
    `**Type:** ${typeLabels[approval.type] || approval.type}`,
    `**Customer:** ${approval.email}`,
    `**Details:** ${approval.details}`,
    `**Request ID:** ${approval.id}`,
    ``,
    `✅ **Approve:** <${approveUrl}>`,
    `❌ **Reject:** <${rejectUrl}>`
  ].join('\n');

  const res = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Discord error: ${res.status} ${err}`);
  }

  return res.json();
}

module.exports = { sendApprovalRequest };
