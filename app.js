import { HandLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs';

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('overlay');
const ctx = canvas.getContext('2d');
const ui = Object.fromEntries(['camera-indicator','camera-placeholder','fps-label','mode-pill','mode-copy','round-label','target-left','target-right','target-left-icon','target-right-icon','hold-label','hold-bar','feedback','start-button','reset-button','left-state','right-state','left-confidence','right-confidence','left-readout','right-readout','score','streak','time'].map(id => [id, $(id)]));
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm';
const HOLD_MS = 650;
const ROUND_SECONDS = 60;
let landmarker, stream, frameRequest, phase = 'idle', calibrationStep = 'open', calibrationSamples = { open: { left: [], right: [] }, fist: { left: [], right: [] } };
let thresholds = { left: 1.42, right: 1.42 }, hands = { left: null, right: null }, target, round = 0, score = 0, streak = 0, deadline = 0, holdStart = 0, mustRelease = false, lastVideoTime = -1, lastFrameAt = 0;

function setFeedback(message) { ui.feedback.textContent = message; }
function setPhase(next) { phase = next; ui.start-button.hidden = !['idle', 'ready', 'done'].includes(next); ui.reset-button.hidden = next === 'idle'; }
function resetCalibration() { calibrationStep = 'open'; calibrationSamples = { open: { left: [], right: [] }, fist: { left: [], right: [] } }; thresholds = { left: 1.42, right: 1.42 }; }
function setReadout(side, hand) {
  const state = ui[`${side}-state`], confidence = ui[`${side}-confidence`], box = ui[`${side}-readout`];
  state.textContent = hand?.gesture || 'NOT FOUND';
  confidence.textContent = hand ? (hand.gesture === 'UNSURE' ? 'ADJUST YOUR HAND' : 'TRACKING') : 'SHOW YOUR HAND';
  box.classList.toggle('detected', !!hand && hand.gesture !== 'UNSURE');
}
function gestureScore(points) {
  const wrist = points[0];
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return [8, 12, 16, 20].reduce((sum, tip) => sum + distance(points[tip], wrist) / Math.max(.001, distance(points[tip - 3], wrist)), 0) / 4;
}
function classify(score, side) {
  const margin = .06;
  if (score > thresholds[side] + margin) return 'OPEN';
  if (score < thresholds[side] - margin) return 'FIST';
  return 'UNSURE';
}
function drawLandmarks(landmarks) {
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#b9f370'; ctx.fillStyle = '#b9f370'; ctx.lineWidth = Math.max(2, canvas.width / 300);
  for (const hand of landmarks) {
    for (const [a,b] of HandLandmarker.HAND_CONNECTIONS) {
      ctx.beginPath(); ctx.moveTo(hand[a].x * canvas.width, hand[a].y * canvas.height); ctx.lineTo(hand[b].x * canvas.width, hand[b].y * canvas.height); ctx.stroke();
    }
    for (const point of hand) { ctx.beginPath(); ctx.arc(point.x * canvas.width, point.y * canvas.height, Math.max(2, canvas.width / 230), 0, Math.PI * 2); ctx.fill(); }
  }
}
function detectHands(result) {
  const found = (result.landmarks || []).map(points => ({ points, score: gestureScore(points), x: 1 - points[0].x })).sort((a,b) => a.x - b.x);
  const assigned = { left: null, right: null };
  if (found.length === 2) { assigned.left = found[0]; assigned.right = found[1]; }
  else if (found.length === 1) assigned[found[0].x < .5 ? 'left' : 'right'] = found[0];
  for (const side of ['left', 'right']) {
    assigned[side] && (assigned[side].gesture = classify(assigned[side].score, side));
    setReadout(side, assigned[side]);
  }
  hands = assigned;
  drawLandmarks(result.landmarks || []);
}
function calibrate() {
  const both = hands.left && hands.right;
  if (!both) { setFeedback('Show both hands, one on each side of the frame.'); return; }
  const step = calibrationStep;
  const expected = step === 'open' ? 'OPEN' : 'FIST';
  // Broad guard prevents capturing the wrong gesture before personal thresholds exist.
  const likely = ['left','right'].every(side => step === 'open' ? hands[side].score > 1.5 : hands[side].score < 1.4);
  if (!likely) { setFeedback(`Show ${expected} with both hands for calibration.`); return; }
  for (const side of ['left','right']) calibrationSamples[step][side].push(hands[side].score);
  const count = Math.min(calibrationSamples[step].left.length, 24);
  ui.hold-bar.style.width = `${count / 24 * 100}%`; ui.hold-label.textContent = `${Math.round(count / 24 * 100)}%`;
  if (count < 24) { setFeedback(`Hold both hands ${expected}…`); return; }
  if (step === 'open') { calibrationStep = 'fist'; ui.hold-bar.style.width = '0'; ui.hold-label.textContent = '0%'; setFeedback('Great. Now make two fists.'); return; }
  for (const side of ['left','right']) {
    const avg = type => calibrationSamples[type][side].reduce((a,b) => a+b,0) / calibrationSamples[type][side].length;
    if (avg('open') - avg('fist') < .24) { resetCalibration(); setFeedback('Calibration was unclear. Try again with fully spread fingers.'); return; }
    thresholds[side] = (avg('open') + avg('fist')) / 2;
  }
  setFeedback('Calibrated. Press START GAME when ready.'); ui.start-button.textContent = 'START GAME ↗'; ui.start-button.hidden = false; setPhase('ready');
  ui.mode-pill.textContent = 'CALIBRATED'; ui.mode-copy.textContent = 'Both hands are ready.';
}
function opposite(gesture) { return gesture === 'OPEN' ? 'FIST' : 'OPEN'; }
function nextRound() {
  round++;
  const choices = ['OPEN','FIST'];
  target = { left: choices[Math.floor(Math.random()*2)], right: choices[Math.floor(Math.random()*2)], reverse: round > 2 && Math.random() < .38 };
  ui.round-label.textContent = `ROUND ${String(round).padStart(2,'0')}`;
  ui.target-left.textContent = target.left; ui.target-right.textContent = target.right;
  ui.mode-pill.textContent = target.reverse ? 'REVERSE' : 'NORMAL'; ui.mode-pill.classList.toggle('reverse', target.reverse);
  ui.mode-copy.textContent = target.reverse ? 'Perform the OPPOSITE of each target.' : 'Match the targets exactly.';
  ui.hold-bar.style.width = '0'; ui.hold-label.textContent = '0%'; holdStart = 0; mustRelease = true;
  setFeedback(target.reverse ? 'Rule flipped. Think before you move.' : 'Find the signal, then hold it.');
}
function matchesTarget() {
  if (!hands.left || !hands.right || !target) return false;
  return ['left','right'].every(side => hands[side].gesture === (target.reverse ? opposite(target[side]) : target[side]));
}
function updateGame(now) {
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000)); ui.time.innerHTML = `${remaining}<span class="unit">s</span>`;
  if (now >= deadline) { setPhase('done'); ui.mode-pill.textContent = 'COMPLETE'; ui.mode-pill.classList.remove('reverse'); ui.mode-copy.textContent = 'Session complete'; ui.start-button.textContent = 'PLAY AGAIN ↗'; setFeedback(`Time! Final score: ${score}. Best streak: ${streak}.`); return; }
  const matched = matchesTarget();
  if (mustRelease) { if (!matched) mustRelease = false; else { setFeedback('Change or relax your hands before the next lock.'); return; } }
  if (!matched) { holdStart = 0; ui.hold-bar.style.width = '0'; ui.hold-label.textContent = '0%'; return; }
  if (!holdStart) holdStart = now;
  const progress = Math.min(1, (now - holdStart) / HOLD_MS);
  ui.hold-bar.style.width = `${Math.round(progress * 100)}%`; ui.hold-label.textContent = `${Math.round(progress * 100)}%`;
  if (progress === 1) {
    streak++; score += 100 + Math.min(streak - 1, 9) * 20 + (target.reverse ? 50 : 0);
    ui.score.textContent = String(score).padStart(4,'0'); ui.streak.textContent = String(streak).padStart(2,'0');
    nextRound();
  }
}
function frame() {
  if (!stream) return;
  const now = performance.now();
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try { detectHands(landmarker.detectForVideo(video, now)); }
    catch (error) { stopCamera(); setPhase('idle'); setFeedback(`Tracking stopped: ${error.message}`); return; }
    if (lastFrameAt) ui['fps-label'].textContent = `${Math.round(1000 / Math.max(1, now-lastFrameAt))} FPS`;
    lastFrameAt = now;
    if (phase === 'calibrating') calibrate();
  }
  if (phase === 'playing') updateGame(now);
  frameRequest = requestAnimationFrame(frame);
}
function stopCamera() { cancelAnimationFrame(frameRequest); stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null; ui['camera-indicator'].textContent = 'CAMERA OFFLINE'; ui['camera-placeholder'].hidden = false; }
async function enableCamera() {
  ui.start-button.disabled = true; setFeedback('Loading the hand tracking model…');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost in a supported browser.');
    const vision = await FilesetResolver.forVisionTasks(WASM);
    landmarker ||= await HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: .6, minTrackingConfidence: .55 });
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
    video.srcObject = stream; await video.play();
    ui['camera-placeholder'].hidden = true; ui['camera-indicator'].textContent = 'CAMERA LIVE';
    resetCalibration(); setPhase('calibrating'); ui.mode-pill.textContent = 'CALIBRATE'; ui.mode-copy.textContent = 'Show both open hands.'; setFeedback('Show OPEN with both hands.');
    frame();
  } catch (error) {
    stopCamera(); setPhase('idle');
    setFeedback(error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser and try again.' : `Could not start camera: ${error.message}`);
  } finally { ui.start-button.disabled = false; }
}
function startGame() {
  score = 0; streak = 0; round = 0; deadline = performance.now() + ROUND_SECONDS * 1000;
  ui.score.textContent = '0000'; ui.streak.textContent = '00'; ui.time.innerHTML = '60<span class="unit">s</span>';
  setPhase('playing'); nextRound();
}
ui.start-button.addEventListener('click', () => { if (phase === 'ready') startGame(); else if (phase === 'done' && stream) startGame(); else enableCamera(); });
ui.reset-button.addEventListener('click', () => { if (stream) { resetCalibration(); setPhase('calibrating'); ui.mode-pill.textContent = 'CALIBRATE'; ui.mode-copy.textContent = 'Show both open hands.'; setFeedback('Show OPEN with both hands.'); } else enableCamera(); });
window.addEventListener('pagehide', stopCamera);
