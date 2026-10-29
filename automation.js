/* State survives service-worker restarts; only one ERP tab may own an OTP attempt. */
globalThis.ERPAutomation = (() => {
  const TIMEOUT = 120000;
  async function fingerprint(credentials) {
    const bytes = new TextEncoder().encode(JSON.stringify(credentials));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function save(job) { await chrome.storage.session.set({ automationJob: job }); }
  const sameDocument = (job, sender) => job.tabId === sender.tab.id && job.documentId === sender.documentId;
  async function gate(expected = null) {
    const [{ automationEnabled, gmailConnection }, { credentials }] = await Promise.all([
      chrome.storage.local.get(['automationEnabled', 'gmailConnection']), chrome.storage.session.get('credentials')
    ]);
    if (!automationEnabled) throw new Error('Automatic OTP is off.');
    if (!credentials) throw new Error('Vault locked. Unlock it to use automatic login.');
    if (expected && (credentials.username !== expected.username || await fingerprint(credentials) !== expected.credentialsHash)) throw new Error('Saved ERP credentials changed. Reload the login page.');
    if (!gmailConnection) throw new Error('Connect profile Gmail in the extension first.');
    const profile = await ERPGmail.primary();
    if (expected && expected.accountId !== profile.id) throw new Error('Chrome profile changed during login. Reconnect Gmail.');
    if (gmailConnection.id !== profile.id || gmailConnection.email !== profile.email) throw new Error('This Chrome profile no longer matches the connected Gmail mailbox. Reconnect Gmail.');
    return { credentials, connection: gmailConnection };
  }
  async function cancel(sender = null, reason = 'Automatic login cancelled. You can complete OTP manually.') {
    const { automationJob: job } = await chrome.storage.session.get('automationJob');
    if (job && (!sender || sameDocument(job, sender)) && !['submitted', 'error'].includes(job.phase)) {
      job.phase = 'error'; job.status = reason; delete job.baseline;
      await save(job);
    }
    return { action: 'stopped', message: reason };
  }
  async function step(page, sender) {
    if (!sender.documentId || !Number.isInteger(sender.tab?.id)) throw new Error('Reload the ERP login tab to enable automatic OTP.');
    let { automationJob: job } = await chrome.storage.session.get('automationJob');
    const now = Date.now();
    if (job && !sameDocument(job, sender)) {
      // Never hand one tab's OTP to another. Wait out pending email delivery first.
      if (now < job.deadline) return { action: 'stopped', message: 'Another ERP page owns this OTP attempt. Finish there, or wait two minutes and reload ERP before trying again.' };
      job = null;
    }
    if (job && ['error', 'submitted', 'codeIssued'].includes(job.phase)) {
      return { action: 'stopped', message: job.status || 'Automatic login already attempted. Complete manually, or reload ERP for a new attempt.' };
    }
    if (job && now >= job.deadline) return cancel(sender, 'OTP timed out after two minutes. Check that ERP sends OTP to this Chrome profile email. Complete manually or reload ERP to retry.');
    try {
      const { credentials, connection } = await gate(job);
      if (page.failed) throw new Error('ERP reported an OTP or login error. Automatic login stopped; check the ERP message.');
      if (!job) {
        if (page.otpPresent || page.otpEditable) return { action: 'stopped', message: 'An OTP request is already in progress. Finish it manually or reload ERP to start automatic login.' };
        if (!page.ready) return { action: 'waiting', message: 'Waiting for credentials and a matching security answer.' };
        const snapshot = { username: credentials.username, accountId: connection.id, credentialsHash: await fingerprint(credentials) };
        const client = await ERPGmail.client(false, connection);
        const baseline = await ERPGmail.baseline(client, Date.now());
        await gate(snapshot);
        const requestedAt = Date.now();
        job = { id: crypto.randomUUID(), tabId: sender.tab.id, documentId: sender.documentId,
          ...snapshot, phase: 'requestIssued', baseline,
          requestedAt, deadline: requestedAt + TIMEOUT, nextPoll: 0, status: 'Requesting one ERP OTP…' };
        await save(job); // Persist before telling the tab to click Get OTP.
        return { action: 'requestOtp', jobId: job.id, message: job.status };
      }
      if (job.accountId !== connection.id) throw new Error('Google account changed during login. Reload ERP after reconnecting Gmail.');
      if (page.otpPresent) return cancel(sender, 'OTP field already contains input. Automatic login stopped to preserve your entry.');
      if (!page.otpEditable) return { action: 'waiting', message: 'Waiting for ERP to confirm the OTP request…' };
      if (now < job.nextPoll) return { action: 'waiting', message: job.status };
      job.phase = 'waiting'; job.nextPoll = now + 4000;
      job.status = 'Waiting for a fresh ERP OTP in your Chrome profile Gmail…';
      await save(job);
      const client = await ERPGmail.client(false, connection);
      const candidate = await ERPGmail.find(client, job, Date.now());
      if (!candidate) return { action: 'waiting', message: job.status };
      await gate(job); // Lock/off/profile/credential changes during a fetch must cancel submission.
      if (Date.now() >= job.deadline) throw new Error('OTP arrived after the automatic login timeout. Complete login manually.');
      job.phase = 'codeIssued'; job.messageId = candidate.messageId;
      job.status = 'Fresh OTP retrieved. Submitting ERP login once…'; delete job.baseline;
      await save(job); // One-time delivery: a lost response cannot trigger another submission.
      return { action: 'submit', jobId: job.id, otp: candidate.code, message: job.status };
    } catch (error) {
      if (job) { job.phase = 'error'; job.status = error.message; delete job.baseline; await save(job); }
      return { action: 'stopped', message: error.message };
    }
  }
  async function submitted(id, sender) {
    const { automationJob: job } = await chrome.storage.session.get('automationJob');
    if (job && sameDocument(job, sender) && job.id === id && job.phase === 'codeIssued') {
      job.phase = 'submitted'; job.status = 'Login submitted once. ERP will show the result.'; await save(job);
    }
    return { ok: true };
  }
  return { step, cancel, submitted };
})();
