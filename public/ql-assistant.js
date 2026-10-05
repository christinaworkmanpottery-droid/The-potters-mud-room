/* Bounded QL proof. Speech is transient input to the same typed turn path. */
(() => {
  'use strict';
  const displayName = 'QL assistant — testing recovery';
  const identity = () => JSON.stringify([token, currentUser?.id, localStorage.getItem('mudlog_token')]);
  let conversationToken = null, recordNavigation = false, noteDictation = false;
  let session = identity(), invalidSession = null, generation = 0, serial = 0;
  let controller, pendingText = null, enabled = false, entered = false;
  let page, entry, input, form, send, retry, output, fallback;
  let voiceEnabled = false, recognition = null, voiceTimer, stopTimer;
  let talk, stop, cancel, voiceStatus;
  let handsFreeEnabled = false, handsFree = false, sessionTimer, restartTimer, speechTimer, requestTimer;
  let dock, dockStatus, dockCommand, dockReply, sessionStart, sessionStop, spokenReplies, utterance, notePreview, notePreviewText;
  let speechReview = null;
  let emptyAttempts = 0, voiceEpoch = 0, internalNavigation = false;
  const inVoiceContext = () => entered && (currentPage === 'qlAssistant' || handsFree);
  function sessionState(state, message) {
    if (!dock) return;
    dock.dataset.state = state;
    dockStatus.textContent = message;
    sessionStart.disabled = handsFree || !available() || !speechSupported();
    sessionStop.hidden = !handsFree;
  }
  function endSession(message = 'Stopped — tap Start voice session to resume.', state = 'stopped') {
    speechReview = null;
    handsFree = false; voiceEpoch++; conversationToken = null; noteDictation = false; recordNavigation = false;
    if(notePreview){notePreview.hidden=true;notePreviewText.textContent='';}
    clearTimeout(restartTimer); clearTimeout(sessionTimer); clearTimeout(speechTimer); clearTimeout(requestTimer);
    if (utterance) { utterance.onend = utterance.onerror = utterance.onstart = null; utterance = null; window.speechSynthesis?.cancel(); }
    cancelVoice();
    sessionState(state, message);
  }
  function pauseSession(message = 'Stopped — tap Start voice session to resume.', state = 'stopped') {
    invalidate();
    sessionState(state, message);
  }
  function listenAgain(message = 'Preparing microphone for your next command…') {
    if (!handsFree) return;
    const own = voiceEpoch;
    sessionState('starting', message);
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      syncSession();
      if (handsFree && own === voiceEpoch && available() && !document.hidden) startVoice();
    }, 650);
  }
  function voiceReply(text) {
    if (!handsFree) return;
    dockReply.textContent = text;
    sessionState('responding', 'Response ready.');
    if (!spokenReplies.checked) { listenAgain('Ready for another command…'); return; }
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      pauseSession('Spoken replies are unavailable. Turn off spoken replies and restart for text responses.', 'unavailable'); return;
    }
    const own = voiceEpoch;
    const speech = new window.SpeechSynthesisUtterance(text.slice(0, 600)); utterance = speech;
    speech.lang = 'en-US';
    const active = () => handsFree && own === voiceEpoch && utterance === speech;
    speech.onstart = () => { if (active()) sessionState('speaking', 'Speaking — microphone is off.'); };
    speech.onend = () => { if (active()) { clearTimeout(speechTimer); utterance = null; listenAgain(); } };
    speech.onerror = () => { if (active()) pauseSession('Audio could not play. Turn off spoken replies and restart the session.', 'unavailable'); };
    speechTimer = setTimeout(() => { if (active()) pauseSession('Audio did not finish. Turn off spoken replies and restart the session.', 'unavailable'); }, 30000);
    try { window.speechSynthesis.speak(speech); } catch (_) { speech.onerror(); }
  }
  function beginSession() {
    syncSession();
    if (!handsFreeEnabled || !available() || document.hidden || handsFree) return;
    if (!speechSupported()) { sessionState('unavailable', 'Voice unavailable. Typing and the menu remain available.'); return; }
    invalidate(); handsFree = true; entered = true; emptyAttempts = 0;
    // An explicit new activation only; never resume after hiding or permission denial.
    sessionTimer = setTimeout(() => pauseSession('Stopped after 15 minutes. Tap Start voice session to continue.'), 15 * 60 * 1000);
    startVoice();
  }
  const speechConstructor = () => window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechSupported = () => window.isSecureContext === true && typeof speechConstructor() === 'function';
  function voiceState(message = '') {
    if (!talk) return;
    talk.hidden = !speechSupported();
    talk.disabled = handsFree || !available() || !speechSupported() || Boolean(recognition);
    stop.hidden = cancel.hidden = !recognition;
    stop.disabled = Boolean(recognition?.stopping);
    voiceStatus.textContent = message;
    if (handsFree && message) sessionState(recognition?.stopping ? 'processing' : /^Starting/.test(message) ? 'starting' : 'listening', message);
  }
  function cancelVoice(message = '', abort = true) {
    const old = recognition; recognition = null;
    clearTimeout(voiceTimer); clearTimeout(stopTimer); clearTimeout(old?.finalDisconnectTimer);
    if (old) {
      old.engine.onstart = old.engine.onaudiostart = old.engine.onsoundstart = old.engine.onresult = old.engine.onerror = old.engine.onend = null;
      if (abort) try { old.engine.abort(); } catch (_) { /* Already ended. Never restart. */ }
    }
    voiceState(message);
  }
  // Review is local, transient, and never bypasses server-side note confirmation.
  function reviewSpeech(text, reason) {
    speechReview = text;
    if (dockCommand) dockCommand.textContent = 'Needs review: ' + text;
    voiceReply(reason + ' I heard: “' + text + '”. Say “use those words”, or repeat the full corrected sentence. Say “discard transcript” to discard it. Nothing has been sent.');
  }
  function acceptSpeech(text, uncertain) {
    if (/^(stop listening|pause voice|end voice session|stop voice session)[.!?]?$/i.test(text)) { pauseSession(); return; }
    if (uncertain) { reviewSpeech(text, 'Speech may be incomplete or misheard.'); return; }
    if (speechReview) {
      if (/^use those words[.!?]?$/i.test(text)) text = speechReview;
      else if (/^(discard transcript|no|cancel)[.!?]?$/i.test(text)) {
        speechReview = null; voiceReply('Transcript discarded. Please say the full request again.'); return;
      } else if (/^(yes|save(?: note)?|confirm(?: note)?)[.!?]?$/i.test(text)) {
        reviewSpeech(speechReview, 'Please check the transcript first.'); return;
      }
      speechReview = null;
    }
    input.value = text;
    void submit(true);
  }
  function startVoice() {
    syncSession();
    if (!voiceEnabled || !available() || !inVoiceContext() || document.hidden || recognition) return;
    if (!speechSupported()) { voiceState('Speech is unavailable in this browser. You can type your question.'); return; }
    // A new voice attempt supersedes any pending typed/voice answer.
    if (!handsFree) invalidate();
    const epoch = generation, ownSession = session;
    let turn;
    const active = () => {
      syncSession();
      return recognition === turn && epoch === generation && ownSession === session &&
        available() && inVoiceContext() && !document.hidden;
    };
    try {
      const engine = new (speechConstructor())();
      turn = {engine, stopping: false, finalText: '', draft: '', heardSound: false, uncertain: false, timedOut: false}; recognition = turn;
      engine.continuous = false; engine.interimResults = true; engine.maxAlternatives = 1; engine.lang = 'en-US';
      const finish = (message, ended = false, allowFinal = false) => {
        if (!active()) return;
        const finalText = turn.finalText, draft = turn.draft;
        cancelVoice('', !ended);
        if (handsFree && allowFinal && (finalText || draft)) {
          emptyAttempts = 0;
          acceptSpeech(finalText || draft, !finalText || turn.uncertain || turn.timedOut);
        } else if (allowFinal && finalText) {
          if (handsFree && /^(stop listening|pause voice|end voice session|stop voice session)[.!?]?$/i.test(finalText)) {
            pauseSession(); return;
          }
          emptyAttempts = 0;
          input.value = finalText;
          void submit(handsFree);
          if (!handsFree) voiceState('Speech received. You can edit the command and send again.');
        } else if (handsFree) {
          // Partial words remain untrusted. A repeat is safer than executing them.
          if (draft) input.value = draft;
          if (++emptyAttempts >= 3) {
            pauseSession('Stopped: the browser could not finalize speech after three attempts. Check Siri/Dictation and microphone permission, or type your command.');
          } else listenAgain((draft ? 'Words were not finalized. Please repeat after Microphone ready. ' : message + ' ') + 'Retry ' + emptyAttempts + ' of 2…');
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
        clearTimeout(turn.finalDisconnectTimer);
        const results = Array.from(event.results || []);
        const text = results.map(r => typeof r?.[0]?.transcript === 'string' ? r[0].transcript.trim() : '').filter(Boolean).join(' ');
        if (!text) { turn.draft = turn.finalText = ''; return; }
        if (text.length > 200) {
          turn.draft = turn.finalText = '';
          finish('Please say a command of 200 characters or fewer, or type your question.'); return;
        }
        // Interim words are a draft only: they must never trigger navigation/actions.
        turn.draft = text;
        if (dockCommand) dockCommand.textContent = 'Hearing: ' + text;
        // Some engines omit confidence or return zero as an unknown value.
        turn.uncertain = results.some(r => Number.isFinite(r?.[0]?.confidence) && r[0].confidence > 0 && r[0].confidence < 0.6);
        if(noteDictation && notePreview && !/^(?:save(?: note)?|confirm(?: note)?|yes|no|cancel|stop listening)[.!?]?$/i.test(text)){notePreview.hidden=false;notePreviewText.textContent=text;}
        if (results.length && results.every(r => r.isFinal === true)) {
          turn.finalText = text;
          // A final segment is not the end of the utterance. Wait for onend
          // for commands too, including a one-turn request to create a note.
          voiceState('Hearing: ' + text);
          if (!handsFree || /^(stop listening|pause voice|end voice session|stop voice session)[.!?]?$/i.test(text)) stopVoice();
          // Safari can finalize speech without promptly emitting onend. Allow
          // three quiet seconds for further segments, then request disconnect;
          // only the normal onend path may accept/submit this turn. Every result
          // cancels this fallback, and interim speech never arms it.
          else if (!turn.stopping) turn.finalDisconnectTimer = setTimeout(() => {
            if (active() && turn.finalText && !turn.stopping) stopVoice();
          }, 3000);
        } else { turn.finalText = ''; voiceState('Hearing: ' + text); }
      };
      engine.onerror = event => {
        if (!active()) return;
        clearTimeout(turn.finalDisconnectTimer);
        if (handsFree) {
          if (event.error === 'no-speech') {
            // Wait for onend before recycling the recognizer. If it never arrives,
            // stop rather than overlap two microphone owners.
            turn.finalText = '';
            clearTimeout(voiceTimer);
            voiceTimer = setTimeout(() => { if (active()) pauseSession('Speech service did not disconnect. Tap Start voice session to retry.', 'unavailable'); }, 5000);
            voiceState('The speech service returned no words. Waiting to retry…');
            return;
          }
          const denied = ['not-allowed', 'service-not-allowed'].includes(event.error);
          pauseSession(denied ? 'Permission denied — allow microphone and speech access, then start again. Typing remains available.' : 'Speech unavailable (' + event.error + '). Start again or type your command.', denied ? 'permission-denied' : 'unavailable');
          return;
        }
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
      // Watchdog bounds every attempt, even when Safari emits no terminal event.
      voiceTimer = setTimeout(() => { if (active()) { turn.timedOut = true; stopVoice(); } }, handsFree ? 30000 : 20000);
      engine.start();
    } catch (_) {
      if (handsFree) { pauseSession('Speech could not start. Check permission and tap Start voice session to retry.', 'unavailable'); return; }
      cancelVoice('Speech could not start. Check microphone permission, or type your question.');
    }
  }
  function stopVoice() {
    const turn = recognition;
    if (!turn || turn.stopping) return;
    clearTimeout(turn.finalDisconnectTimer);
    turn.stopping = true; voiceState('Finishing speech…');
    stopTimer = setTimeout(() => {
      if (recognition === turn && handsFree) { pauseSession('Speech did not disconnect. Tap Start voice session to retry.', 'unavailable'); return; }
      if (recognition === turn) turn.finish('The speech service did not finish. You can try again or type your question.', false, true);
    }, 5000);
    try { turn.engine.stop(); } catch (_) { turn.finish('Speech could not finish. You can type your question.'); }
  }
  const node = (tag, text) => { const n = document.createElement(tag); if (text) n.textContent = text; return n; };
  const authenticated = () => Boolean(token && currentUser?.id && token === localStorage.getItem('mudlog_token') && invalidSession !== identity());
  const available = () => enabled && authenticated();
  function invalidate() {
    endSession();
    if (dockCommand) dockCommand.textContent = dockReply.textContent = '';
    generation++; serial++; controller?.abort(); controller = null; pendingText = null;
    if (input) { input.value = ''; output.textContent = ''; retry.hidden = true; fallback.hidden = true; form.setAttribute('aria-busy', 'false'); send.disabled = false; }
  }
  function syncSession() {
    const next = identity();
    if (next !== session) { invalidate(); session = next; }
    if (entry) entry.hidden = !available();
    if (dock) { dock.hidden = !available(); sessionStart.disabled = handsFree || !available() || !speechSupported(); }
    if (form) { input.disabled = !available(); send.disabled = !available(); }
    if (!available()) { entered = false; if (page) page.classList.remove('active'); }
    if (talk) talk.disabled = handsFree || !available() || !speechSupported() || Boolean(recognition);
  }
  function sessionInvalid() {
    invalidate(); invalidSession = identity(); syncSession();
  }
  function onNavigate(destination, options = {}) {
    syncSession();
    if (internalNavigation || recordNavigation && options.searchDetail === true && location.hash === '#studioSearch/'+recordNavigation.type+'/'+encodeURIComponent(recordNavigation.id)) return;
    recordNavigation = false;
    if (handsFree && !pendingText) { speechReview = null; conversationToken = null; noteDictation = false; if(notePreview){notePreview.hidden=true;notePreviewText.textContent='';} return; }
    if (destination !== 'qlAssistant') { entered = false; invalidate(); }
  }
  function enter() {
    syncSession(); if (!available()) return;
    entered = true; if (!handsFree) input.focus();
  }
  async function submit(fromVoice = false) {
    syncSession();
    if (!available() || !inVoiceContext() || document.hidden) return;
    if (!fromVoice && handsFree) endSession();
    cancelVoice();
    const text = input.value.trim();
    if (!text || text.length > 200 || pendingText === text) return;
    controller?.abort(); controller = new AbortController();
    const abort = controller, requestId = 'web-' + (++serial), ownSerial = serial, epoch = generation;
    const account = currentUser.id, credential = token, ownSession = session;
    const active = () => {
      syncSession();
      return available() && inVoiceContext() && epoch === generation &&
        ownSerial === serial && ownSession === session && !abort.signal.aborted;
    };
    if (fromVoice) {
      dockCommand.textContent = 'Heard: ' + text;
      dockReply.textContent = '';
      sessionState('processing', 'Processing your request…');
      requestTimer = setTimeout(() => { if (active()) pauseSession('The assistant did not respond. Start again or use the menu.', 'unavailable'); }, 30000);
    }
    pendingText = text; output.textContent = 'Looking up your studio request…';
    retry.hidden = true; fallback.hidden = true; form.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(API + '/api/ql/assistant/turn', {
        method: 'POST', cache: 'no-store', signal: abort.signal,
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + credential},
        body: JSON.stringify({version: 1, requestId, input: {text}, context:{token:conversationToken}})
      });
      if (!active()) return;
      if (response.status === 401) { sessionInvalid(); return; }
      const data = await response.json();
      if (!active()) return;
      if (response.status === 400) { conversationToken = null; noteDictation = false; if(notePreview){notePreview.hidden=true;notePreviewText.textContent='';} }
      if (response.status === 400 && data.code === 'UNSUPPORTED_INTENT') {
        output.textContent = 'That question isn’t supported in this test version yet.';
      } else if (response.status === 400 && data.code === 'DESTINATION_UNAVAILABLE') {
        output.textContent = 'Kiln Share is not available in this website build. No page was opened.';
      } else if (response.status === 400 && data.code === 'ACTION_NOT_AVAILABLE') {
        output.textContent = 'That studio change is not available through this assistant yet. No changes were made. Use the existing forms.';
      } else {
        if (!response.ok || data.version !== 1 || data.requestId !== requestId ||
            data.accountId !== account || typeof data.response?.text !== 'string') throw Error('Unavailable');
        if (data.context !== undefined && (typeof data.context?.token !== 'string' || !/^[a-f0-9]{48}$/.test(data.context.token) || Object.keys(data.context).length !== 1)) throw Error('Invalid context');
        conversationToken = data.context?.token || null;
        noteDictation = data.result?.tool === 'studio.note' && ['collecting','draft','incomplete','material-review'].includes(data.result.status);
        if(notePreview){
          notePreview.hidden=!noteDictation;
          if(!noteDictation || data.result.status==='collecting')notePreviewText.textContent='';
          else if(typeof data.result.draftText==='string' && data.result.draftText.length<=10000)notePreviewText.textContent=data.result.draftText;
        }
        // The core owns all facts and wording, including empty/undated/tied records.
        output.textContent = data.response.text;
        fallback.hidden = !['studio.firing.latest','studio.firing.openLatest'].includes(data.intent?.name);
        if (data.response.navigation) {
          internalNavigation = true;
          try { followNavigation(data.response.navigation); if (!fromVoice) input.value = ''; } finally { internalNavigation = false; }
        }
      }
    } catch (_) {
      if (active()) {
        conversationToken = null; noteDictation = false;
        if(notePreview){notePreview.hidden=true;notePreviewText.textContent='';}
        fallback.hidden = true;
        output.textContent = 'The assistant is unavailable. Try again or use the menu to open a feature.';
        retry.hidden = false;
      }
    } finally {
      if (epoch === generation && ownSerial === serial && ownSession === session && !abort.signal.aborted && available()) { clearTimeout(requestTimer); pendingText = null; controller = null; form.setAttribute('aria-busy', 'false'); if (fromVoice && handsFree) voiceReply(output.textContent); }
    }
  }
  function followNavigation(target) {
    // Server output is still untrusted: never execute URLs, code, or arbitrary routes.
    const pages = ['pieces','clayBodies','glazes','chemicals','testTiles','firings',
      'pricingCalculator','sales','projects','contacts','events','studioSearch','visualSearch',
      'dashboard','casualties','community','shop','aiChat','myStore','shoppingList','goals',
      'studioNotes','communityMembers','findPotter','forum','reviews','blog','help','upgrade',
      'profile','notifications','messages'];
    const types = ['piece','clay','glaze','raw-material','test-tile','firing','pricing','sale','project','contact','event','all'];
    const keys = Object.keys(target).sort().join(',');
    if (target.kind === 'page' && keys === 'kind,page' && pages.includes(target.page)) {
      recordNavigation = false; navigate(target.page); return;
    }
    if (target.kind === 'record' && keys === 'id,kind,type' && ['firing','piece'].includes(target.type) &&
        typeof target.id === 'string' && target.id.length > 0 && target.id.length <= 200 && window.StudioSearch) {
      recordNavigation = {type:target.type,id:target.id};
      void window.StudioSearch.open(target.type,target.id); return;
    }
    if (target.kind === 'search' && keys === 'kind,query,type' && types.includes(target.type) &&
        typeof target.query === 'string' && target.query.trim().length >= 2 && target.query.length <= 120 &&
        !/[\x00-\x1f\x7f]/.test(target.query) && window.StudioSearch?.runQuery) {
      recordNavigation = false; window.StudioSearch.runQuery(target.query,target.type); return;
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
    fallback = node('button', 'Open Firings'); fallback.id = 'qlAssistantFiringFallback'; fallback.hidden = true; fallback.type = 'button'; fallback.className = 'btn btn-secondary';
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
      cancel.onclick = () => handsFree ? pauseSession('Listening canceled. You can type your question.') : cancelVoice('Listening canceled. You can type your question.');
      voiceStatus = node('p'); voiceStatus.id = 'qlAssistantVoiceStatus'; voiceStatus.setAttribute('role', 'status');
      voice.append(notice, talk, stop, cancel, voiceStatus); form.after(voice);
      voiceState(speechSupported() ? 'Ready when you tap.' : 'Speech is unavailable in this browser. You can type your question.');
      input.addEventListener('input', () => {
        if (handsFree) { const draft = input.value; invalidate(); input.value = draft; }
        else cancelVoice();
      });
    }
    if (handsFreeEnabled) {
      dock = node('aside'); dock.id = 'qlAssistantSession'; dock.setAttribute('aria-label', 'Voice session controls');
      const note = node('p', 'Recovery verification. Wait for Microphone ready. Say “stop listening” to end. Keep Safari visible.');
      sessionStart = node('button', 'Start voice session'); sessionStart.id = 'qlAssistantSessionStart';
      sessionStop = node('button', 'End session'); sessionStop.id = 'qlAssistantSessionStop';
      for (const b of [sessionStart, sessionStop]) { b.type = 'button'; b.className = 'btn btn-secondary'; }
      sessionStart.onclick = beginSession; sessionStop.onclick = () => pauseSession();
      const spokenLabel = node('label', ' Spoken replies (experimental) ');
      spokenReplies = node('input'); spokenReplies.type = 'checkbox'; spokenReplies.id = 'qlAssistantSpokenReplies';
      // Audio/recognition handoff is unreliable on some Safari versions. Opt in explicitly.
      spokenLabel.prepend(spokenReplies);
      spokenReplies.onchange = () => { if (handsFree) pauseSession('Reply preference changed. Start the session again.'); };
      dockStatus = node('p'); dockStatus.id = 'qlAssistantSessionStatus'; dockStatus.setAttribute('role', 'status');
      dockCommand = node('p'); dockCommand.id = 'qlAssistantSessionCommand'; dockCommand.style.whiteSpace = 'pre-wrap'; dockCommand.setAttribute('aria-label', 'Live speech transcript');
      dockReply = node('p'); dockReply.id = 'qlAssistantSessionReply'; dockReply.setAttribute('role', 'status'); dockReply.setAttribute('aria-live', 'polite');
      notePreview=node('section');notePreview.id='qlAssistantNotePreview';notePreview.hidden=true;
      const previewLabel=node('strong','Live note draft — not saved');
      notePreviewText=node('p');notePreviewText.id='qlAssistantNotePreviewText';notePreviewText.style.whiteSpace='pre-wrap';
      notePreview.append(previewLabel,notePreviewText);
      dock.append(dockCommand, notePreview, dockReply, dockStatus, sessionStart, sessionStop, spokenLabel, note); document.body.append(dock);
      const css = node('style'); css.textContent = '#qlAssistantSession{position:fixed;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));z-index:10001;margin:auto;max-width:620px;padding:12px;background:#fff;color:#252525;border:2px solid #654536;border-radius:12px;box-shadow:0 4px 20px #0003;max-height:35vh;overflow:auto;font-size:15px}#qlAssistantSession p{margin:4px 0 8px}#qlAssistantSession button{min-height:44px;margin:0 8px 4px 0}#qlAssistantSession[data-state="listening"]{border-color:#24734a}';
      document.head.append(css);
      sessionState(speechSupported() ? 'stopped' : 'unavailable', speechSupported() ? 'Stopped — ready when you start.' : 'Voice unavailable. Typing and the menu remain available.');
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
    .then(config => { if (config?.enabled === true) { enabled = true; voiceEnabled = config.voiceEnabled === true; handsFreeEnabled = voiceEnabled && config.handsFreeEnabled === true; mount(); } })
    .catch(() => {});
})();
