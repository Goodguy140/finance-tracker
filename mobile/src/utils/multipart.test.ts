import { describe, expect, it } from 'vitest';

import { multipartFileBody } from './multipart';

/** Reads the file back the way the server does (`request.formData()`, then `.get('file')`). */
async function sentFile(built: { body: Uint8Array<ArrayBuffer>; contentType: string }): Promise<unknown> {
  const form = await new Response(built.body, { headers: { 'content-type': built.contentType } }).formData();
  // React Native's FormData type has no `get`; this is Node's, which does.
  return (form as unknown as { get(name: string): unknown }).get('file');
}

describe('multipartFileBody', () => {
  it('sends the bytes unchanged, under the name and type given', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x0d, 0x0a, 0x2d, 0x2d, 0x00, 0xd9]);
    const file = await sentFile(multipartFileBody('file', { name: 'receipt.jpg', type: 'image/jpeg', bytes }, 'b0undary'));
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe('receipt.jpg');
    expect((file as File).type).toBe('image/jpeg');
    expect(new Uint8Array(await (file as File).arrayBuffer())).toEqual(bytes);
  });

  it('keeps a name with quotes or accents in one piece', async () => {
    const file = await sentFile(
      multipartFileBody('file', { name: 'Café "lunch".jpg', type: 'image/jpeg', bytes: new Uint8Array([1]) }, 'b0undary'),
    );
    expect((file as File).name).toBe('Café "lunch".jpg');
  });
});
