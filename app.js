(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ui = Object.fromEntries(['file','choose','camera','calibrate','record','download','duration','showDot','showRecorded','count','inside','remaining','status','stage','empty','surface','stimulus','points','dot','calLayer','calHint','target','cancelCal'].map(id => [id,$(id)]));
  const BASE='https://cdn.jsdelivr.net/npm/webgazer@3.5.3/dist/';
  const MODEL_PATH=BASE+'mediapipe/face_mesh';
  const positions=[[.50,.50],[.12,.18],[.50,.18],[.88,.18],[.12,.50],[.88,.50],[.12,.82],[.50,.82],[.88,.82]];
  let wg, phase='off', calibrated=false, image=null, objectURL=null, trial=null;
  let slot=0, clicks=0, shownAt=0, eyeAt=-Infinity, lastValid=-Infinity, timer=0, request=0;
  let downloadName='';
  const say = text => { ui.status.textContent=text; };
  const sync = () => {
    const locked=['starting','calibrating','recording','loading'].includes(phase);
    ui.camera.disabled=['starting','calibrating','loading'].includes(phase);
    ui.camera.textContent=phase==='starting'?'Starting camera…':wg && phase!=='off'?'Turn off camera':'2. Enable camera';
    ui.choose.disabled=ui.file.disabled=locked; ui.calibrate.disabled=phase!=='ready';
    ui.record.disabled=phase!=='recording' && !(phase==='ready' && image && calibrated);
    ui.record.textContent=phase==='recording'?'Stop recording':'4. Start recording';
    ui.download.disabled=!trial || phase==='recording'; ui.duration.disabled=locked;
    ui.showDot.disabled=phase==='recording'; ui.showRecorded.disabled=phase==='recording';
  };
  function coords(x,y,r) {
    const xn=(x-r.left)/r.width, yn=(y-r.top)/r.height;
    return {xn,yn,inside:xn>=0 && xn<1 && yn>=0 && yn<1};
  }
  function layout() {
    if (!image) return;
    const ratio=Math.min(ui.stage.clientWidth/image.w,ui.stage.clientHeight/image.h);
    ui.surface.style.width=`${image.w*ratio}px`; ui.surface.style.height=`${image.h*ratio}px`;
    draw();
  }
  const sameFrame=(a,b)=>['left','top','width','height'].every(k=>Math.abs(a[k]-b[k])<0.75);
  function draw() {
    if (!image) return;
    const r=ui.surface.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2);
    ui.points.width=Math.max(1,Math.round(r.width*dpr)); ui.points.height=Math.max(1,Math.round(r.height*dpr));
    if (!ui.showRecorded.checked || !trial || phase==='recording' || trial.image!==image) return;
    const ctx=ui.points.getContext('2d');
    ctx.scale(ui.points.width,ui.points.height); ctx.fillStyle='rgba(255,48,105,0.21)';
    for(const row of trial.rows) if(row.p?.inside) {
      ctx.beginPath(); ctx.ellipse(row.p.xn,row.p.yn,3/ui.points.width*dpr,3/ui.points.height*dpr,0,0,2*Math.PI); ctx.fill();
    }
  }
  async function loadImage() {
    const f=ui.file.files[0]; ui.file.value=''; if(!f) return;
    if(f.size>30*1024*1024 || !/^image\/(png|jpeg|webp|gif|bmp|avif)$/i.test(f.type)) {say('Choose a PNG, JPEG, WebP, GIF, BMP, or AVIF image no larger than 30 MB.');return;}
    const old=phase; phase='loading'; sync();
    const url=URL.createObjectURL(f), probe=new Image();
    try {
      probe.src=url; await probe.decode();
      if(!probe.naturalWidth || !probe.naturalHeight) throw new Error('Invalid image');
      ui.stimulus.src=url; if(objectURL) URL.revokeObjectURL(objectURL);
      objectURL=url; image={name:f.name,w:probe.naturalWidth,h:probe.naturalHeight};
      ui.empty.hidden=true; ui.surface.hidden=false; layout();
      say(`Loaded ${f.name} (${image.w} × ${image.h}). ${!wg?'Enable the camera to continue.':calibrated?'You can start recording.':'Calibrate before recording.'}`);
    } catch { URL.revokeObjectURL(url); say('This image could not be opened. Try saving it as a PNG or JPEG.'); }
    finally { if(phase==='loading') phase=old; sync(); }
  }
  function library() {
    if(window.webgazer) return Promise.resolve(window.webgazer);
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script'); s.src=BASE+'webgazer.js';
      const timeout=setTimeout(()=>{s.remove();reject(new Error('The WebGazer download timed out. Check your connection.'));},25000);
      s.onload=()=>{clearTimeout(timeout);window.webgazer?resolve(window.webgazer):reject(new Error('WebGazer did not load correctly.'));};
      s.onerror=()=>{clearTimeout(timeout);s.remove();reject(new Error('Could not download WebGazer. Check whether your network can reach jsDelivr.'));};
      document.head.append(s);
    });
  }
  async function camera() {
    if(wg && phase!=='off') {shutdown('Camera is off. You can still export the last recording.');return;}
    if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || location.protocol==='file:') {
      say('Open this page on localhost or over HTTPS, then allow camera access.');return;
    }
    const start=++request; phase='starting'; sync(); say('Loading the tracking model. Allow camera access when your browser asks.');
    let step='downloading WebGazer';
    try {
      wg=await library(); if(start!==request) {wg=null;return;}
      step='configuring WebGazer';
      wg.saveDataAcrossSessions(false); wg.showVideo(false); wg.showFaceOverlay(false); wg.showFaceFeedbackBox(false); wg.showPredictionPoints(false);
      wg.params.faceMeshSolutionPath=MODEL_PATH;
      wg.setTracker('TFFacemesh'); wg.setRegression('ridge'); resetCalibration();
      const tracker=wg.getTracker(), getEyes=tracker.getEyePatches;
      if(typeof getEyes!=='function') throw new Error('The tracker cannot extract eye features.');
      tracker.getEyePatches=async function(...args) {
        try {
          const eyes=await getEyes.apply(this,args);
          if(start===request) eyeAt=eyes?performance.now():-Infinity;
          return eyes;
        } catch(error) {
          if(phase==='starting') throw error;
          if(start===request) {
            console.error('[WebGazer: eye tracking]',error);
            queueMicrotask(()=>{if(start===request) shutdown(`Eye tracking failed: ${error?.message || error}`);});
          }
          return null;
        }
      };
      wg.setGazeListener(onGaze);
      if(typeof tracker.init==='function') {step='loading the face model';await tracker.init();}
      if(start!==request) return;
      step='opening the camera and initializing tracking'; await wg.begin(()=>{});
      if(start!==request) return;
      wg.removeMouseEventListeners();
      const video=$(wg.params.videoElementId);
      if(!video?.srcObject?.getVideoTracks().some(t=>t.readyState==='live')) throw new Error('No camera stream is available. Check camera permissions and make sure the camera is connected.');
      for(const track of video.srcObject.getVideoTracks()) track.addEventListener('ended',()=>{if(start===request) shutdown('Camera disconnected. Enable it again and recalibrate.');},{once:true});
      phase='ready'; sync(); say('Camera is on. Face the screen in even lighting, then start the nine-point calibration.');
    } catch(err) {
      console.error(`[WebGazer startup: ${step}]`,err);
      if(start===request) shutdown(`Startup failed (${step}): ${err?.message || 'Check camera permissions and your internet connection.'}`);
    }
  }
  function shutdown(message) {
    ++request;
    if(phase==='recording') finish('camera_closed');
    if(phase==='calibrating') closeCal(false);
    if(wg) {
      const video=$(wg.params?.videoElementId);
      video?.srcObject?.getTracks().forEach(track=>track.stop());
      try {wg.pause();wg.clearGazeListener();wg.removeMouseEventListeners();if(video) wg.end();} catch(e){console.warn(e);}
      wg=null;
    }
    phase='off';calibrated=false;eyeAt=lastValid=-Infinity;ui.dot.hidden=true;sync();say(message);
  }
  function resetCalibration() {const regression=wg.getRegression()[0];if(typeof regression?.init==='function') regression.init();}
  function renderTarget() {
    const [x,y]=positions[slot];
    ui.target.style.left=`${100*x}%`;ui.target.style.top=`${100*y}%`;
    ui.calHint.textContent=`Target ${slot+1} of 9. Samples: ${clicks} of 5. Look at the center, then click or press Space.`;
    shownAt=performance.now();
  }
  function calibrate() {
    if(phase!=='ready') return;
    calibrated=false;phase='calibrating';slot=clicks=0;lastValid=-Infinity;
    resetCalibration();ui.dot.hidden=true;ui.calLayer.hidden=false;
    document.querySelector('main').inert=true;sync();renderTarget();ui.target.focus({preventScroll:true});
  }
  function sampleTarget() {
    if(phase!=='calibrating') return;
    const t=performance.now();if(t-shownAt<350) return;
    if(t-eyeAt>600) {ui.calHint.textContent='Eyes not detected. Face the camera, improve the lighting, and try again.';return;}
    const b=ui.target.getBoundingClientRect();
    wg.recordScreenPosition(b.left+b.width/2,b.top+b.height/2,'click');
    if(++clicks===5) {clicks=0;if(++slot===positions.length) {closeCal(true);return;}}
    renderTarget();
  }
  function closeCal(success) {
    ui.calLayer.hidden=true;document.querySelector('main').inert=false;phase='ready';calibrated=success;
    sync();ui.calibrate.focus({preventScroll:true});
    say(success?'Calibration complete. Keep your position and start recording when an image is ready.':'Calibration stopped. Please calibrate again before recording.');
  }
  function beginTrial() {
    if(phase!=='ready' || !image || !calibrated) return;
    const seconds=ui.duration.valueAsNumber;
    if(!Number.isInteger(seconds)||seconds<3||seconds>120) {say('Enter a whole number from 3 to 120 seconds.');ui.duration.focus();return;}
    if(performance.now()-lastValid>1800) {say('No recent gaze estimate. Face the camera and recalibrate if needed.');return;}
    const rect=ui.surface.getBoundingClientRect();if(!rect.width||!rect.height) {say('The image is not visible. Check your window size.');return;}
    if(trial && !trial.exported && !window.confirm('Starting a new recording will replace the last recording, which has not been exported. Continue?')) return;
    const now=new Date();downloadName=`gaze_${now.toISOString().replace(/[:.]/g,'-')}.csv`;
    trial={image,rect,started:performance.now(),wall:now.toISOString(),duration:seconds*1000,rows:[],valid:0,inside:0,exported:false,reason:'',viewW:innerWidth,viewH:innerHeight};
    phase='recording';sync();draw();showStats();say('Recording. Look at the image naturally. Press Esc to stop early.');
    trial.rect=ui.surface.getBoundingClientRect();
    timer=setInterval(()=>{if(performance.now()-trial.started>=trial.duration) finish('time_limit');else showStats();},100);
  }
  function showStats() {
    ui.count.value=String(trial.valid);ui.inside.value=String(trial.inside);
    ui.remaining.value=phase==='recording'?`${Math.max(0,Math.ceil((trial.duration-performance.now()+trial.started)/1000))} s`:'–';
  }
  function onGaze(data) {
    if(!wg||phase==='off') return;
    const now=performance.now(),valid=Number.isFinite(data?.x)&&Number.isFinite(data?.y);
    if(valid)lastValid=now;
    if(phase==='calibrating'||(phase!=='recording'&&!ui.showDot.checked))return;
    if(phase==='recording') {
      if(now-trial.started>=trial.duration){finish('time_limit');return;}
      if(!sameFrame(trial.rect,ui.surface.getBoundingClientRect())){invalidate('layout_changed');return;}
      const p=valid?coords(data.x,data.y,trial.rect):null;
      trial.rows.push({ms:now-trial.started,x:valid?data.x:null,y:valid?data.y:null,p});
      if(valid)trial.valid++;if(p?.inside)trial.inside++;
    }
    if(!valid||!ui.showDot.checked||!image||!calibrated){ui.dot.hidden=true;return;}
    const r=ui.stage.getBoundingClientRect(),x=data.x-r.left,y=data.y-r.top;
    ui.dot.hidden=x<0||y<0||x>=r.width||y>=r.height;
    if(!ui.dot.hidden){ui.dot.style.left=`${x}px`;ui.dot.style.top=`${y}px`;}
  }
  function finish(reason) {
    if(phase!=='recording')return;
    clearInterval(timer);trial.reason=reason;phase='ready';ui.dot.hidden=true;showStats();sync();draw();
    say(`${reason==='time_limit'?'Recording complete':'Recording stopped'}. Valid estimates: ${trial.valid}. Inside image: ${trial.inside}. ${trial.valid?'You can export the CSV.':'No valid gaze estimates were recorded. Check your position and lighting, then recalibrate.'}`);
  }
  function invalidate(reason) {
    if(phase==='recording')finish(reason);
    if(phase==='calibrating')closeCal(false);
    if(calibrated){calibrated=false;ui.dot.hidden=true;sync();say('The window, image position, or tab visibility changed. Please recalibrate. You can still export the last recording.');}
  }
  const fixed=v=>Number.isFinite(v)?Number(v.toFixed(6)):'';
  const field=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const safeName=s=>/^\s*[=+@-]|^[\t\r\n]/.test(s)?"'"+s:s;
  function writeCSV() {
    if(!trial||phase==='recording')return;
    const {rect:r,image:i}=trial;
    const header='started_utc,stimulus_file,stimulus_width_px,stimulus_height_px,viewport_width_css_px,viewport_height_css_px,image_left_css_px,image_top_css_px,image_width_css_px,image_height_css_px,planned_duration_ms,stop_reason,elapsed_ms,prediction_valid,viewport_x_css_px,viewport_y_css_px,within_image,image_x_norm,image_y_norm,image_x_px,image_y_px';
    const prefix=[trial.wall,safeName(i.name),i.w,i.h,trial.viewW,trial.viewH,fixed(r.left),fixed(r.top),fixed(r.width),fixed(r.height),trial.duration,trial.reason];
    const rows=trial.rows.map(row=>{const p=row.p;return [...prefix,fixed(row.ms),p?1:0,fixed(row.x),fixed(row.y),p?Number(p.inside):'',p?.inside?fixed(p.xn):'',p?.inside?fixed(p.yn):'',p?.inside?fixed(p.xn*i.w):'',p?.inside?fixed(p.yn*i.h):''].map(field).join(',');});
    const blob=new Blob(['\ufeff',header,'\r\n',rows.join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=downloadName;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);trial.exported=true;
  }
  ui.choose.addEventListener('click',()=>ui.file.click());ui.file.addEventListener('change',loadImage);ui.camera.addEventListener('click',camera);
  ui.calibrate.addEventListener('click',calibrate);ui.target.addEventListener('click',sampleTarget);ui.cancelCal.addEventListener('click',()=>closeCal(false));
  ui.record.addEventListener('click',()=>phase==='recording'?finish('manual_stop'):beginTrial());
  ui.download.addEventListener('click',writeCSV);ui.showRecorded.addEventListener('change',draw);
  ui.showDot.addEventListener('change',()=>{if(!ui.showDot.checked)ui.dot.hidden=true;});
  window.addEventListener('resize',()=>{invalidate('viewport_resized');layout();});
  window.addEventListener('scroll',()=>{if(phase==='recording'&&!sameFrame(trial.rect,ui.surface.getBoundingClientRect()))invalidate('page_scrolled');},{passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate('tab_hidden');});
  window.addEventListener('pagehide',()=>{if(wg)shutdown('The page has closed.');});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(phase==='recording')finish('escape');else if(phase==='calibrating')closeCal(false);}});
  sync();
})();