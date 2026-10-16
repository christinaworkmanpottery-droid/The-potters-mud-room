/* Voice choices use the device's actual installed voices, independently of avatar. */
(() => {
  'use strict';
  const defaults=()=>({style:'masculine',voiceURI:'',rate:0.96});
  let prefs=defaults(),owner=null,revision=0,queue=Promise.resolve(),panel,style,voice,rate,status;
  const voices=()=>window.speechSynthesis?.getVoices?.() || [];
  function render() {
    if(!panel)return;
    style.value=prefs.style;rate.value=prefs.rate;
    voice.replaceChildren(new Option('Device default',''));
    for(const v of voices())voice.append(new Option(v.name+' · '+v.lang,v.voiceURI));
    if(prefs.voiceURI && !voices().some(v=>v.voiceURI===prefs.voiceURI))voice.append(new Option('Saved voice unavailable on this device',prefs.voiceURI));
    voice.value=prefs.voiceURI;
  }
  function invalidate(){owner=null;revision++;prefs=defaults();render();if(status)status.textContent='';}
  async function request(account,method,body){
    const r=await fetch(API+'/api/ql/voice/preferences',{method,cache:'no-store',headers:{Authorization:'Bearer '+account.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!r.ok)throw Error('Voice settings unavailable');return r.json();
  }
  function sync(){
    if(!token || !currentUser?.id){invalidate();return;}
    if(owner?.token===token && owner.id===currentUser.id)return;
    invalidate();owner={token,id:currentUser.id};const account=owner,version=revision;
    request(account,'GET').then(data=>{if(owner===account && revision===version){prefs={...defaults(),...data};render();}}).catch(()=>{if(owner===account && status)status.textContent='Saved voice settings could not load. Change a setting to retry.';});
  }
  function save(){
    sync();if(!owner)return;
    prefs={style:style.value,voiceURI:voice.value,rate:Number(rate.value)};
    const account=owner,version=++revision,body={...prefs};status.textContent='Saving…';
    queue=queue.catch(()=>{}).then(async()=>{
      if(owner!==account)return;
      try{await request(account,'PUT',body);if(owner===account && revision===version)status.textContent='Saved. Preview to hear your choice.';}
      catch(_){if(owner===account && revision===version)status.textContent='Could not save. Change a setting to retry.';}
    });
  }
  function mount(host,preview){
    panel=document.createElement('details');panel.className='ql-voice-settings card';
    const summary=document.createElement('summary');summary.textContent='Voice and speaking speed';panel.append(summary);
    function field(title,id,options){const label=document.createElement('label');label.htmlFor=id;label.textContent=title;const el=document.createElement('select');el.id=id;el.className='form-input';for(const [value,text]of options)el.append(new Option(text,value));panel.append(label,el);el.onchange=save;return el;}
    style=field('Preferred voice style','ql-voice-style',[['masculine','Masculine-sounding'],['feminine','Feminine-sounding'],['neutral','Gender-neutral-sounding']]);
    voice=field('Voice available on this device','ql-voice-choice',[]);
    rate=field('Speaking speed','ql-voice-rate',[[0.6,'Slower · 0.6×'],[0.8,'Relaxed · 0.8×'],[0.96,'Natural · 0.96×'],[1.1,'Brisk · 1.1×'],[1.4,'Fast · 1.4×']]);
    const help=document.createElement('p');help.textContent='Choose and preview a device voice for your preferred style. Available voices vary by device; the browser does not label gender. Your style preference does not change the sound by itself.';
    const button=document.createElement('button');button.type='button';button.className='btn btn-secondary';button.textContent='Preview voice';button.onclick=preview;
    status=document.createElement('p');status.setAttribute('role','status');panel.append(help,button,status);host.append(panel);render();sync();
  }
  function apply(speech){
    const available=voices(),chosen=available.find(v=>v.voiceURI===prefs.voiceURI);
    if(chosen){speech.voice=chosen;speech.lang=chosen.lang;}
    else if(prefs.voiceURI){speech.voice=null;}
    speech.rate=prefs.rate;
  }
  window.speechSynthesis?.addEventListener?.('voiceschanged',render);
  window.QLVoiceSettings={mount,sync,invalidate,apply};sync();
})();
