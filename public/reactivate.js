'use strict';
const statusEl=document.getElementById('status');
let token=localStorage.getItem('mudlog_token');
async function request(path,body){
  const response=await fetch(path,{method:body?'POST':'GET',headers:{'Authorization':'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(response.status===401){document.getElementById('login').style.display='block';document.getElementById('renewal').style.display='none';}
  if(!response.ok)throw Error(data.error || 'Unable to verify membership. Please try again.');return data;
}
function display(state){
  if(!state.blocked && ['active','free','administrator','complimentary','legacy_review','grace'].includes(state.status)){location.replace('/#pieces');return;}
  document.getElementById('renewal').style.display='block';document.getElementById('login').style.display='none';statusEl.textContent='Signed in securely. Your collection is preserved.';
}
async function check(refresh=false){
  if(!token){document.getElementById('login').style.display='block';statusEl.textContent='Use your existing account to renew.';return;}
  try{display(await request(refresh?'/api/billing/refresh':'/api/billing/access',refresh?{}:undefined));}catch(e){statusEl.textContent=e.message;}
}
document.getElementById('login').addEventListener('submit',async e=>{e.preventDefault();try{const data=await request('/api/auth/login',{email:document.getElementById('email').value,password:document.getElementById('password').value});token=data.token;localStorage.setItem('mudlog_token',token);await check();}catch(e){statusEl.textContent=e.message;}});
document.getElementById('renew').addEventListener('click',async e=>{const button=e.currentTarget;button.disabled=true;statusEl.textContent='Opening secure membership billing…';try{const data=await request('/api/billing/checkout',{plan:document.getElementById('plan').value});if(!data.url)throw Error('Please manage your membership in its app store.');location.assign(data.url);}catch(e){statusEl.textContent=e.message;button.disabled=false;}});
document.getElementById('refresh').addEventListener('click',()=>check(true));
document.getElementById('signout').addEventListener('click',()=>{localStorage.removeItem('mudlog_token');location.replace('/');});
check(new URLSearchParams(location.search).has('payment'));
