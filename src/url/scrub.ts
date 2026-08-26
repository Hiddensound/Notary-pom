// SPDX-License-Identifier: Apache-2.0

const CREDENTIAL_PARAMS = new Set([
  'token', 'access_token', 'id_token', 'refresh_token', 'code', 'state',
  'session', 'sessionid', 'sid', 'auth', 'key', 'apikey', 'api_key',
  'password', 'secret', 'signature', 'sig', 'jwt', 'ticket',
  'x-vercel-protection-bypass', 'magic', 'otp', 'nonce',
]);

export function scrubUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  const kept = [...u.searchParams.entries()]
    .filter(([k]) => !CREDENTIAL_PARAMS.has(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}
