/** Bytes from a request field that class-validator checked with @IsBase64. */
export const fromBase64 = (text: string) =>
  new Uint8Array(Buffer.from(text, "base64"));
