/**
 * A `multipart/form-data` body holding one file, built by hand.
 *
 * Expo's `fetch` (the app's global `fetch` since SDK 58) cannot send React Native's
 * `{ uri, name, type }` FormData parts: it throws before the request leaves the phone, which the
 * app reported as "Couldn't reach the server". Reading the photo's bytes and wrapping them here
 * also keeps the file name ours, not the picker's temporary one.
 */
export function multipartFileBody(
  field: string,
  file: { name: string; type: string; bytes: Uint8Array },
  boundary: string,
): { body: Uint8Array<ArrayBuffer>; contentType: string } {
  const head = new TextEncoder().encode(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${quoted(field)}"; filename="${quoted(file.name)}"\r\n` +
      `Content-Type: ${file.type}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + file.bytes.length + tail.length);
  body.set(head, 0);
  body.set(file.bytes, head.length);
  body.set(tail, head.length + file.bytes.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** As browsers write a quoted header value: a quote or line break would end it early. */
function quoted(value: string): string {
  return value.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
