const fs = require('fs');
const key = fs.readFileSync('./bazaar-tracker--bd-firebase-adminsdk-fbsvc-9ec5561af7.json', 'utf8')
const base64 = Buffer.from(key).toString('base64')
console.log(base64)