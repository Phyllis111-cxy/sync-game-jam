# SYNC — Two hands. One signal.

A webcam based coordination game for two hands. MediaPipe Hand Landmarker tracks landmarks in the browser and SYNC classifies each hand as **OPEN**, **FIST**, or **UNSURE**. Camera frames stay on the device.

## Play

1. Open the deployed page over HTTPS, or serve this folder locally on `localhost` (for example, `python3 -m http.server 8000`, then open `http://localhost:8000`). Opening `index.html` directly as a file is unsupported because browser camera access needs a secure context.
2. Select **Enable Camera** and grant permission. Keep both hands in frame, with one on each side.
3. Hold both hands fully **OPEN**, then hold two **FISTS** to calibrate. Lighting and a plain background help.
4. Select **Start Game**. Match each hand's target for about 0.65 seconds. On **REVERSE** rounds, perform the opposite of each displayed target.
5. Score as many rounds as possible in 60 seconds. Each round earns 100 points, streak bonuses up to 180, and a 50 point reverse bonus. Move or relax your hands between rounds to avoid accidental repeat scoring.

## How it works

This is a dependency free static web app. `index.html` provides the interface, `styles.css` handles the responsive layout, and `app.js` handles tracking, calibration, and game state. The MediaPipe Tasks Vision JavaScript bundle, WASM runtime, hand model, and Google Fonts are fetched from public CDNs on first load; internet access is required. No video, images, or scores are uploaded by the app.

Hand state uses the average distance of four fingertips from the wrist relative to their base joints. Calibration finds separate thresholds for the left and right hand. On-screen left/right is based on the mirrored selfie view, so moving to the corresponding half of the camera view resolves ambiguous single-hand tracking.

## Deployment

GitHub Pages can serve the repository root: in **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`. Any static HTTPS host also works.

## Limitations

This is a game heuristic, not a sign language recognizer. Occluded hands, hands crossing the center line, motion blur, and low light can reduce accuracy. Best played with two well separated hands in a front facing camera. A recent browser with WebAssembly, WebGL, and camera support is recommended.
