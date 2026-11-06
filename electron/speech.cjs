const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const exec = promisify(execFile);
let speaking;
let generation = 0;
async function voices() {
  if (process.platform === 'darwin') {
    const { stdout } = await exec('/usr/bin/say', ['-v', '?']);
    return stdout.split('\n').flatMap(line => { const match = line.match(/^(.+?)\s+([a-z]{2,3}[_-][A-Z]{2})\s+#/); return match ? [{ id: match[1].trim(), name: match[1].trim(), language: match[2].replace('_', '-') }] : []; });
  }
  if (process.platform === 'win32') {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; @($s.GetInstalledVoices() | ForEach-Object { @{id=$_.VoiceInfo.Name;name=$_.VoiceInfo.Name;language=$_.VoiceInfo.Culture.Name} }) | ConvertTo-Json -Compress"], { windowsHide: true });
    const result = JSON.parse(stdout); return Array.isArray(result) ? result : [result];
  }
  return [];
}
function stop() { generation++; if (speaking) { if (process.platform === 'darwin') { speaking.kill('SIGCONT'); speaking.kill('SIGTERM'); } else { speaking.stdin.write(JSON.stringify({ command: 'stop' }) + '\n'); } speaking = undefined; } }
function control(action) {
  if (!['pause', 'resume', 'stop'].includes(action)) throw new Error('Unknown speech action');
  if (action === 'stop') { stop(); return; }
  if (!speaking) return;
  if (process.platform === 'darwin') speaking.kill(action === 'pause' ? 'SIGSTOP' : 'SIGCONT');
  else speaking.stdin.write(JSON.stringify({ command: action }) + '\n');
}
async function speak(text, voice, rate) {
  if (typeof text !== 'string' || text.length > 100000 || typeof voice !== 'string' || !Number.isFinite(rate) || rate < 0.5 || rate > 3) throw new Error('Invalid speech request');
  const request = ++generation, installed = await voices();
  if (request !== generation) return;
  const selected = installed.find(v => v.id === voice) ?? installed[0];
  if (!selected) throw new Error('No local voices are installed');
  stop();
  const child = process.platform === 'darwin'
    ? spawn('/usr/bin/say', ['-v', selected.id, '-r', String(Math.round(180 * rate))], { stdio: ['pipe', 'ignore', 'pipe'] })
    : spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'speech.ps1')], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  speaking = child;
  if (process.platform === 'darwin') child.stdin.end(text);
  else child.stdin.write(JSON.stringify({ text, voice: selected.id, rate: Math.max(-10, Math.min(10, Math.round((rate - 1) * 5))) }) + '\n');
  return new Promise((resolve, reject) => {
    let error = ''; child.stderr.on('data', data => { error += data; }); child.on('error', reject);
    child.on('close', code => { if (speaking === child) speaking = undefined; code === 0 || code === null ? resolve() : reject(new Error(error || 'Local speech failed')); });
  });
}
module.exports = { voices, speak, control, stop };
