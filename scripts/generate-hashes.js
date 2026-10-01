const crypto = require('crypto');
for (const password of process.argv.slice(2)) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  process.stdout.write(`${password}=${salt}:${hash}\n`);
}
