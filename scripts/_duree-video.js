// Lit la duree d'un MP4 en parcourant les atomes jusqu'a 'mvhd'.
const fs = require('fs');

const buf = fs.readFileSync('Image/animation.mp4');
const idx = buf.indexOf(Buffer.from('mvhd'));
if (idx === -1) { console.log('atome mvhd introuvable'); process.exit(1); }

const version = buf[idx + 4];
let timescale, duration;
if (version === 0) {
  timescale = buf.readUInt32BE(idx + 4 + 4 + 4 + 4);
  duration = buf.readUInt32BE(idx + 4 + 4 + 4 + 4 + 4);
} else {
  timescale = buf.readUInt32BE(idx + 4 + 4 + 8 + 8);
  duration = Number(buf.readBigUInt64BE(idx + 4 + 4 + 8 + 8 + 4));
}

const secondes = duration / timescale;
console.log(`  version mvhd : ${version}`);
console.log(`  timescale    : ${timescale}`);
console.log(`  duree        : ${secondes.toFixed(3)} s`);

// Un tour complet en 3 s exige cette vitesse de lecture.
console.log(`  vitesse necessaire pour tenir en 3 s : x${(secondes / 3).toFixed(2)}`);
