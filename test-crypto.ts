import * as crypto from 'crypto';
console.log(typeof crypto);
console.log(typeof crypto.createHmac);
console.log(crypto.createHmac('sha256', 'test').update('data').digest('hex'));