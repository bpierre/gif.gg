module.exports = {
  requestAnimationFrame: window.requestAnimationFrame       ||
                         window.webkitRequestAnimationFrame ||
                         window.mozRequestAnimationFrame    ||
                         window.oRequestAnimationFrame      ||
                         window.msRequestAnimationFrame     ||
                         function(callback) {
                           window.setTimeout(callback, 1000 / 60);
                         },
  getUserMedia: navigator.getUserMedia       ||
                navigator.webkitGetUserMedia ||
                navigator.mozGetUserMedia    ||
                navigator.msGetUserMedia,
  URL: window.URL || window.webkitURL,
};
