'use strict';
// Explicit command for future changes: frozen baseline first, candidate evidence second.
const fs=require('node:fs'),{gates}=require('./metrics.cjs');
if(process.argv.length!==4)throw Error('Usage: node ql/photo-eval/compare.cjs BASELINE-plain-results.json CANDIDATE-plain-results.json');
const result=gates(JSON.parse(fs.readFileSync(process.argv[2])),JSON.parse(fs.readFileSync(process.argv[3])),{improvement:true});
console.log(JSON.stringify(result,null,2));if(!result.pass)process.exitCode=1;
