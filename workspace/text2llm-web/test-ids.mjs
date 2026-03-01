import fs from 'fs';

const indexHtml = fs.readFileSync('public/index.html', 'utf8');
const appJs = fs.readFileSync('public/app.js', 'utf8');

const regex = /document\.getElementById\(['"]([^'"]+)['"]\)/g;
const calls = [];
let match;
while ((match = regex.exec(appJs)) !== null) {
  calls.push(match[1]);
}

const missing = calls.filter(id => !indexHtml.includes(`id="${id}"`) && !indexHtml.includes(`id='${id}'`));
console.log('Missing IDs:', [...new Set(missing)]);
