/* Presentation and member preference only. The existing assistant owns all speech. */
(() => {
  'use strict';
  const names = {bag:'Bag of Clay', bowl:'Studio Bowl', buddy:'Pottery Buddy', pebble:'Studio Pebble', moon:'Moon & Stars', microphone:'Microphone'};
  const assets = window.ClaytonAvatarAssets;
  if (!assets) return;
  const valid = id => Object.prototype.hasOwnProperty.call(names, id);
  window.ClaytonAvatars = {mount(host, controls) {
    const panel = document.createElement('section'); panel.className = 'clayton-avatars';
    panel.setAttribute('aria-label', 'Clayton avatar and voice');
    const stage = document.createElement('div'); stage.className = 'clayton-stage'; stage.dataset.state = 'idle';
    const img = document.createElement('img'); img.src = assets.bag; img.alt = names.bag; img.width = 285; img.height = 208;
    stage.append(img);
    const status = document.createElement('p'); status.className = 'clayton-status'; status.setAttribute('role', 'status'); status.textContent = 'Idle';
    const choices = document.createElement('div'); choices.className = 'clayton-choices';
    const saved = document.createElement('p'); saved.className = 'clayton-save'; saved.setAttribute('role', 'status');
    let selected = 'bag', account = null, revision = 0, queue = Promise.resolve();
    function render(id) {
      selected = valid(id) ? id : 'bag'; img.src = assets[selected]; img.alt = names[selected];
      for (const b of choices.children) b.setAttribute('aria-pressed', String(b.dataset.avatar === selected));
    }
    function state(value) {
      if (!['idle','listening','thinking','speaking','success','error'].includes(value)) return;
      stage.dataset.state = value; status.textContent = value.charAt(0).toUpperCase() + value.slice(1);
    }
    async function request(owner, method = 'GET', avatar) {
      const response = await fetch(controls.api + '/api/ql/assistant/preferences', {method, cache:'no-store',
        headers:{Authorization:'Bearer ' + owner.token, ...(method === 'PUT' ? {'Content-Type':'application/json'} : {})},
        ...(method === 'PUT' ? {body:JSON.stringify({avatar})} : {})});
      if (!response.ok) throw Error('Preference unavailable');
      return response.json();
    }
    function select(id) {
      if (!valid(id)) return;
      render(id); const own = account, version = ++revision;
      if (!own) return;
      saved.textContent = 'Saving selection…';
      // Ordered writes ensure a quick series of taps persists the final selection.
      queue = queue.catch(() => {}).then(async () => {
        if (account !== own) return;
        try {
          await request(own, 'PUT', id);
          if (account === own && revision === version) saved.textContent = 'Saved to your account.';
        } catch (_) {
          if (account === own && revision === version) saved.textContent = 'Could not save. Tap your character again to retry.';
        }
      });
    }
    for (const [id, name] of Object.entries(names)) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.avatar = id;
      b.setAttribute('aria-label', 'Select ' + name);
      const thumb = document.createElement('img'); thumb.src = assets[id]; thumb.alt = ''; thumb.width = 285; thumb.height = 208;
      const label = document.createElement('span'); label.textContent = name;
      b.append(thumb, label); b.onclick = () => select(id); choices.append(b);
    }
    const actions = document.createElement('div'); actions.className = 'clayton-actions';
    for (const [id, label, action] of [['start','Start Listening',controls.start],['stop','Stop',controls.stop],['hear','Hear Clayton',controls.hear]]) {
      const b = document.createElement('button'); b.id = 'clayton-' + id; b.type = 'button'; b.className = 'btn btn-secondary'; b.textContent = label; b.onclick = action; actions.append(b);
    }
    const feedback = document.createElement('p'); feedback.id = 'clayton-feedback'; feedback.setAttribute('role', 'status');
    panel.append(stage, status, choices, saved, actions, feedback); host.append(panel); render('bag');
    const events = {ready:'idle',listening:'listening',processing:'thinking',replyStarted:'speaking',replyFinished:'idle',noteSaved:'success',noteUpdated:'success',noteDeleted:'success',cancelled:'idle',failed:'error',speechAborted:'error',speechUnavailable:'error',stopped:'idle'};
    for (const [event, value] of Object.entries(events)) window.addEventListener('clayton:' + event, () => state(value));
    return {feedback(message) {feedback.textContent = message;}, sync() {
      const next = controls.account();
      if (account?.id === next?.id && account?.token === next?.token) return;
      account = next; const own = account, version = ++revision;
      render('bag'); state('idle'); saved.textContent = ''; feedback.textContent = '';
      if (!own) return;
      request(own).then(data => { if (account === own && revision === version) render(data.avatar); })
        .catch(() => {if (account === own && revision === version) saved.textContent = 'Saved selection could not load. Choose a character to retry.';});
    }};
  }};
})();
