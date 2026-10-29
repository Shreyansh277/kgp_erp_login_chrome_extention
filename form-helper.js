globalThis.ERPForm = (() => {
  const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const visible = input => !input.disabled && !input.readOnly && input.type !== 'hidden' && input.getClientRects().length > 0;
  function describe(input) {
    return [input.id, input.name, input.placeholder, input.autocomplete, input.getAttribute('aria-label'),
      ...[...(input.labels || [])].map(label => label.textContent)].join(' ');
  }
  function nearby(input) {
    const text = [describe(input)];
    let node = input.parentElement;
    for (let i = 0; node && i < 3 && !['FORM', 'BODY', 'HTML'].includes(node.tagName); i++, node = node.parentElement) {
      const previous = node.previousElementSibling;
      if (previous && !previous.querySelector('input') && previous.textContent.length < 400) text.push(previous.textContent);
      // Bootstrap-style labels are often siblings of an input group, not associated labels.
      for (const label of node.querySelectorAll('label, legend, [data-security-question]')) {
        if (label.textContent.length < 400) text.push(label.textContent);
      }
    }
    return text.join(' ');
  }
  function fields(document) {
    // Verified against ERP's live login.htm source on 2026-10-25.
    // user_id is type=password AND autocomplete=new-password; neither describes its role.
    const form = document.getElementById?.('loginForm');
    if (form) {
      const username = document.getElementById('user_id');
      const password = document.getElementById('password');
      const answer = document.getElementById('answer');
      if (!username || !password || username.form !== form || password.form !== form ||
          !visible(username) || !visible(password)) return null;
      return { username, password, answer: answer?.form === form && visible(answer) ? answer : null };
    }
    const inputs = [...document.querySelectorAll('input')].filter(input => visible(input) && ['text', 'email', 'password', ''].includes(input.type));
    const exclude = /otp|one.time|captcha|security|answer|search/i;
    const usernames = inputs.filter(input => {
      const text = describe(input).replace(/\bnew-password\b|\bcurrent-password\b/g, '');
      return !exclude.test(text) && !/password|passwd|pwd/i.test(text) && /user|login|stakeholder|roll|employee|email/i.test(text);
    });
    const passwords = inputs.filter(input => {
      const text = describe(input);
      return !exclude.test(text) && !usernames.includes(input) && /password|passwd|pwd/i.test(text);
    });
    if (usernames.length !== 1 || passwords.length !== 1) return null;
    const username = usernames[0], password = passwords[0];
    if (username.form !== password.form) return null;
    const answers = inputs.filter(input => input !== username && input !== password && input.form === password.form && /security|answer/i.test(describe(input)) && !/otp|captcha/i.test(describe(input)));
    return { username, password, answer: answers.length === 1 ? answers[0] : null };
  }
  function matchAnswer(input, pairs = []) {
    const question = input.ownerDocument?.getElementById('question');
    const text = normalize(question ? question.textContent : nearby(input));
    const matches = pairs.filter(pair => {
      const question = normalize(pair.question);
      return question && pair.answer && (input.ownerDocument?.getElementById('question') ? text === question : (` ${text} `).includes(` ${question} `));
    });
    return matches.length === 1 ? matches[0].answer : null;
  }
  return { fields, matchAnswer, normalize };
})();
