/* POST /api/staff/logout — clear the staff session cookie.

   The web back office had no way to actually end a session: "Sign out" could only
   drop the client-side UI while the HttpOnly `rs` cookie (and its 12h validity)
   survived, so a reload silently re-entered as the previous operator. This clears
   it server-side. (The native app authenticates with a bearer token it simply
   discards on sign-out; there's no cookie to clear there.) */
import { clearSessionCookieHeader, csrfOriginCheck } from '../../_lib/auth.js';

export const onRequestPost = async ({ request }) => {
  const csrf = csrfOriginCheck(request);
  if (csrf) return csrf;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookieHeader() },
  });
};
