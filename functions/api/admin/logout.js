/* POST /api/admin/logout — clear the owner session cookie. */
import { clearOwnerCookieHeader, csrfOriginCheck } from '../../_lib/admin-auth.js';

export const onRequestPost = async ({ request }) => {
  const csrf = csrfOriginCheck(request);
  if (csrf) return csrf;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearOwnerCookieHeader() },
  });
};
