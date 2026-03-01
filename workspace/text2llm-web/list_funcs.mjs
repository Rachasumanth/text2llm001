
import fs from 'fs';
const code = fs.readFileSync('server.mjs', 'utf8');
const regex = /async function ([a-zA-Z0-9_]+)/g;
let m;
while ((m = regex.exec(code)) !== null) {
  console.log(m[1]);
}
const regex2 = /function ([a-zA-Z0-9_]+)/g;
while ((m = regex2.exec(code)) !== null) {
  console.log(m[1]);
}
