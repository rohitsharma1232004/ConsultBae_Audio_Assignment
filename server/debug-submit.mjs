import fs from 'node:fs';
import path from 'node:path';

const filePath = path.join(process.cwd(), 'tmp_debug_submission.wav');
const wav = Buffer.alloc(44100 * 2 + 44);
wav.write('RIFF', 0, 4, 'ascii');
wav.writeUInt32LE(36 + 44100 * 2, 4);
wav.write('WAVE', 8, 4, 'ascii');
wav.write('fmt ', 12, 4, 'ascii');
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24);
wav.writeUInt32LE(44100 * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36, 4, 'ascii');
wav.writeUInt32LE(44100 * 2, 40);
for (let i = 0; i < 44100; i++) {
  const sample = Math.sin((2 * Math.PI * 440 * i) / 44100) * 32767;
  wav.writeInt16LE(Math.max(-32768, Math.min(32767, sample | 0)), 44 + i * 2);
}
fs.writeFileSync(filePath, wav);

const form = new FormData();
form.append('name', 'Debug User');
form.append('phone', '1111111111');
form.append('audio', new Blob([fs.readFileSync(filePath)], { type: 'audio/wav' }), 'tmp_debug_submission.wav');

const res = await fetch('http://localhost:5000/api/submissions', {
  method: 'POST',
  body: form,
});

console.log('POST_STATUS', res.status);
console.log(await res.text());

const listRes = await fetch('http://localhost:5000/api/submissions');
console.log('GET_STATUS', listRes.status);
console.log(await listRes.text());
