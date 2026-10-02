/* Bounded QL proof. Speech is transient input to the same typed turn path. */
(() => {
  'use strict';
  const displayName = 'QL assistant — testing';
  const identity = () => JSON.stringify([token, currentUser?.id, localStorage.getItem('mudlog_token')]);
  let session = identity(), invalidSession = null, generation = 0, serial = 0;
  let controller, pendingText = null, enabled = false, entered = false;
  let page, entry, input, form, send, retry, output;
  let voiceEnabled = false, recognition = null, voiceTimer, stopTimer;
  let talk, stop, cancel, voiceStatus;
  const speechConstructor = () => window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechSupported = () => window.isSecureContext === true && typeof speechConstructor() === 'function';
  function voiceState(message = '') {
    if (!talk) return;
    talk.hidden = !speechSupported();
    talk.disabled = !available() || !speechSupported() || Boolean(recognition);
    stop.hidden = cancel.hidden = !recognition;
    stop.disabled = Boolean(recognition?.stopping);
    voiceStatus.textContent = message;
  }
  function cancelVoice(message = '') {
    const old = recognition; recognition = null;
    clearTimeout(voiceTimer); clearTimeout(stopTimer);
    if (old) {
      old.engine.onstart = old.engine.onresult = old.engine.onerror = old.engine.onend = null;
      try { old.engine.abort(); } catch (_) { /* Already ended. Never restart. */ }
    }
    voiceState(message);
  }
  function startVoice() {
    syncSession();
    if (!voiceEnabled || !available() || !entered || currentPage !== 'qlAssistant' || document.hidden || recognition) return;
    if (!speechSupported()) { voiceState('Speech is unavailable in this browser. You can type your question.'); return; }
    // A new voice attempt supersedes any pending typed/voice answer.
    invalidate();
    const epoch = generation, ownSession = session;
    let turn;
    const active = () => {
      syncSession();
      return recognition === turn && epoch === generation && ownSession === session &&
        available() && entered && currentPage === 'qlAssistant' && !document.hidden;
    };
    const fail = message => { if (active()) cancelVoice(message); };
    try {
      const engine = new (speechConstructor())();
      turn = {engine, stopping: false}; recognition = turn;
      engine.continuous = false; engine.interimResults = false; engine.maxAlternatives = 1; engine.lang = 'en-US';
      engine.onstart = () => { if (active()) voiceState(turn.stopping ? 'Finishing speech…' : 'Listening… Stop to finish, or Cancel.'); };
      engine.onresult = event => {
        if (!active()) return;
        const result = event.results?.[event.resultIndex ?? 0];
        if (!result?.isFinal) return;
        const text = typeof result[0]?.transcript === 'string' ? result[0].transcript.trim() : '';
        cancelVoice(); // Detach before submitting: duplicate engine events cannot send twice.
        if (!text || text.length > 200) { voiceState('Please say a question of 200 characters or fewer, or type it.'); return; }
        input.value = text;
        voiceState('Speech received. You can edit the question and send again.');
        void submit();
      };
      engine.onerror = event => fail(['not-allowed', 'service-not-allowed'].includes(event.error)
        ? 'Microphone or speech permission was denied. You can type your question.'
        : 'Speech is unavailable or could not be heard. You can try again or type your question.');
      engine.onend = () => fail('No speech was received. You can try again or type your question.');
      voiceState('Starting microphone… You can cancel.');
      // Bound both permission/listening and stop completion; never auto-restart.
      voiceTimer = setTimeout(() => fail('Listening timed out. You can try again or type your question.'), 20000);
      engine.start();
    } catch (_) {
      cancelVoice('Speech could not start. Check microphone permission, or type your question.');
    }
  }
  function stopVoice() {
    const turn = recognition;
    if (!turn || turn.stopping) return;
    turn.stopping = true; voiceState('Finishing speech…');
    stopTimer = setTimeout(() => {
      if (recognition === turn) cancelVoice('Speech did not finish. You can try again or type your question.');
    }, 3000);
    try { turn.engine.stop(); } catch (_) { cancelVoice('Speech could not finish. You can type your question.'); }
  }
  const node = (tag, text) => { const n = document.createElement(tag); if (text) n.textContent = text; return n; };
  const authenticated = () => Boolean(token && currentUser?.id && token === localStorage.getItem('mudlog_token') && invalidSession !== identity());
  const available = () => enabled && authenticated();
  function invalidate() {
    cancelVoice();
    generation++; serial++; controller?.abort(); controller = null; pendingText = null;
    if (input) { input.value = ''; output.textContent = ''; retry.hidden = true; form.setAttribute('aria-busy', 'false'); send.disabled = false; }
  }
  function syncSession() {
    const next = identity();
    if (next !== session) { invalidate(); session = next; }
    if (entry) entry.hidden = !available();
    if (form) { input.disabled = !available(); send.disabled = !available(); }
    if (!available()) { entered = false; if (page) page.classList.remove('active'); }
    if (talk) talk.disabled = !available() || !speechSupported() || Boolean(recognition);
  }
  function sessionInvalid() {
    invalidate(); invalidSession = identity(); syncSession();
  }
  function onNavigate(destination) {
    syncSession();
    if (destination !== 'qlAssistant') { entered = false; invalidate(); }
  }
  function enter() {
    syncSession(); if (!available()) return;
    entered = true; input.focus();
  }
  async function submit() {
    syncSession();
    if (!available() || !entered || currentPage !== 'qlAssistant' || document.hidden) return;
    cancelVoice();
    const text = input.value.trim();
    if (!text || text.length > 200 || pendingText === text) return;
    controller?.abort(); controller = new AbortController();
    const abort = controller, requestId = 'web-' + (++serial), ownSerial = serial, epoch = generation;
    const account = currentUser.id, credential = token, ownSession = session;
    const active = () => {
      syncSession();
      return available() && entered && currentPage === 'qlAssistant' && epoch === generation &&
        ownSerial === serial && ownSession === session && !abort.signal.aborted;
    };
    pendingText = text; output.textContent = 'Looking up your latest recorded firing…';
    retry.hidden = true; form.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(API + '/api/ql/assistant/turn', {
        method: 'POST', cache: 'no-store', signal: abort.signal,
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + credential},
        body: JSON.stringify({version: 1, requestId, input: {text}})
      });
      if (!active()) return;
      if (response.status === 401) { sessionInvalid(); return; }
      const data = await response.json();
      if (!active()) return;
      if (response.status === 400 && data.code === 'UNSUPPORTED_INTENT') {
        output.textContent = 'That question isn’t supported in this test version yet.';
      } else {
        if (!response.ok || data.version !== 1 || data.requestId !== requestId ||
            data.accountId !== account || typeof data.response?.text !== 'string') throw Error('Unavailable');
        // The core owns all facts and wording, including empty/undated/tied records.
        output.textContent = data.response.text;
      }
    } catch (_) {
      if (active()) {
        output.textContent = 'The assistant is unavailable. Try again or open Firings.';
        retry.hidden = false;
      }
    } finally {
      if (active()) { pendingText = null; controller = null; form.setAttribute('aria-busy', 'false'); }
    }
  }
  function mount() {
    page = node('section'); page.id = 'pageQLAssistant'; page.className = 'page';
    page.style.maxWidth = '640px'; page.setAttribute('aria-labelledby', 'qlAssistantHeading');
    const heading = node('h2', displayName); heading.id = 'qlAssistantHeading';
    const help = node('p', 'This test answers one question: “When was my last firing?”');
    form = node('form'); form.id = 'qlAssistantForm'; form.setAttribute('aria-busy', 'false');
    const label = node('label', 'Your question'); label.htmlFor = 'qlAssistantInput';
    input = node('input'); input.id = 'qlAssistantInput'; input.type = 'text'; input.maxLength = 200;
    input.className = 'form-input'; input.required = true; input.autocomplete = 'off';
    send = node('button', 'Send'); send.type = 'submit'; send.className = 'btn btn-primary';
    retry = node('button', 'Retry'); retry.id = 'qlAssistantRetry'; retry.type = 'button';
    retry.className = 'btn btn-secondary'; retry.hidden = true; retry.onclick = () => void submit();
    output = node('p'); output.id = 'qlAssistantResponse'; output.setAttribute('role', 'status'); output.setAttribute('aria-live', 'polite');
    const fallback = node('button', 'Open Firings'); fallback.type = 'button'; fallback.className = 'btn btn-secondary';
    fallback.onclick = () => navigate('firings');
    form.append(label, input, send, retry); form.onsubmit = e => { e.preventDefault(); void submit(); };
    page.append(heading, help, form, output, fallback);
    if (voiceEnabled) {
      const voice = node('div'); voice.id = 'qlAssistantVoice';
      const notice = node('p', 'Tap-to-talk — testing. Your browser may send audio to its speech service. This app does not save audio or transcripts. One question per tap; typing stays available.');
      talk = node('button', 'Tap to talk — test'); talk.id = 'qlAssistantTalk';
      stop = node('button', 'Stop listening'); stop.id = 'qlAssistantStop';
      cancel = node('button', 'Cancel listening'); cancel.id = 'qlAssistantCancelVoice';
      for (const button of [talk, stop, cancel]) { button.type = 'button'; button.className = 'btn btn-secondary'; }
      talk.onclick = startVoice; stop.onclick = stopVoice;
      cancel.onclick = () => cancelVoice('Listening canceled. You can type your question.');
      voiceStatus = node('p'); voiceStatus.id = 'qlAssistantVoiceStatus'; voiceStatus.setAttribute('role', 'status');
      voice.append(notice, talk, stop, cancel, voiceStatus); form.after(voice);
      voiceState(speechSupported() ? 'Ready when you tap.' : 'Speech is unavailable in this browser. You can type your question.');
      input.addEventListener('input', () => cancelVoice());
    }
    document.getElementById('pageStudioSearch').after(page);
    entry = node('button', displayName); entry.id = 'qlAssistantEntry'; entry.className = 'nav-link';
    entry.dataset.page = 'qlAssistant'; entry.type = 'button';
    entry.onclick = () => { navigate('qlAssistant'); closeNav(); };
    document.querySelector('[data-page="studioSearch"]').after(entry);
    syncSession();
    if (available() && location.hash === '#qlAssistant') navigate('qlAssistant', {fromHistory: true});
  }
  window.QLAssistant = {invalidate, syncSession, sessionInvalid, available, onNavigate, enter};
  window.addEventListener('storage', e => {
    if (e.key === 'mudlog_token' || e.key == null) { invalidate(); syncSession(); }
  });
  for (const event of ['hashchange', 'popstate']) window.addEventListener(event, () => onNavigate(location.hash.slice(1).split('?')[0]));
  window.addEventListener('pagehide', () => { entered = false; invalidate(); });
  window.addEventListener('blur', () => { if (voiceEnabled) invalidate(); });
  window.addEventListener('pageshow', () => { syncSession(); if (available() && currentPage === 'qlAssistant') entered = true; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) invalidate();
    syncSession();
  });
  // Failed/missing configuration is OFF. No HTML entry exists until explicit opt-in.
  fetch(API + '/api/ql/assistant/config', {cache: 'no-store'})
    .then(r => r.ok ? r.json() : null)
    .then(config => { if (config?.enabled === true) { enabled = true; voiceEnabled = config.voiceEnabled === true; mount(); } })
    .catch(() => {});
})();
