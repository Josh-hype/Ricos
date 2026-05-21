/* POST /api/account/signout — clear the customer session cookie. */

import { clearCustomerCookieHeader } from '../../_lib/customer-auth.js';

export const onRequestPost = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearCustomerCookieHeader(),
    },
  });
};
