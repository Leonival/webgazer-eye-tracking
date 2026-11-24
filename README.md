# WebGazer Image Eye Tracking

A static website for recording webcam-based gaze estimates while viewing an image. No build step or backend is required. WebGazer 3.5.3 and its MediaPipe face model load from jsDelivr. The page does not upload images, camera frames, or gaze data and does not use the microphone. The CDN receives standard requests for library and model assets.

## Run locally

Extract the ZIP. Open a terminal in the folder containing `index.html` and run:

```sh
python -m http.server 8000 --bind localhost
```

If needed, use `python3` on macOS/Linux or `py -3` on Windows. In desktop Chrome or Edge, open [the local test page](http://localhost:8000/) and allow camera access. Do not open `index.html` directly from your file manager. If port 8000 is in use, change it in both the command and the browser address.

To replace the previous edition, copy `index.html`, `style.css`, and `app.js` into the folder already served by your local server, then reload the page. Use a hard refresh if the old page still appears. The browser and operating system control the language of camera permission prompts and the file picker.

## Run a test

1. Choose a static image using **Browse images**. The image keeps its aspect ratio. Avoid animated stimuli for a fixed-image test.
2. Select **Enable camera**, grant permission, and face the camera in even lighting.
3. Select **Calibrate (9 points)**. Look at the center of each target, then click or press Space five times. Clicks made too quickly are ignored.
4. Set the duration (3–120 seconds, default 15) and select **Start recording**. Keep your head and screen position steady and look at the image naturally. Leave the live gaze point off unless you are debugging. Press Esc or select **Stop recording** to finish early. Resizing the window, switching tabs, or scrolling enough to move the image during recording stops the trial and requires recalibration.
5. Review the recorded points and select **Export CSV**. Only the latest trial is held in memory. Changing the image does not erase that recording, but the points appear only on the image used for that trial. Turning off the camera preserves the last recording; refreshing the page clears it.

## CSV format

- Each row corresponds to a WebGazer callback, not a fixed sampling rate. `elapsed_ms` is elapsed time since recording began; `started_utc` is the trial start in UTC.
- `prediction_valid=0` indicates no finite gaze estimate for that callback. Coordinates are blank, not zero. If there are no callbacks, the CSV contains only its header.
- `viewport_x_css_px` and `viewport_y_css_px` are relative to the viewport's top-left corner. `within_image` flags valid estimates inside the image. `image_x_norm` and `image_y_norm` range from 0 (inclusive) to 1 (exclusive); `image_x_px` and `image_y_px` map to the image's natural dimensions as reported by the browser. Image coordinates are blank for valid estimates outside the image.
- `image_left_css_px`, `image_top_css_px`, `image_width_css_px`, and `image_height_css_px` describe the displayed image rectangle. The point overlay shows raw estimates, not fixation events, a heat map, or an accuracy measure.
- Calibration trains at known targets; automatic mouse training is disabled during normal use. Before formal data collection, validate accuracy on separate targets and check missing data and repeatability.

## Deploy and troubleshoot

- Publish `index.html`, `style.css`, and `app.js` together on an HTTPS static host. Open the site directly; an embedded page may lack permission to use the camera.
- If the startup message says **loading the face model**, check whether requests under `mediapipe/face_mesh/` are blocked or return an error. To use a local mirror, serve the WebGazer 3.5.3 `dist/webgazer.js` and complete `dist/mediapipe/` directory, update `BASE` in `app.js`, and follow the dependency's license terms.
- If startup fails while opening the camera, check browser and system permissions, then look for `[WebGazer startup: …]` in the browser console.

See the [WebGazer project](https://webgazer.cs.brown.edu/) and the [browser camera access reference](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
