var domutils = require('./domutils');
var compat = require('./compat');
var URL = compat.URL;
var elt = domutils.elt;

module.exports = function getPreview(width, height, container, waitCb, startCb, errorCb) {
  var camVideo = elt('video', {
    width: width,
    height: height,
    autoplay: true,
    hidden: true
  }, container);

  var camCanv = elt('canvas', {
    width: width,
    height: height,
    className: 'cam-preview'
  }, container);

  var camCtx = camCanv.getContext('2d');
  camCtx.translate(320, 0);
  camCtx.scale(-1, 1);

  var isPlaying = false;
  function drawCam() {
    compat.requestAnimationFrame.call(window, drawCam);
    if (!isPlaying && camVideo.videoWidth) {
      isPlaying = true;
      startCb();
    }
    try {
      camCtx.drawImage(camVideo, 0, 0, width, height);
    } catch (e) {
      if (e.name != 'NS_ERROR_NOT_AVAILABLE') {
        throw e;
      }
    }
  }
  camVideo.addEventListener('loadeddata', drawCam, false);

  function requestAccess() {
    domutils.getCam(function(stream) {
      waitCb();
      camVideo.src = URL.createObjectURL(stream);
    }, function(error) {
      if (error !== 'PERMISSION_DENIED') {
        errorCb();
      }
    });
  }
  requestAccess();

  return {
    getImage: function(cb) {
      var img = new Image();
      img.addEventListener('load', function(){
        cb(img);
      }, false);
      img.src = camCanv.toDataURL();
    },
    requestAccess: requestAccess
  };
};
