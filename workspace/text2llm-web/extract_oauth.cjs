const fs = require('fs');
const text = fs.readFileSync('public/app.js', 'utf8');
const searchMatch = 'oauthBtn.textContent = "Starting..."';
const startIdx = text.indexOf(searchMatch);
console.log(text.substring(Math.max(0, startIdx - 500), startIdx + 2000));
