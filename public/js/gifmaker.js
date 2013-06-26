var EventEmitter = require('events').EventEmitter;
var GIF = require('./gif').GIF;
var domutils = require('./domutils');
var compat = require('./compat');
var URL = compat.URL;

module.exports = function gifMaker(width, height, container, workerScript) {
  var gif = getGif();
  var preview = domutils.elt('img', { className: 'gif-preview' }, container);
  var emptyPreview = domutils.elt('div', { className: 'gif-preview empty' }, container);
  var delay = 500;
  var blob = null;
  var gifmaker = Object.create(EventEmitter.prototype);
  var lastObjectURL = null;
  var newPreview;

  // This prevents an image freeze occuring sometimes
  // in Firefox 23, when we just update the image.src
  function updateSrc(src) {
    if (newPreview) newPreview.onload = null;
    newPreview = new Image();
    newPreview.className = 'gif-preview';
    newPreview.onload = function(){
      container.replaceChild(newPreview, preview);
      preview = newPreview;
    };
    newPreview.src = src;
  }
  
  function finished(bl) {
    blob = bl;
    if (lastObjectURL !== null) {
      URL.revokeObjectURL(lastObjectURL);
    }
    lastObjectURL = URL.createObjectURL(blob);
    updateSrc(lastObjectURL);
    gifmaker.emit('finished');
  }
  function updateDelay(delay) {
    for (var i = 0, l = gif.frames.length; i < l; i ++) {
      gif.frames[i].delay = delay;
    }
  }
  function getGif() {
    var g = new GIF({
      workerScript: workerScript,
      quality: 10,
      width: width,
      height: height
    });
    g.on('finished', finished);
    g.on('abort', function(){ gifmaker.emit('abort'); });
    g.on('start', function(){ gifmaker.emit('start'); });
    g.on('progress', function(progress) {
      gifmaker.emit('progress', progress);
    });
    return g;
  }

  preview.hidden = true;
  preview.width = width;
  preview.height = height;

  gifmaker.addFrame = function(img) {
    preview.hidden = false;
    emptyPreview.hidden = true;
    gif.addFrame(img);
    updateDelay(delay);
    if (gif.running) gif.abort();
    gif.render();
  };
  gifmaker.delay = function(newDelay) {
    updateDelay(delay = newDelay);
    if (gif.running) gif.abort();
    if (gif.frames.length) gif.render();
  };
  gifmaker.reset = function(){
    preview.src = '';
    preview.hidden = true;
    emptyPreview.hidden = false;
    if (gif.running) gif.abort();
    blob = null;
    gif = getGif();
  };
  gifmaker.blob = function(){
    return blob;
  };
  gifmaker.frames = function(){
    return gif.frames;
  };
  gifmaker.emptyPreview = emptyPreview;

  return gifmaker;
};

