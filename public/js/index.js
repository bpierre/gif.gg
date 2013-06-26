var compat = require('./compat');
var domutils = require('./domutils');
var getPreview = require('./cam-preview');
var getGifMaker = require('./gifmaker');
var getProgress = require('./progress');

// input[type=range] for Firefox 23 and -
require('./html5slider');

var WIDTH = 320;
var HEIGHT = 240;
var DELAY = 400;
var DELAY_MIN = 20;
var DELAY_MAX = 1000;

var URL = compat.URL;
var elt = domutils.elt;
var insertAfter = domutils.insertAfter;
var button = domutils.button;

var document = window.document;
var body = document.body;
var main = insertAfter(body, elt('div', { id: 'main' }), body.firstElementChild);

function shot() {
  preview.getImage(function(img) {
    gifmaker.addFrame(img);
  });
}

function save() {
  if (gifmaker.frames().length < 2
      && !window.confirm('To make an animation, you need to add another image. Save anyway?')) {
    return;
  }
  var blob = gifmaker.blob();
  var fd = new FormData();
  var xhr = new XMLHttpRequest();
  fd.append('gif', blob);
  xhr.open('POST', '/', true);
  xhr.upload.onprogress = function(e) {
    if (e.lengthComputable) {
      progress.val(e.loaded / e.total * 100);
    }
  };
  xhr.onload = function(){
    var res = xhr.responseText;
    progress.hide();
    if (res !== '0') {
      window.location = res;
    } else {
      alert('Ooops\u2026 an error occured while saving your gif.\n' +
            'Sorry about that!');
    }
  };
  progress.show('saving\u2026');
  saveButton.disabled = true;
  resetButton.disabled = true;
  xhr.send(fd);
}

var progress = getProgress(0, 100, body);

var appElt = elt('div', { className: 'app', hidden: true }, main);
var screens = elt('div', { className: 'screens' }, appElt);
var preview = getPreview(WIDTH, HEIGHT, screens, function(){
  progress.val(false);
  progress.show('Waiting for the camera\u2026');
}, function(){
  progress.hide();
  startElt.hidden = true;
  appElt.hidden = false;
}, function() {
  var errorMessage = 'Your browser does not support accessing the camera.<br> Please try again using <a href="https://www.mozilla.org/firefox/">Firefox</a> or <a href="https://www.google.com/chrome/">Chrome</a> and ensure your camera is connected.';
  main.appendChild(elt('p', { innerHTML: errorMessage, className: 'unsupported' }));
  main.removeChild(startElt);
});
var gifmaker = getGifMaker(WIDTH, HEIGHT, screens, '/js/gif.worker.js');

var startElt = elt('div', { className: 'start' }, main);
startElt.appendChild(elt('p', { textContent: 'please allow access to your camera' }));
var accessButton = domutils.button('begin capture', preview.requestAccess, startElt);

var controls = elt('div', { className: 'controls' }, appElt);

var shotButtonContainer = elt('div', { className: 'shot-button' }, controls);

var currentTimer = null;
var selfTimer = domutils.slider(0, 0, 10, 1, shotButtonContainer, function(input, value) {
  if (currentTimer) currentTimer.cancel();
  this.text.textContent = 'Timer: ' + value + ' seconds';
});

var timerOverlay = (function(){
  var overlay = elt('div', { className: 'timer-on-preview', hidden: true }, appElt);
  return {
    show: function(text, cssClass) {
      overlay.textContent = text;
      overlay.hidden = false;
      if (cssClass) {
        overlay.classList.add(cssClass);
      }
      window.setTimeout(function(){
        overlay.hidden = true;
        if (cssClass) {
          overlay.classList.remove(cssClass);
        }
      }, 50);
    }
  };
})();

var shotAction = function(){
  var text = shotButton.textContent;
  var resetUi = function(){
    shotButton.textContent = text;
    shotButton.disabled = false;
  };
  shotButton.style.width = shotButton.getClientRects()[0].width + 'px'
  shotButton.disabled = true;
  currentTimer = domutils.timer(selfTimer.val()-0, function(delay) {
    timerOverlay.show(delay);
    shotButton.textContent = delay;
  }, function(){
    timerOverlay.show('!', 'photo');
    shot();
    resetUi();
  }, resetUi);
};

var shotButton = button('Photo', shotAction, shotButtonContainer);
document.addEventListener('keypress', function(e){
  if (e.charCode == 32 && !shotButton.disabled) {
    shotAction();
  }
}, false);

var delaySlider = domutils.slider(DELAY, DELAY_MIN, DELAY_MAX, 10, controls, function(input, delay) {
  gifmaker.delay(delay);
}, true);
delaySlider.label.className = 'gif-delay';
delaySlider.text.textContent = 'Animation speed';
delaySlider.label.appendChild(elt('span', { className: 'min', textContent: 'Slow' }));
delaySlider.label.appendChild(elt('span', { className: 'max', textContent: 'Fast' }));

gifmaker.emptyPreview.innerHTML = '← you<br>↙  the button to take photos<br> the animation speed ↓';

// Render GIF
function renderStart() {
  saveButton.disabled = true;
  progress.show('rendering\u2026');
}
function renderEnd() {
  saveButton.disabled = false;
  resetButton.disabled = gifmaker.frames() > 0;
  progress.hide();
}
gifmaker.on('start', renderStart);
gifmaker.on('abort', renderEnd);
gifmaker.on('finished', renderEnd);
gifmaker.on('progress', function(value){
  progress.val(value * 100);
});

var bottomControls = elt('div', { className: 'bottom-controls' }, controls);
var saveButton = button('save', save, bottomControls);
saveButton.disabled = true;

var resetButton = button('reset', function(){
  gifmaker.reset();
  saveButton.disabled = true;
  resetButton.disabled = true;
  if (currentTimer) currentTimer.cancel();
}, bottomControls);
resetButton.disabled = true;

