globalThis.ERPGmail = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
  const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/';
  const email = value => String(value || '').trim().toLowerCase();
  async function primary() {
    const profile = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
    if (!profile.id || !profile.email) throw new Error('Sign in to this Chrome profile with the Google account that receives your ERP OTP.');
    return { id: profile.id, email: email(profile.email) };
  }
  function configured() {
    return /^[\w-]+\.apps\.googleusercontent\.com$/.test(chrome.runtime.getManifest().oauth2?.client_id || '');
  }
  async function api(token, route) {
    const response = await fetch(BASE + route, {
      headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
      credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      if (response.status === 401) {
        await chrome.identity.removeCachedAuthToken({ token });
        throw new Error('Google authorization expired. Reconnect your profile Gmail in the extension.');
      }
      if (response.status === 403) throw new Error('Gmail access denied. Enable the Gmail API and grant read-only access, or check your Workspace policy.');
      if (response.status === 429) throw new Error('Gmail rate limit reached. Automatic login stopped; try again later.');
      throw new Error('Gmail could not be reached. Automatic login stopped; manual OTP still works.');
    }
    return response.json();
  }
  async function client(interactive = false, binding = null) {
    if (!configured()) throw new Error('Set up a Chrome Extension OAuth client ID first. Open Automatic OTP setup for instructions.');
    const profile = await primary();
    if (binding && (binding.id !== profile.id || email(binding.email) !== profile.email)) {
      throw new Error('Chrome profile changed. Reconnect Gmail before using automatic OTP.');
    }
    let auth;
    try {
      auth = await chrome.identity.getAuthToken({ interactive, account: { id: profile.id }, scopes: [SCOPE], enableGranularPermissions: true });
    } catch {
      throw new Error(interactive ? 'Google connection was not completed. Check your OAuth client setup and consent.' : 'Reconnect profile Gmail in the extension to authorize automatic OTP.');
    }
    const token = typeof auth === 'string' ? auth : auth.token;
    if (!token || (auth.grantedScopes && !auth.grantedScopes.includes(SCOPE))) throw new Error('Read-only Gmail access is required for automatic OTP.');
    const mailbox = await api(token, 'profile');
    if (email(mailbox.emailAddress) !== profile.email) {
      await chrome.identity.removeCachedAuthToken({ token });
      throw new Error('The authorized Gmail mailbox does not match this Chrome profile. No email messages were read.');
    }
    const latest = await primary();
    if (latest.id !== profile.id || latest.email !== profile.email) throw new Error('Chrome profile changed during connection. Please reconnect.');
    return { profile, request: route => api(token, route) };
  }
  const query = since => `from:${ERPOTP.SENDER} {subject:otp subject:"one time password"} after:${Math.floor(since / 1000)}`;
  async function list(client, since, maxResults = 20) {
    return client.request('messages?' + new URLSearchParams({ q: query(since), maxResults: String(maxResults) }));
  }
  async function baseline(client, since) {
    const result = await list(client, since - ERPOTP.CLOCK_SKEW_MS, 100);
    if (result.nextPageToken) throw new Error('Too many recent ERP OTP emails. Complete login manually and try automatic login later.');
    return (result.messages || []).map(message => message.id);
  }
  async function find(client, job, now) {
    const result = await list(client, job.requestedAt - ERPOTP.CLOCK_SKEW_MS);
    const candidates = [];
    for (const message of (result.messages || []).slice(0, 20)) {
      if (job.baseline.includes(message.id)) continue;
      const full = await client.request('messages/' + encodeURIComponent(message.id) + '?format=full');
      const code = ERPOTP.extract(full, { requestedAt: job.requestedAt, now, baseline: job.baseline });
      if (code) candidates.push({ code, messageId: full.id });
    }
    if (candidates.length > 1) throw new Error('Multiple new ERP OTP emails found. Complete login manually to avoid using the wrong code.');
    return candidates[0] || null;
  }
  return { primary, configured, client, baseline, find };
})();
