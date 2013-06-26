var compat = require('./compat');

function getCam(success, error) {
  if (!compat.getUserMedia) return error();
  compat.getUserMedia.call(navigator, {
    video: true,
    audio: false
  }, success, error);
}

function elt(name, props, container) {
  var elt = window.document.createElement(name);
  if (props) {
    for (var i in props) elt[i] = props[i];
  }
  if (container) {
    container.appendChild(elt);
  }
  return elt;
}

function insertAfter(parentElt, elt, referenceElt) {
  return parentElt.insertBefore(elt, referenceElt.nextSibling);
}

function slider(value, min, max, step, container, cb, reverse) {
  var label = elt('label');
  var text = elt('span');
  var input = elt('input');
  var revert = function(value) {
    return (value - max - min) * -1;
  };
  var prepareValue = function(value) {
    if (reverse) return revert(value);
    return value;
  };
  var currentValue = value;
  input.type = 'range';
  input.max = max;
  input.min = min;
  input.step = step;
  label.appendChild(text);
  label.appendChild(elt('br'));
  label.appendChild(input);
  container.appendChild(label);
  var slider = {
    val: function(value) {
      if (value !== undefined) {
        currentValue = value;
        input.value = prepareValue(value);
      }
      return currentValue;
    },
    label: label,
    input: input,
    text: text
  };
  if (cb) {
    input.addEventListener('input', function(e){
      var val = prepareValue(input.value);
      if (currentValue !== val) {
        cb.call(slider, input, val);
      }
      currentValue = val;
    });
    cb.call(slider, input, currentValue);
  }
  slider.val(value);
  return slider;
}

function button(label, cb, container, props) {
  if (!props) props = {};
  props.type = 'button';
  props.textContent = label;
  var button = elt('button', props, container);
  button.addEventListener('click', cb);
  return button;
}

function timer(delay, tickCb, endCb, cancelCb) {
  var timeout = 0;
  var tick = function(){
    if (delay > 0) {
      timeout = window.setTimeout(tick, 1000);
      tickCb(delay--);
    } else {
      endCb();
    }
  };
  tick();
  return {
    cancel: function(){
      window.clearTimeout(timeout);
      cancelCb();
    }
  };
}

module.exports = {
  getCam: getCam,
  elt: elt,
  insertAfter: insertAfter,
  slider: slider,
  button: button,
  timer: timer
};

