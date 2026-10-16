'use strict';
const PUBLIC_URL = 'https://thepottersmudroom.com';
// Only our known hosting aliases are rewritten; third-party links are preserved.
function publicLinks(value) {
  return typeof value === 'string' ? value.replace(/https?:\/\/(?:the-potters-mud-room|potters-ql-[a-z0-9-]+|mudroom-[a-z0-9-]+)\.onrender\.com\b/gi, PUBLIC_URL) : value;
}
function publicMail(mail) {
  return {...mail, ...Object.fromEntries(['html','text','subject'].filter(k=>typeof mail[k]==='string').map(k=>[k,publicLinks(mail[k])]))};
}
function canonicalizePublicAssets(root) {
  const fs=require('node:fs'),path=require('node:path');
  for(const entry of fs.readdirSync(root,{withFileTypes:true})) {
    const file=path.join(root,entry.name);
    if(entry.isDirectory())canonicalizePublicAssets(file);
    else if(/\.(js|html)$/.test(entry.name)) {
      const source=fs.readFileSync(file,'utf8');
      const corrected=source.replaceAll('https://the-potters-mud-room.onrender.com',PUBLIC_URL);
      if(source!==corrected)fs.writeFileSync(file,corrected);
    }
  }
}
module.exports = {PUBLIC_URL,publicLinks,publicMail,canonicalizePublicAssets};
