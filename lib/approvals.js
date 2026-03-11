const crypto = require('crypto');

// In-memory store — survives as long as the service is up
// For production, persist to DB
const pending = new Map();

function create(type, email, details, registrationId = null) {
  const id = crypto.randomBytes(8).toString('hex');
  const token = crypto.randomBytes(16).toString('hex');

  const approval = {
    id,
    token,
    type,
    email,
    details,
    registration_id: registrationId,
    status: 'pending',
    created_at: Date.now(),
    session_id: null  // set by caller
  };

  pending.set(id, approval);
  return approval;
}

function get(id) {
  return pending.get(id) || null;
}

function resolve(id, action) {
  const approval = pending.get(id);
  if (!approval) return null;
  approval.status = action; // 'approve' or 'reject'
  approval.resolved_at = Date.now();
  return approval;
}

function linkSession(id, sessionId) {
  const approval = pending.get(id);
  if (approval) approval.session_id = sessionId;
}

module.exports = { create, get, resolve, linkSession };
