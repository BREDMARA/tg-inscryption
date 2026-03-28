import crypto from 'crypto';

export function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return { ok: false, reason: 'missing_init_data_or_token' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing_hash' };

  const authDateRaw = params.get('auth_date');
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) return { ok: false, reason: 'bad_auth_date' };

  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > 86400) return { ok: false, reason: 'expired_auth_date' };

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const ok = crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash));
  if (!ok) return { ok: false, reason: 'signature_mismatch' };

  const userRaw = params.get('user');
  let user = null;
  try {
    user = userRaw ? JSON.parse(userRaw) : null;
  } catch {
    return { ok: false, reason: 'invalid_user_json' };
  }

  return { ok: true, user, authDate };
}
