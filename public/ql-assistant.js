/* Bounded QL proof. Speech is transient input to the same typed turn path. */
(() => {
  'use strict';
  const displayName = 'QL assistant — testing recovery';
  const interactionModeKey = 'ql_assistant_interaction_mode';
  const interactionMode = () => localStorage[interactionModeKey] === 'manual' ? 'manual' : 'handsfree';
  const identity = () => JSON.stringify([token, currentUser?.id, localStorage.getItem('mudlog_token')]);
  let conversationToken = null, recordNavigation = false, noteDictation = false;
  let session = identity(), invalidSession = null, generation = 0, serial = 0;
  let controller, pendingText = null, enabled = false, entered = false;
  let page, entry, input, form, send, retry, output, fallback;
  let voiceEnabled = false, recognition = null, voiceTimer, stopTimer;
  let talk, stop, cancel, voiceStatus;
  let handsFreeEnabled = false, handsFree = false, sessionTimer, restartTimer, speechTimer, speechProbeTimer, requestTimer;
  let dock, dockStatus, dockCommand, dockReply, sessionStart, sessionStop, spokenReplies, utterance, notePreview, notePreviewText;
  let speechReview = null, speechSuggestion = null, quietDraftReply = null, speechBurst = '', speechBurstTimer = null;
  let emptyAttempts = 0, voiceEpoch = 0, internalNavigation = false, autoStartTimer = null, foregroundVoiceActivated = false, speechAudioUnlocked = false;
  let interruptionAttempts = 0, recoveryPaused = false, restartSequence = 0;
  const inVoiceContext = () => entered && (currentPage === 'qlAssistant' || handsFree);
  function sessionState(state, message) {
    if (!dock) return;
    dock.dataset.state = state;
    dockStatus.textContent = message;
    sessionStart.disabled = handsFree || !available() || !speechSupported() || interactionMode() !== 'handsfree';
    sessionStop.hidden = !handsFree;
  }
  function endSession(message = 'Stopped — tap Start voice session to resume.', state = 'stopped', preserveContext = false) {
    quietDraftReply = null;
    handsFree = false; voiceEpoch++; restartSequence++; recoveryPaused = preserveContext;
    if (!preserveContext) {
      speechReview = speechSuggestion = null;
      conversationToken = null; noteDictation = false; recordNavigation = false;
      if(notePreview){notePreview.hidden=true;notePreviewText.textContent='';}
    }
    clearTimeout(restartTimer); clearTimeout(sessionTimer); clearTimeout(speechBurstTimer); speechBurst = ''; clearTimeout(speechTimer); clearTimeout(speechProbeTimer); clearTimeout(requestTimer); clearTimeout(autoStartTimer);
    if (utterance) { utterance.onend = utterance.onerror = utterance.onstart = null; utterance = null; window.speechSynthesis?.cancel(); }
    cancelVoice();
    sessionState(state, message);
  }
  function pauseSession(message = 'Stopped — tap Start voice session to resume.', state = 'stopped') {
    foregroundVoiceActivated = false;
    invalidate();
    sessionState(state, message);
  }
  function stopRecovery(message) {
    // Keep server conversation/draft and local clarification state for an explicit
    // retry. Do not call invalidate(), which discards that context.
    foregroundVoiceActivated = false;
    endSession(message + ' Your note context is retained. Tap Start voice session to retry or type.', 'unavailable', true);
  }
  function listenAgain(message = 'Preparing microphone for your next command…') {
    if (!handsFree) return;
    const own = voiceEpoch;
    const restartId = ++restartSequence;
    sessionState('starting', message);
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      syncSession();
      if (restartId !== restartSequence) return;
      restartSequence++;
      if (handsFree && own === voiceEpoch && available() && !document.hidden) startVoice();
    }, 650);
  }
  // A draft is already safe on the server. Reopen the mic before acknowledging
  // it so a breathing pause can continue the same draft without a TTS interruption.
  function acknowledgeDraftWhenQuiet(text) {
    quietDraftReply = text;
    listenAgain('Keep going, or say save draft when you are ready.');
    clearTimeout(speechBurstTimer);
    speechBurstTimer = setTimeout(() => {
      if (!handsFree || quietDraftReply !== text) return;
      if (recognition) {
        recognition.quietReply = text;
        stopVoice(); // onend must release the microphone before any speech.
      } else { quietDraftReply = null; voiceReply(text); }
    }, 3000);
  }
  function voiceReply(text) {
    if (!handsFree) return;
    cancelVoice();
    restartSequence++;
    clearTimeout(restartTimer);
    dockReply.textContent = text;
    sessionState('responding', 'Response ready.');
    if (!spokenReplies.checked) { listenAgain('Ready for another command…'); return; }
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      dockReply.textContent = text;
      listenAgain('Spoken audio is unavailable on this device. Clayton will keep listening and show replies on screen.'); return;
    }
    const own = voiceEpoch, synth = window.speechSynthesis;
    const spokenText=conciseSpeech(text); const speech = new window.SpeechSynthesisUtterance(spokenText.slice(0, 300)); utterance = speech;
    let finished = false, observedSpeaking = false, quietChecks = 0;
    speech.lang = 'en-US';
    const voices=synth.getVoices?.() || [];
    const preferred=voices.find(v=>/Samantha|Ava|Siri|Evan|Zoe/i.test(v.name) && /^en(?:-|$)/i.test(v.lang)) || voices.find(v=>/^en-US$/i.test(v.lang) && v.localService) || voices.find(v=>/^en(?:-|$)/i.test(v.lang));
    if(preferred) speech.voice=preferred;
    speech.rate=0.96; speech.pitch=1.02;
    const active = () => handsFree && own === voiceEpoch && utterance === speech;
    const completeSpeech = (forceRelease = false) => {
      if (!active() || finished) return;
      finished = true;
      clearTimeout(speechTimer); clearTimeout(speechProbeTimer);
      speech.onstart = speech.onend = speech.onerror = null;
      utterance = null;
      if (forceRelease) try { synth.cancel(); } catch (_) { /* Best-effort Safari audio-session release. */ }
      listenAgain();
    };
    const probeSpeech = () => {
      if (!active() || finished) return;
      const speaking = synth.speaking === true, pending = synth.pending === true;
      if (speaking) {
        observedSpeaking = true; quietChecks = 0;
        sessionState('speaking', 'Speaking — microphone is off.');
      } else if (!pending) {
        quietChecks++;
        // iPhone Safari can finish TTS without dispatching SpeechSynthesisUtterance.onend.
        // Once speech was observed and is now idle, or the utterance never starts at
        // all for roughly 1.5 seconds, release synthesis and resume recognition.
        if (observedSpeaking || quietChecks >= 6) { completeSpeech(true); return; }
      }
      speechProbeTimer = setTimeout(probeSpeech, 250);
    };
    speech.onstart = () => { if (active()) { observedSpeaking = true; quietChecks = 0; sessionState('speaking', 'Speaking — microphone is off.'); } };
    speech.onend = () => completeSpeech(false);
    speech.onerror = () => completeSpeech(true);
    speechTimer = setTimeout(() => completeSpeech(true), 30000);
    speechProbeTimer = setTimeout(probeSpeech, 250);
    try { synth.speak(speech); } catch (_) { speech.onerror(); }
  }
  function beginSession() {
    syncSession();
    // iPhone Safari may expose speechSynthesis but suppress later asynchronous
    // utterances unless audio was primed by the user's activation gesture.
    if (window.speechSynthesis && window.SpeechSynthesisUtterance && !speechAudioUnlocked) {
      try {
        const primer = new window.SpeechSynthesisUtterance(''); primer.volume = 0;
        window.speechSynthesis.cancel(); window.speechSynthesis.speak(primer);
        speechAudioUnlocked = true;
      } catch (_) { /* Visible replies remain the safe fallback. */ }
    }
    if (!handsFreeEnabled || interactionMode() !== 'handsfree' || !available() || document.hidden || handsFree) return;
    if (!speechSupported()) { sessionState('unavailable', 'Voice unavailable. Typing and the menu remain available.'); return; }
    if (!recoveryPaused) invalidate();
    recoveryPaused = false; interruptionAttempts = 0;
    handsFree = true; entered = true; emptyAttempts = 0; foregroundVoiceActivated = true;
    // Hands-Free lasts for the foreground Mud Room session. Page/account teardown
    // owns shutdown; there is no arbitrary 15-minute assistant timeout.
    startVoice();
  }
  function autoStartHandsFree(message = 'Starting Hands-Free Clayton…') {
    clearTimeout(autoStartTimer);
    if (!handsFreeEnabled || interactionMode() !== 'handsfree' || !available() || document.hidden || handsFree || recognition) return;
    if (!foregroundVoiceActivated) {
      sessionState('ready', 'Hands-Free is selected. Tap once to activate Clayton for this app session.');
      if (sessionStart) { sessionStart.hidden = false; sessionStart.textContent = 'Activate Clayton'; }
      return;
    }
    sessionState('starting', message);
    autoStartTimer = setTimeout(() => {
      syncSession();
      if (handsFreeEnabled && interactionMode() === 'handsfree' && available() && !document.hidden && !handsFree && !recognition) beginSession();
    }, 250);
  }
  const speechConstructor = () => window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechSupported = () => window.isSecureContext === true && typeof speechConstructor() === 'function';
  function voiceState(message = '') {
    if (!talk) return;
    talk.hidden = interactionMode() !== 'manual' || !speechSupported();
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
  function reviewSpeech(text, reason, suggestion = null) {
    speechReview = text; speechSuggestion = suggestion;
    if (dockCommand) dockCommand.textContent = 'Needs review: ' + text;
    if (suggestion) { voiceReply(reason + ' Say “use corrected words”, “keep original words”, or repeat the sentence.'); return; }
    voiceReply(reason + ' I heard: “' + text + '”. Say “use those words”, or repeat the full corrected sentence. Say “discard transcript” to discard it. Nothing has been sent.');
  }
  function conciseSpeech(text) {
    const t=(text || '').trim();
    if(/Did you mean “B-Mix clay”/.test(t))return 'Did you mean “B-Mix clay”? Say yes, or keep original words.';
    if(/^What would you like the note to say/i.test(t)) return 'What would you like the note to say?';
    if(/^Speech may be incomplete or misheard/.test(t)) return 'Could you repeat that sentence? I’m not sure I heard it correctly.';
    if(/^Saved your Studio Note:/i.test(t)) return 'Done. I saved the note.';
    if(/^Updated your Studio Note:/i.test(t)) return 'Done. I updated the note.';
    if(/^Updated note preview:/i.test(t)) return 'Got it. I updated the draft.';
    if(/^Draft studio note:/i.test(t)) return 'Got it. I have the draft.';
    if(/^Opening\b/i.test(t)) return t.split(/[.!?]/)[0]+'.';
    if(/isn[’']t supported|not available through this assistant/i.test(t)) return 'I can’t do that yet.';
    return t.length>180 ? t.split(/(?<=[.!?])\s+/)[0] : t;
  }
  // Classification only: the server owns command interpretation and note text.
  function isNoteControl(text) {
    return /^(?:(?:hey|hi|okay|ok)[, ]+)?(?:clayton[, ]+)?(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:save|safe draft|confirm|cancel|discard|edit|change|correct|replace|remove|delete|add|insert|i (?:said|meant)|no|yes|stop|shut up|on (?:the )?(?:live )?(?:note|draft)|in (?:the )?(?:note|draft))\b/i.test(text.trim());
  }
  function normalizeSpeech(text) {
    // Do not rewrite literal edit anchors or command text. Ordinary dictation
    // stays byte-for-byte unless an explicit pottery phrase supplies context.
    if (isNoteControl(text)) return {text};
    // Keep the accepted server-side clay clarification in charge of its draft.
    if (/\b(?:bmx|v[ -]?mix|b[ -]?mixed|bm\s+mix|the\s+mix|bee\s+mix)\s+clay\b/i.test(text)) return {text};
    const numbers = {one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',ten:'10'};
    let normalized = text.replace(/\bb[ -]?mix(?=\s+clay\b)/gi, 'B-Mix');
    if (/\b(?:clay|glaze|fire|firing|kiln|bisque|ceramic)\b/i.test(text) || /^cone\s+/i.test(text)) normalized = normalized
      .replace(/\bcone\s+(zero|oh|o)\s+(one|two|three|four|five|six|seven|eight|nine)\b/gi, (_, zero, n) => 'cone 0' + numbers[n.toLowerCase()])
      .replace(/\bcone\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (_, n) => 'cone ' + numbers[n.toLowerCase()]);
    // These are plausible mishearings, not safe substitutions. The member must
    // choose the proposal; saving cannot implicitly approve it.
    const suggestion = normalized
      .replace(/\bsoy (?:subs|saucer) dishes\b/gi, 'soy sauce dishes')
      .replace(/\bsapphire (?:flow glaze|float blaze)\b/gi, 'Sapphire Float glaze');
    return {text:normalized, suggestion:suggestion !== normalized ? suggestion : null};
  }
  function acceptSpeech(text, uncertain) {
    if (/^(stop listening|pause voice|end voice session|stop voice session)[.!?]?$/i.test(text)) { pauseSession(); return; }
    if (uncertain) { reviewSpeech(text, 'Speech may be incomplete or misheard.'); return; }
    if (speechReview) {
      if (speechSuggestion && /^(?:yes|yes please|use (?:the )?corrected words)[.!?]?$/i.test(text)) text = speechSuggestion;
      else if (/^(?:use those words|keep (?:the )?original words)[.!?]?$/i.test(text)) text = speechReview;
      else if (/^(discard transcript|no|cancel)[.!?]?$/i.test(text)) {
        speechReview = speechSuggestion = null; voiceReply('Transcript discarded. Please say the full request again.'); return;
      } else if (/^(yes|save(?: (?:my |the )?(?:note|draft))?|confirm(?: (?:note|draft))?)[.!?]?$/i.test(text)) {
        reviewSpeech(speechReview, 'Please check the transcript first.', speechSuggestion); return;
      }
      speechReview = speechSuggestion = null;
      input.value = text; void submit(true); return;
    }
    const pottery = normalizeSpeech(text);
    if (pottery.suggestion) { reviewSpeech(text, 'Did you mean “' + pottery.suggestion + '”?', pottery.suggestion); return; }
    text = pottery.text;
    input.value = text;
    void submit(true);
  }
  function startVoice() {
    syncSession();
    if (!voiceEnabled || !available() || !inVoiceContext() || document.hidden || recognition || utterance || (handsFree && pendingText)) return;
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
      turn = {engine, stopping: false, finalText: '', draft: '', committedFinal: '', heardSound: false, uncertain: false, timedOut: false}; recognition = turn;
      engine.continuous = false; engine.interimResults = true; engine.maxAlternatives = 1; engine.lang = 'en-US';
      const finish = (message, ended = false, allowFinal = false) => {
        if (!active()) return;
        const finalText = turn.finalText, draft = turn.draft;
        const quietReply = turn.quietReply;
        cancelVoice('', !ended);
        if (handsFree && quietReply && !finalText && !draft) {
          quietDraftReply = null;
          if (ended) voiceReply(quietReply);
          else pauseSession('Microphone did not disconnect. Tap Start voice session to retry.', 'unavailable');
          return;
        }
        if (handsFree && allowFinal && (finalText || draft)) {
          emptyAttempts = 0;
          acceptSpeech((finalText || draft).trim(), !finalText || turn.uncertain || turn.timedOut);
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
      engine.onstart = () => { if (active() && !turn.interrupted) voiceState(turn.stopping ? 'Finishing speech…' : 'Listening — speak now. Tap Stop when finished.'); };
      engine.onaudiostart = () => { if (active() && !turn.stopping && !turn.interrupted) voiceState('Microphone ready — speak now. Tap Stop when finished.'); };
      engine.onsoundstart = () => { if (active() && !turn.interrupted) { turn.heardSound = true; clearTimeout(speechBurstTimer); quietDraftReply = null; turn.quietReply = null; voiceState('Sound detected. Listening for your words…'); } };
      engine.onresult = event => {
        if (!active() || turn.interrupted) return;
        clearTimeout(turn.finalDisconnectTimer);
        const results = Array.from(event.results || []);
        const eventText = results.map(r => typeof r?.[0]?.transcript === 'string' ? r[0].transcript.trim() : '').filter(Boolean).join(' ');
        if (!eventText) return;
        clearTimeout(speechBurstTimer); quietDraftReply = null; turn.quietReply = null;
        const allFinal = results.length && results.every(r => r.isFinal === true);
        if (allFinal) {
          const previous = turn.committedFinal, priorDraft = turn.draft;
          // iPhone Safari can show the complete utterance as interim text, then
          // replace it with only the final tail. When that tail is an exact
          // suffix of the same in-progress utterance, keep the longer transcript
          // instead of discarding the already-heard beginning/middle.
          const compact = s => (s || '').trim().replace(/\s+/g, ' ');
          const priorCompact = compact(priorDraft), eventCompact = compact(eventText), previousCompact = compact(previous);
          const carriesPriorDraft = priorCompact.length > eventCompact.length &&
            priorCompact.toLowerCase().endsWith(eventCompact.toLowerCase()) &&
            (!previousCompact || priorCompact.toLowerCase().startsWith(previousCompact.toLowerCase()));
          const finalizedText = carriesPriorDraft ? priorDraft : eventText;
          if (!previous) turn.committedFinal = finalizedText;
          else if (finalizedText === previous || finalizedText.startsWith(previous + ' ')) turn.committedFinal = finalizedText;
          else if (previous === finalizedText || previous.startsWith(finalizedText + ' ') || previous.endsWith(' ' + finalizedText)) { /* stale/replayed final */ }
          else turn.committedFinal = (previous + ' ' + finalizedText).trim();
        }
        const text = allFinal
          ? turn.committedFinal
          : (turn.committedFinal && !eventText.startsWith(turn.committedFinal)
              ? (turn.committedFinal + ' ' + eventText).trim()
              : eventText);
        if (text.length > 200) {
          turn.draft = turn.finalText = turn.committedFinal = '';
          finish('Please say a command of 200 characters or fewer, or type your question.'); return;
        }
        // Safari can emit a later result event containing only the tail of the same
        // utterance. Keep already-finalized words instead of replacing them.
        turn.draft = text;
        if (dockCommand) dockCommand.textContent = 'Hearing: ' + text;
        // Some engines omit confidence or return zero as an unknown value.
        turn.uncertain = (allFinal ? turn.finalUncertain === true : turn.uncertain) || results.some(r => Number.isFinite(r?.[0]?.confidence) && r[0].confidence > 0 && r[0].confidence < 0.6);
        if (allFinal) turn.finalUncertain = turn.uncertain;
        if(noteDictation && notePreview && !isNoteControl(text)){notePreview.hidden=false;notePreviewText.textContent=text;}
        if (allFinal) {
          turn.finalText = turn.committedFinal;
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
          if (event.error === 'aborted' || event.error === 'network') {
            if (turn.interrupted) return;
            turn.interrupted = true;
            clearTimeout(voiceTimer); clearTimeout(stopTimer);
            clearTimeout(speechBurstTimer); quietDraftReply = null; turn.quietReply = null;
            // onerror is not a disconnect acknowledgement. Keep this engine as
            // the sole microphone owner until onend; never restart from onerror.
            sessionState('recovering', 'Speech interrupted — waiting for microphone disconnect…');
            voiceTimer = setTimeout(() => {
              if (active()) stopRecovery('Microphone did not disconnect. Listening is stopped.');
            }, 5000);
            return;
          }
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
      engine.onend = () => {
        if (!active()) return;
        if (turn.interrupted) {
          const partial = turn.finalText || turn.draft;
          cancelVoice('', false);
          if (partial) { input.value = partial; dockCommand.textContent = 'Interrupted, not sent: ' + partial; }
          if (++interruptionAttempts > 2) {
            stopRecovery('Speech recovery failed after two retries. Listening is stopped.');
          } else {
            listenAgain('Recovering microphone — retry ' + interruptionAttempts + ' of 2. ' + (partial ? 'Please repeat the interrupted words when ready.' : 'Your conversation is retained.'));
          }
          return;
        }
        // Reset only after a successful speech turn, not onstart: an engine
        // repeatedly starting and aborting must still exhaust the retry budget.
        if (turn.finalText) interruptionAttempts = 0;
        finish(turn.heardSound
        ? 'Sound was detected, but the speech service returned no words. You can retry or type your question.'
        : 'No speech text was returned by the browser. Wait for “Microphone ready” before speaking, or type your question.', true, true);
      };
      voiceState('Starting microphone… Wait for “Microphone ready” before speaking.');
      // Watchdog bounds every attempt, even when Safari emits no terminal event.
      voiceTimer = setTimeout(() => { if (active()) { turn.timedOut = true; stopVoice(); } }, handsFree ? 30000 : 20000);
      engine.start();
    } catch (_) {
      if (handsFree) { stopRecovery('Speech could not start. Listening is stopped. Check microphone permission.'); return; }
      cancelVoice('Speech could not start. Check microphone permission, or type your question.');
    }
  }
  function stopVoice() {
    const turn = recognition;
    if (!turn || turn.stopping || turn.interrupted) return;
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
    if (dock) { dock.hidden = !available() || interactionMode() !== 'handsfree'; sessionStart.hidden = interactionMode() === 'handsfree' && foregroundVoiceActivated; sessionStart.disabled = handsFree || !available() || !speechSupported() || interactionMode() !== 'handsfree'; }
    if (form) { input.disabled = !available(); send.disabled = !available(); }
    if (!available()) { entered = false; if (page) page.classList.remove('active'); }
    if (talk) talk.disabled = handsFree || !available() || !speechSupported() || Boolean(recognition);
    if (spokenReplies) { spokenReplies.checked = interactionMode() === 'handsfree' ? true : spokenReplies.checked; spokenReplies.disabled = interactionMode() === 'handsfree'; }
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
    let quietAcknowledgement = false;
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
        quietAcknowledgement = fromVoice && spokenReplies.checked && !isNoteControl(text) && data.result?.tool === 'studio.note' && data.result.status === 'draft';
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
      if (epoch === generation && ownSerial === serial && ownSession === session && !abort.signal.aborted && available()) { clearTimeout(requestTimer); pendingText = null; controller = null; form.setAttribute('aria-busy', 'false'); if (fromVoice && handsFree) { if (quietAcknowledgement) acknowledgeDraftWhenQuiet(output.textContent); else voiceReply(output.textContent); } }
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
      sessionStart.onclick = beginSession; sessionStop.onclick = () => { foregroundVoiceActivated = false; pauseSession(); syncSession(); };
      const spokenLabel = node('label', ' Clayton talks back ');
      spokenReplies = node('input'); spokenReplies.type = 'checkbox'; spokenReplies.id = 'qlAssistantSpokenReplies';
      spokenReplies.checked = interactionMode() === 'handsfree';
      spokenReplies.disabled = interactionMode() === 'handsfree';
      spokenLabel.prepend(spokenReplies);
      spokenReplies.onchange = () => { if (handsFree) pauseSession('Reply preference changed.'); };
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
  function setInteractionMode(mode) {
    if (!['handsfree','manual'].includes(mode)) return false;
    if (handsFree || recognition) endSession('Interaction mode changed. Start again when ready.');
    localStorage[interactionModeKey] = mode;
    const select = document.getElementById('profileAssistantMode');
    if (select) select.value = mode;
    syncSession();
    voiceState(mode === 'manual' ? (speechSupported() ? 'Ready when you tap.' : 'Speech is unavailable in this browser. You can type your question.') : '');
    if (mode === 'handsfree') autoStartHandsFree();
    return true;
  }
  const modeSelect = document.getElementById('profileAssistantMode');
  if (modeSelect) {
    modeSelect.value = interactionMode();
    modeSelect.addEventListener('change', () => setInteractionMode(modeSelect.value));
  }
  window.QLAssistant = {invalidate, syncSession, sessionInvalid, available, onNavigate, enter, setInteractionMode, interactionMode};
  window.addEventListener('storage', e => {
    if (e.key === 'mudlog_token' || e.key === interactionModeKey || e.key == null) { if (e.key === interactionModeKey && handsFree) endSession('Interaction mode changed on this device.'); else if (e.key !== interactionModeKey) invalidate(); syncSession(); const select=document.getElementById('profileAssistantMode'); if(select) select.value=interactionMode(); }
  });
  for (const event of ['hashchange', 'popstate']) window.addEventListener(event, () => onNavigate(location.hash.slice(1).split('?')[0]));
  window.addEventListener('pagehide', () => { foregroundVoiceActivated = false; entered = false; invalidate(); syncSession(); });
  // A visible page can lose focus to browser controls/permission UI. Only actual
  // hiding, pagehide, navigation, or account changes cancel foreground speech.
  window.addEventListener('pageshow', () => { syncSession(); if (available() && currentPage === 'qlAssistant') entered = true; autoStartHandsFree('Resuming Hands-Free Clayton…'); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) invalidate();
    syncSession();
    if (!document.hidden) autoStartHandsFree('Resuming Hands-Free Clayton…');
  });
  // Failed/missing configuration is OFF. No HTML entry exists until explicit opt-in.
  fetch(API + '/api/ql/assistant/config', {cache: 'no-store'})
    .then(r => r.ok ? r.json() : null)
    .then(config => { if (config?.enabled === true) { enabled = true; voiceEnabled = config.voiceEnabled === true; handsFreeEnabled = voiceEnabled && config.handsFreeEnabled === true; mount(); autoStartHandsFree(); } })
    .catch(() => {});
})();
