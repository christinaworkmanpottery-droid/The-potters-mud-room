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
  function cancelVoice(message = '', abort = true) {
    const old = recognition; recognition = null;
    clearTimeout(voiceTimer); clearTimeout(stopTimer);
    if (old) {
      old.engine.onstart = old.engine.onaudiostart = old.engine.onsoundstart = old.engine.onresult = old.engine.onerror = old.engine.onend = null;
      if (abort) try { old.engine.abort(); } catch (_) { /* Already ended. Never restart. */ }
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
    try {
      const engine = new (speechConstructor())();
      turn = {engine, stopping: false, finalText: '', draft: '', heardSound: false}; recognition = turn;
      engine.continuous = false; engine.interimResults = true; engine.maxAlternatives = 1; engine.lang = 'en-US';
      const finish = (message, ended = false, allowFinal = false) => {
        if (!active()) return;
        const finalText = turn.finalText, draft = turn.draft;
        cancelVoice('', !ended);
        if (allowFinal && finalText) {
          input.value = finalText;
          void submit();
          voiceState('Speech received. You can edit the command and send again.');
        } else if (draft) {
          input.value = draft;
          voiceState('Speech was received but not finalized. Check the words above, then tap Send.');
        } else voiceState(message);
      };
      turn.finish = finish;
      engine.onstart = () => { if (active()) voiceState(turn.stopping ? 'Finishing speech…' : 'Listening — speak now. Tap Stop when finished.'); };
      engine.onaudiostart = () => { if (active() && !turn.stopping) voiceState('Microphone ready — speak now. Tap Stop when finished.'); };
      engine.onsoundstart = () => { if (active()) { turn.heardSound = true; voiceState('Sound detected. Listening for your words…'); } };
      engine.onresult = event => {
        if (!active()) return;
        const results = Array.from(event.results || []);
        const text = results.map(r => typeof r?.[0]?.transcript === 'string' ? r[0].transcript.trim() : '').filter(Boolean).join(' ');
        if (!text || text.length > 200) {
          finish('Please say a command of 200 characters or fewer, or type your question.'); return;
        }
        // Interim words are a draft only: they must never trigger navigation/actions.
        turn.draft = text;
        if (results.length && results.every(r => r.isFinal === true)) {
          turn.finalText = text;
          stopVoice(); // Wait for the engine to disconnect before enabling another attempt.
        } else voiceState('Hearing: ' + text);
      };
      engine.onerror = event => {
        const messages = {
          'not-allowed':'Microphone or speech permission was denied. You can type your question.',
          'service-not-allowed':'Speech permission was denied. You can type your question.',
          'audio-capture':'The browser could not access the microphone. You can type your question.',
          'network':'The speech service connection failed. You can try again or type your question.',
          'no-speech':'The speech service returned no words. Try again after “Microphone ready”, or type your question.',
          'aborted':'Speech was interrupted. Tap to try again or type your question.',
          'language-not-supported':'The speech service cannot use this language. You can type your question.'
        };
        finish(messages[event.error] || 'Speech is unavailable. You can try again or type your question.');
      };
      engine.onend = () => finish(turn.heardSound
        ? 'Sound was detected, but the speech service returned no words. You can retry or type your question.'
        : 'No speech text was returned by the browser. Wait for “Microphone ready” before speaking, or type your question.', true, true);
      voiceState('Starting microphone… Wait for “Microphone ready” before speaking.');
      // Foreground single attempt only; no automatic restart or background capture.
      voiceTimer = setTimeout(() => { if (active()) stopVoice(); }, 20000);
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
      if (recognition === turn) turn.finish('The speech service did not finish. You can try again or type your question.', false, true);
    }, 5000);
    try { turn.engine.stop(); } catch (_) { turn.finish('Speech could not finish. You can type your question.'); }
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
    pendingText = text; output.textContent = 'Looking up your studio request…';
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
      } else if (response.status === 400 && data.code === 'ACTION_NOT_AVAILABLE') {
        output.textContent = 'Studio changes are not available through this assistant yet. No changes were made. Use the existing forms.';
      } else {
        if (!response.ok || data.version !== 1 || data.requestId !== requestId ||
            data.accountId !== account || typeof data.response?.text !== 'string') throw Error('Unavailable');
        // The core owns all facts and wording, including empty/undated/tied records.
        output.textContent = data.response.text;
        if (data.response.navigation) followNavigation(data.response.navigation);
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
  function followNavigation(target) {
    // Server output is still untrusted: never execute URLs, code, or arbitrary routes.
    const pages = ['pieces','clayBodies','glazes','chemicals','testTiles','firings',
      'pricingCalculator','sales','projects','contacts','events','studioSearch','visualSearch'];
    const types = ['piece','clay','glaze','raw-material','test-tile','firing','pricing','sale','project','contact','event','all'];
    const keys = Object.keys(target).sort().join(',');
    if (target.kind === 'page' && keys === 'kind,page' && pages.includes(target.page)) {
      navigate(target.page); return;
    }
    if (target.kind === 'record' && keys === 'id,kind,type' && target.type === 'firing' &&
        typeof target.id === 'string' && target.id.length > 0 && target.id.length <= 200 && window.StudioSearch) {
      void window.StudioSearch.open('firing',target.id); return;
    }
    if (target.kind === 'search' && keys === 'kind,query,type' && types.includes(target.type) &&
        typeof target.query === 'string' && target.query.trim().length >= 2 && target.query.length <= 120 &&
        !/[\x00-\x1f\x7f]/.test(target.query) && window.StudioSearch?.runQuery) {
      window.StudioSearch.runQuery(target.query,target.type); return;
    }
    throw Error('Invalid navigation');
  }
  function mount() {
    page = node('section'); page.id = 'pageQLAssistant'; page.className = 'page';
    page.style.maxWidth = '640px'; page.setAttribute('aria-labelledby', 'qlAssistantHeading');
    const heading = node('h2', displayName); heading.id = 'qlAssistantHeading';
    const help = node('p', 'Open any studio feature, find saved records, or ask when you last fired. Try “Open my test tiles”, “Find blue glazes”, or “Open my last firing”. Changes still use the normal forms.');
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
      const notice = node('p', 'Tap-to-talk — testing. Your browser may send audio to its speech service. This app does not save audio or transcripts. Wait for Microphone ready, speak, then tap Stop. If words need review, tap Send. Typing stays available.');
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
  // A visible page can lose focus to browser controls/permission UI. Only actual
  // hiding, pagehide, navigation, or account changes cancel foreground speech.
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
