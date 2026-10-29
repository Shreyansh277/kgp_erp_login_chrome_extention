document.getElementById('extension-id').textContent = chrome.runtime.id;
document.getElementById('configured').textContent = chrome.runtime.getManifest().oauth2?.client_id ? 'OAuth client: configured. Connect Gmail from the extension popup.' : 'OAuth client: not configured yet.';
chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }).then(profile => {
  document.getElementById('profile').textContent = profile.email ? 'Chrome profile / required OTP mailbox: ' + profile.email : 'Sign in to Chrome with the Google account that receives your ERP OTP.';
}).catch(() => { document.getElementById('profile').textContent = 'Could not detect your Chrome account.'; });
