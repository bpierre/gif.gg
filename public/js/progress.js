var domutils = require('./domutils');

module.exports = function progress(min, max, container) {
  var div = domutils.elt('div', { className: 'progress' });
  var elt = domutils.elt('progress');
  var label = domutils.elt('label');
  elt.min = min;
  elt.max = max;
  div.hidden = true;
  div.appendChild(label);
  div.appendChild(elt);
  container.appendChild(div);
  return {
    val: function(value) {
      if (value === undefined) {
        return elt.value;
      } else if (value === false) {
        elt.removeAttribute('value');
      } else {
        elt.value = value;
        elt.textContent = value + ' / ' + max;
      }
    },
    hide: function() {
      div.hidden = true;
    },
    show: function(msg) {
      if (msg) {
        label.textContent = msg;
      }
      div.hidden = false;
    }
  };
};

