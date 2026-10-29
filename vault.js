/* No plaintext credentials or encryption keys are persisted to disk by this extension. */
globalThis.ERPVault = (() => {
  const encode = bytes => btoa(String.fromCharCode(...bytes));
  const decode = text => Uint8Array.from(atob(text), character => character.charCodeAt(0));
  async function key(passphrase, salt) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  return {
    async encrypt(credentials, passphrase) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(passphrase, salt),
        new TextEncoder().encode(JSON.stringify(credentials)));
      return { version: 1, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
    },
    async decrypt(vault, passphrase) {
      if (vault.version !== 1) throw new Error('Unsupported vault version');
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(vault.iv) },
        await key(passphrase, decode(vault.salt)), decode(vault.ciphertext));
      const credentials = JSON.parse(new TextDecoder().decode(plaintext));
      if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string') throw new Error('Invalid vault');
      return credentials;
    }
  };
})();
