import { describe, expect, it } from 'vitest';

import { ApiError, errorFromResponse, SignedOutError } from './client';

describe('errorFromResponse', () => {
  it('signs the phone out on a 401', async () => {
    expect(await errorFromResponse(new Response('', { status: 401 }))).toBeInstanceOf(SignedOutError);
  });

  it("shows the server's own words for a refusal", async () => {
    const res = new Response(JSON.stringify({ error: 'The amount is out of range.' }), { status: 400 });
    const error = await errorFromResponse(res);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: 'The amount is out of range.' });
  });

  it('falls back to a retry hint for a server error or a body that is not JSON', async () => {
    expect((await errorFromResponse(new Response('<html>', { status: 404 }))).message).toBe(
      'The server answered 404. Try again shortly.',
    );
    expect((await errorFromResponse(new Response(JSON.stringify({ error: 'stack trace' }), { status: 500 }))).message).toBe(
      'The server answered 500. Try again shortly.',
    );
  });
});
