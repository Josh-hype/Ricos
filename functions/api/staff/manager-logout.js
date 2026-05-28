/* POST /api/staff/manager-logout — explicitly close out a manager session
   without ending the staff session. The till calls this on the 90-second
   idle revert so financial views re-prompt for the manager PIN when staff
   come back. Server-side clears the manager cookie (the staff PIN
   session keeps working for placing orders, viewing Live, etc.). */

import { requireStaff, clearManagerCookieHeader } from '../../_lib/auth.js';

export const onRequestPost = async ({ request, env }) => {
  const denied = await requireStaff(request, env);
  if (denied) return denied;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearManagerCookieHeader(),
    },
  });
};
