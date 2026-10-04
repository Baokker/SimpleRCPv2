export async function sha256Hex(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
    return bytesToHex(new Uint8Array(digest));
}
function bytesToHex(bytes: Uint8Array): string {
    let out = '';
    for (const b of bytes) {
        out += b.toString(16).padStart(2, '0');
    }
    return out;
}
