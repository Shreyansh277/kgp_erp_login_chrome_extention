/* Parse only an OTP candidate, never expose email bodies to the ERP content script. */
globalThis.ERPOTP = (() => {
  const SENDER = 'erpkgp@adm.iitkgp.ac.in';
  // ERP's authored Date becomes Gmail internalDate for these messages. Live
  // inspection found it 6.89 seconds behind the browser's request timestamp.
  // Baseline message IDs establish novelty; allow bounded server clock skew.
  const CLOCK_SKEW_MS = 120000;
  function header(message, name) {
    return (message.payload?.headers || []).find(item => item.name.toLowerCase() === name.toLowerCase())?.value || '';
  }
  function address(text) {
    const match = String(text).trim().match(/^(?:[^<>]*<)?([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+)>?$/i);
    return match ? match[1].toLowerCase() : '';
  }
  function decode(data) {
    const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
  }
  function bodyText(payload) {
    if (!payload || payload.filename) return '';
    if (payload.mimeType === 'text/plain' || payload.mimeType === 'text/html') {
      let text = payload.body?.data ? decode(payload.body.data) : '';
      if (payload.mimeType === 'text/html') {
        text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
          .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
          .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
          .replace(/&(?:nbsp|amp|lt|gt|quot|apos);/gi, ' ');
      }
      return text;
    }
    return (payload.parts || []).map(bodyText).join('\n');
  }
  function extract(message, { requestedAt, now, baseline = [] }) {
    if (!message.id || baseline.includes(message.id) || address(header(message, 'From')) !== SENDER) return null;
    const timestamp = Number(message.internalDate);
    if (!Number.isFinite(timestamp) || timestamp < requestedAt - CLOCK_SKEW_MS || timestamp > now + CLOCK_SKEW_MS) return null;
    if (!/\botp\b|one[ -]?time password/i.test(header(message, 'Subject'))) return null;
    // Never guess between different numbers. Attachments and quoted messages are ignored.
    const body = bodyText(message.payload).split(/\n\s*(?:On .+wrote:|[-]+\s*Forwarded message|>)/i)[0];
    const codes = [...new Set([...body.matchAll(/(?:^|\D)(\d{6})(?!\d)/g)].map(match => match[1]))];
    return codes.length === 1 ? codes[0] : null;
  }
  return { SENDER, CLOCK_SKEW_MS, header, address, extract };
})();
