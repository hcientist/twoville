var editor = ace.edit('editor');
editor.setTheme('ace/theme/twilight');
editor.setOptions({
  fontSize: '14pt',
  tabSize: 2,
  useSoftTabs: true
});
if (localStorage.getItem('src') !== null) {
  editor.setValue(localStorage.getItem('src'), 1);
}
var Range = ace.require('ace/range').Range;

var left = document.getElementById('left');
var messager = document.getElementById('messager');
var messagerContainer = document.getElementById('messagerContainer');
var evalButton = document.getElementById('eval');
var recordButton = document.getElementById('record');
var spinner = document.getElementById('spinner');
var saveButton = document.getElementById('save');
var exportButton = document.getElementById('export');
var svg = document.getElementById('svg');
var scrubber = document.getElementById('scrubber');
var timeSpinner = document.getElementById('timeSpinner');
var playOnceButton = document.getElementById('playOnceButton');
var playLoopButton = document.getElementById('playLoopButton');
var env;

function highlight(lineStart, lineEnd, columnStart, columnEnd) {
  editor.getSelection().setSelectionRange(new Range(lineStart, columnStart, lineEnd, columnEnd + 1));
  editor.centerSelection();
}

function log(text) {
  console.trace("text:", text);
  text = text.replace(/^(-?\d+):(-?\d+):(-?\d+):(-?\d+):/, function(__, lineStart, lineEnd, columnStart, columnEnd) {
    return '<a href="javascript:highlight(' + lineStart + ', ' + lineEnd + ', ' + columnStart + ', ' + columnEnd + ')">Line ' + (parseInt(lineEnd) + 1) + '</a>: '
  });
  messager.innerHTML += text + '<br>';
}

// --------------------------------------------------------------------------- 

function registerResizeListener(bounds, gap, resize) {
  var unlistener = function(event) {
    document.removeEventListener('mousemove', moveListener);
    document.removeEventListener('mouseup', unlistener);
    document.removeEventListener('mousedown', unlistener);
  };
  var moveListener = function(event) {
    event.preventDefault();
    if (event.buttons !== 1) {
      unlistener();
    } else {
      resize(event, bounds, gap);
      editor.resize();
    }
  }
  document.addEventListener('mousemove', moveListener, false);
  document.addEventListener('mouseup', unlistener, false);
  document.addEventListener('mousedown', unlistener, false);
}

function buildResizer(side, element) {
  if (side === 'right') {
    var measureGap = (event, bounds) => event.clientX - bounds.right;
    var resize = (event, bounds, gap) => {
      var bounds = element.getBoundingClientRect();
      var width = event.clientX - bounds.x - gap;
      element.style.width = width + 'px';
    };
  } else if (side === 'left') {
    var measureGap = (event, bounds) => event.clientX - bounds.left;
    var resize = (event, bounds, gap) => {
      var bounds = element.getBoundingClientRect();
      var width = bounds.right - event.clientX - gap;
      element.style.width = width + 'px';
    };
  } else if (side === 'top') {
    var measureGap = (event, bounds) => event.clientY - bounds.top;
    var resize = (event, bounds, gap) => {
      var bounds = messagerContainer.getBoundingClientRect();
      var height = bounds.bottom - event.clientY;
      messagerContainer.style.height = height + 'px';
    };
  } else if (side === 'bottom') {
    var measureGap = (event, bounds) => event.clientY - bounds.bottom;
    var resize = (event, bounds, gap) => {
      var bounds = messagerContainer.getBoundingClientRect();
      var height = bounds.bottom - event.clientY;
      messagerContainer.style.height = height + 'px';
    };
  } else {
    throw 'Resizing ' + side + ' not supported yet.';
  }

  return function(event) {
    if (event.buttons === 1) {
      event.stopPropagation();
      event.preventDefault();
      var bounds = element.getBoundingClientRect();
      var gap = measureGap(event, bounds);
      registerResizeListener(bounds, gap, resize);
    }
  }
}

var directions = {
  horizontal: ['right', 'left'],
  vertical: ['top', 'bottom']
};
for (direction in directions) {
  sides = directions[direction];
  sides.forEach(side => {
    var resizables = document.querySelectorAll('.resizable-' + side);
    resizables.forEach(resizable => {
      var div = document.createElement('div');
      div.classList.add('resizer', 'resizer-' + direction, 'resizer-' + side);
      resizable.appendChild(div);
      div.addEventListener('mousedown', buildResizer(side, resizable));
    });
  });
}

// --------------------------------------------------------------------------- 

function startSpinning() {
  recordButton.disabled = true;
  spinner.style.display = 'block';
}

function stopSpinning() {
  recordButton.disabled = false;
  spinner.style.display = 'none';
}

recordButton.onclick = function() {
  startSpinning();
  var box = svg.getBoundingClientRect();

  // I don't know why I need to set the viewport explicitly. Setting the size
  // of the image isn't sufficient.
  svg.setAttribute('width', box.width);
  svg.setAttribute('height', box.height);

  var gif = new GIF({
    workers: 3,
    quality: 1,
    // transparent: '#000000',
    // background: '#FFFFFF'
    repeat: 0
  });

  gif.on('finished', function(blob) {
    downloadBlob('download.gif', blob);
    stopSpinning();
  });

	function tick(i) {
    try {
      // TODO if looping, go >=, otherwise >
      if (i >= scrubber.max) {
        gif.render();
      } else {
        env.shapes.forEach(shape => shape.draw(env.svg, i));

        var data = new XMLSerializer().serializeToString(svg);
        var svgBlob = new Blob([data], {type: 'image/svg+xml;charset=utf-8'});
        var url = URL.createObjectURL(svgBlob);

        var img = new Image();
        img.onload = function () {
          gif.addFrame(img, {
            delay: 10,
            copy: true
          });
          URL.revokeObjectURL(url);
          tick(i + 1);
        };

        img.src = url;
      }
    } catch (e) {
      stopSpinning();
      throw e;
    }
	}

	tick(parseInt(scrubber.min));
} 

saveButton.onclick = function() {
  localStorage.setItem('src', editor.getValue());
}

function downloadBlob(name, blob) {
  var link = document.createElement('a');
  link.download = name;
  link.href = URL.createObjectURL(blob);
  // Firefox needs the element to be live for some reason.
  document.body.appendChild(link);
  link.click();
  setTimeout(function() {
    URL.revokeObjectURL(link.href);
    document.body.removeChild(link);
  });
}

exportButton.onclick = function() {
  var data = new XMLSerializer().serializeToString(svg);
  var svgBlob = new Blob([data], {type: 'image/svg+xml;charset=utf-8'});
  downloadBlob('download.svg', svgBlob);
}

function scrubTo(t) {
  timeSpinner.value = t;
  scrubber.value = t;
  env.shapes.forEach(shape => shape.draw(env.svg, t));
}

scrubber.oninput = function() {
  scrubTo(scrubber.value);
}

timeSpinner.oninput = function() {
  scrubTo(timeSpinner.value);
}

var animateTask = null;

function animateFrame(i, isLoop = false) {
  scrubTo(i);
  if (i < parseInt(scrubber.max)) {
    animateTask = setTimeout(() => animateFrame(i + 1, isLoop), 100);
  } else if (isLoop) {
    animateTask = setTimeout(() => animateFrame(parseInt(scrubber.min), isLoop), 100);
  } else {
    animateTask = null;
  }
}

playOnceButton.addEventListener('click', e => {
  if (animateTask) {
    clearTimeout(animateTask);
    animateTask = null;
  } else {
    animateFrame(parseInt(scrubber.min), false);
  }
});

playLoopButton.addEventListener('click', e => {
  if (animateTask) {
    clearTimeout(animateTask);
    animateTask = null;
  } else {
    animateFrame(parseInt(scrubber.min), true);
  }
});

evalButton.onclick = function() {
  messager.innerHTML = '';

  while (svg.lastChild) {
    svg.removeChild(svg.lastChild);
  }
  var defs = document.createElementNS(namespace, 'defs');
  svg.appendChild(defs);

  tokens = lex(editor.getValue());
  ast = parse(tokens);

  // tokens.forEach(token => {
    // log(token.where.lineStart + ':' + token.where.lineEnd + ':' + token.where.columnStart + ':' + token.where.columnEnd + '|' + token.source + '<br>');
  // });

  env = TwovilleEnvironment.create({svg: svg, shapes: [], bindings: [], parent: null});
  TwovilleShape.serial = 0;

  env.bindings.t = TwovilleEnvironment.create(env);
  env.bindings.t.bind('start', null, null, TwovilleInteger.create(0));
  env.bindings.t.bind('stop', null, null, TwovilleInteger.create(100));

  env.bindings.viewport = TwovilleEnvironment.create(env);
  env.bindings.viewport.bind('position', null, null, TwovilleVector.create([
    TwovilleInteger.create(0),
    TwovilleInteger.create(0)
  ]));
  env.bindings.viewport.bind('size', null, null, TwovilleVector.create([
    TwovilleInteger.create(100),
    TwovilleInteger.create(100)
  ]));

  env.bindings['rectangle'] = {
    name: 'rectangle',
    formals: [],
    body: ExpressionRectangle.create()
  };

  env.bindings['line'] = {
    name: 'line',
    formals: [],
    body: ExpressionLine.create()
  };

  env.bindings['text'] = {
    name: 'text',
    formals: [],
    body: ExpressionText.create()
  };

  env.bindings['group'] = {
    name: 'group',
    formals: [],
    body: ExpressionGroup.create()
  };

  env.bindings['mask'] = {
    name: 'mask',
    formals: [],
    body: ExpressionMask.create()
  };

  env.bindings['circle'] = {
    name: 'circle',
    formals: [],
    body: ExpressionCircle.create()
  };

  env.bindings['print'] = {
    name: 'print',
    formals: ['message'],
    body: ExpressionPrint.create()
  };

  env.bindings['random'] = {
    name: 'random',
    formals: ['min', 'max'],
    body: ExpressionRandom.create()
  };

  env.bindings['sin'] = {
    name: 'sin',
    formals: ['degrees'],
    body: ExpressionSine.create()
  };

  env.bindings['cos'] = {
    name: 'cos',
    formals: ['degrees'],
    body: ExpressionCosine.create()
  };

  env.bindings['int'] = {
    name: 'int',
    formals: ['x'],
    body: ExpressionInt.create()
  };

  console.log("ast:", ast);
  try {
    ast.evaluate(env);
    console.log("env:", env);

    var dimensions = env.get('viewport').get('size');
    var corner = env.get('viewport').get('position');
    env.svg.setAttributeNS(null, 'width', dimensions.get(0).get());
    env.svg.setAttributeNS(null, 'height', dimensions.get(1).get());
    env.svg.setAttributeNS(null, 'viewBox',
      corner.get(0).get() + ' ' +
      corner.get(1).get() + ' ' + 
      dimensions.get(0).get() + ' ' +
      dimensions.get(1).get()
    );

    env.shapes.forEach(shape => shape.domify(env.svg));

    var tmin = env.get('t').get('start').get();
    var tmax = env.get('t').get('stop').get();
    scrubber.min = tmin;
    scrubber.max = tmax;

    var t = parseFloat(scrubber.value);
    if (t < tmin) {
      scrubTo(tmin);
    } else if (t > tmax) {
      scrubTo(tmax);
    } else {
      scrubTo(t);
    }

    recordButton.disabled = false;
  } catch (e) {
    log(e);
  }
}
