import ace from 'ace-builds/src-min-noconflict/ace';
import 'ace-builds/src-min-noconflict/theme-twilight';
import './mode-twoville.js';
import JSZip from 'jszip';
import GIF from 'gif.js';

import {
  clearChildren,
  MessagedException,
} from './common.js';

import {
  RenderEnvironment,
} from './render.js';

import {
  interpret,
} from './interpreter.js';

import {
  Messager
} from './messager.js';

import Interpreter from './interpreter.worker.js';

const hasWorker = true;

let editor;
let docEditors = [];
let Range;
let left;
let right;
let messagerContainer;
let evaluateButton;
let recordGifButton;
let recordFramesButton;
let exportButton;
let fitButton;
let stopButton;
let settingsRoot;
let playOnceButton;
let playLoopButton;
let saveDirtyButton;
let saveCleanButton;
let recordSpinner;
let spinner;
let scrubber;
let timeSpinner;
let interpreterWorker;
let contentCornerBox;
let contentSizeBox;

let defaultSettings = {
  showCopyLinks: true,
  backgroundColor: '#FF0000',
};
const settings = {...defaultSettings};

let scene;
let isSaved = true;
let animateTask = null;
let delay;

function highlight(lineStart, lineEnd, columnStart, columnEnd) {
  editor.getSelection().setSelectionRange(new Range(lineStart, columnStart, lineEnd, columnEnd + 1));
  editor.centerSelection();
}

// --------------------------------------------------------------------------- 

function startSpinning() {
  spinner.style.display = 'block';
}

function stopSpinning() {
  spinner.style.display = 'none';
}

function downloadBlob(name, blob) {
  let link = document.createElement('a');
  link.download = name;
  link.href = URL.createObjectURL(blob);
  // Firefox needs the element to be live for some reason.
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    document.body.removeChild(link);
  });
}

function downloadDataUrl(name, url) {
  let link = document.createElement('a');
  link.download = name;
  link.href = url;
  // Firefox needs the element to be live for some reason.
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    document.body.removeChild(link);
  });
}

export function exportSvgWithMarks() {
  serializeThenDownload(scene.svg);
}

export function exportSvgWithoutMarks() {
  const clone = scene.cloneSvgWithoutMarks();
  serializeThenDownload(clone);
}

function serializeThenDownload(root) {
  let data = new XMLSerializer().serializeToString(root);
  let svgBlob = new Blob([data], {type: 'image/svg+xml;charset=utf-8'});
  downloadBlob('download.svg', svgBlob);
}

function scrubTo(tick) {
  let t = scene.tickToTime(tick);
  timeSpinner.value = t;
  scrubber.value = tick;
  scene.scrub(t);

  contentCornerBox.innerText = `[${scene.box.min[0].toShortFloat(2)}, ${scene.box.min[1].toShortFloat(2)}]`;
  contentSizeBox.innerText = `[${(scene.box.max[0] - scene.box.min[0]).toShortFloat(2)}, ${(scene.box.max[1] - scene.box.min[1]).toShortFloat(2)}]`;
}

let lastMillis = null;

function animateFrame(i, isLoop, delay) {
  scrubTo(i);

  const nowMillis = new Date().getTime();
  const elapsedMillis = nowMillis - lastMillis;
  const leftMillis = Math.max(0, delay - elapsedMillis);
  lastMillis = nowMillis;

  if (i < parseInt(scrubber.max)) {
    animateTask = setTimeout(() => animateFrame(i + 1, isLoop, delay), leftMillis);
  } else if (isLoop) {
    animateTask = setTimeout(() => animateFrame(parseInt(scrubber.min), isLoop, delay), leftMillis);
  } else {
    animateTask = null;
  }
}

function stopAnimation() {
  if (animateTask) {
    clearTimeout(animateTask);
    animateTask = null;
  }
}

function play(isLoop) {
  stopAnimation();
  const time = scene.get('time');
  const delay = time.get('delay').value * 1000;
  lastMillis = new Date().getTime();
  animateFrame(0, isLoop, delay);
}

function stopInterpreting() {
  if (interpreterWorker) {
    interpreterWorker.terminate();
    interpreterWorker = undefined;
  }
  stopButton.classList.add('hidden');
  evaluateButton.classList.remove('hidden');
  stopSpinning();
}

function postInterpret(pod, successCallback) {
  const oldScene = scene;
  if (oldScene) {
    oldScene.stop();
  }
  scene = RenderEnvironment.reify(document.getElementById('svg'), pod);

  let hasTweak;

  scene.startTweak = where => {
    highlight(where.lineStart, where.lineEnd, where.columnStart, where.columnEnd);
    hasTweak = false;
    document.documentElement.classList.remove('grab');
    document.documentElement.classList.add('grabbing');
  };

  scene.tweak = newText => {
    // Ace doesn't have a way to do atomic group of changes, which is what I want
    // for handler events. We work around this by undoing before each tweak.
    if (hasTweak) {
      editor.undo();
      hasTweak = false;
    }

    let range = editor.getSelectionRange();
    let doc = editor.getSession().getDocument();

    let oldText = doc.getTextRange(range);
    if (oldText != newText) {
      doc.replace(range, newText);
      hasTweak = true;
    }

    range.setEnd(range.end.row, range.start.column + newText.length);
    editor.getSelection().setSelectionRange(range);

    let t = scene.tickToTime(parseInt(scrubber.value));
    scene.scrub(t);
  };

  scene.stopTweak = () => {
    hasTweak = false;
    startInterpreting();
    document.documentElement.classList.remove('grabbing');
  };

  try {
    scene.clear();
    scene.start();

    scrubber.min = 0;
    scrubber.max = scene.nTicks;
    timeSpinner.max = scene.nTicks;

    let t = scene.getTime(parseInt(scrubber.value));
    if (t < scene.tmin) {
      scrubTo(0);
    } else if (t > scene.tmax) {
      scrubTo((scene.tmax - scene.tmin) * scene.resolution);
    } else {
      scrubTo(parseInt(scrubber.value));
    }

    if (oldScene) {
      if (oldScene.selectedShape) {
        scene.reselect(oldScene.selectedShape);
      }
      scene.rebound(oldScene.bounds);
    }

    recordGifButton.disabled = false;
    recordFramesButton.disabled = false;
    if (successCallback) {
      successCallback();
    }
  } catch (e) {
    if (e instanceof MessagedException) {
      Messager.log(e.userMessage);

      // The scene must be wiped. Otherwise the bounds tracked between runs get
      // messed up.
      scene = null;

      throw e;
    } else {
      console.trace(e);
      Messager.log(e.message);
      scene = null;
    }
  }
}

function startInterpreting(successCallback) {
  stopInterpreting();

  startSpinning();
  stopButton.classList.remove('hidden');
  evaluateButton.classList.add('hidden');

  Messager.clear();

  if (hasWorker) {
    interpreterWorker = new Interpreter();
    interpreterWorker.addEventListener('message', event => {
      if (event.data.type === 'output') {
        Messager.log(event.data.payload);
      } else if (event.data.type === 'environment') {
        stopInterpreting();
        postInterpret(event.data.payload, successCallback);
      } else if (event.data.type === 'error') {
        stopInterpreting();
      }
    });

    interpreterWorker.postMessage({
      command: 'interpret',
      source: editor.getValue(),
    });
  } else {
    const scene = interpret(editor.getValue(), Messager.log);
    stopInterpreting();
    if (scene) {
      postInterpret(scene.toPod(), successCallback);
    }
  }
}

function onSourceChanged() {
  // If the source was changed through the text editor, but not through the
  // canvas, the marks are no longer valid.
  if (scene) {
    scene.stale();
  }
  // clearSelection();
  isSaved = false;
  syncTitle();
}

function syncTitle() {
  document.title = 'Twoville' + (isSaved ? '' : '*');
  saveDirtyButton.style.display = isSaved ? 'none' : 'block';
  saveCleanButton.style.display = isSaved ? 'block' : 'none';
}

// Keep scrolling from bubbling up to parent when embedded.
document.getElementById('middle').addEventListener('wheel', e => {
  e.preventDefault();
}, {passive: false});

function save() {
  if (isEmbedded) return;
  localStorage.setItem('src', editor.getValue());
  isSaved = true;
  syncTitle();
}

function initialize() {
  editor = ace.edit('editor');
  editor.setTheme('ace/theme/twilight');
  editor.setOptions({
    fontFamily: 'Roboto Mono',
    fontSize: source0 ? '10pt' : '14pt',
    tabSize: 2,
    useSoftTabs: true
  });

  Range = ace.require('ace/range').Range;

  left = document.getElementById('left');
  right = document.getElementById('right');
  messagerContainer = document.getElementById('messager-container');
  evaluateButton = document.getElementById('evaluate-button');
  recordGifButton = document.getElementById('record-gif-button');
  recordFramesButton = document.getElementById('record-frames-button');
  exportButton = document.getElementById('export-button');
  fitButton = document.getElementById('fit-button');
  stopButton = document.getElementById('stop-button');
  playOnceButton = document.getElementById('play-once-button');
  playLoopButton = document.getElementById('play-loop-button');
  saveDirtyButton = document.getElementById('save-dirty-button');
  saveCleanButton = document.getElementById('save-clean-button');
  spinner = document.getElementById('spinner');
  scrubber = document.getElementById('scrubber');
  timeSpinner = document.getElementById('time-spinner');
  contentCornerBox = document.getElementById('content-corner-box');
  contentSizeBox = document.getElementById('content-size-box');
  const svg = document.getElementById('svg');
  new Messager(document.getElementById('messager'), document, highlight);

  let savedSettings = {};

  if (!isEmbedded) {
    const json = localStorage.getItem('twoville-settings');
    if (json) {
      savedSettings = JSON.parse(json);
      Object.assign(settings, savedSettings);
    }
  }

  const saveSettings = () => {
    if (!isEmbedded) {
      localStorage.setItem('twoville-settings', JSON.stringify(savedSettings));
    }
  };

  // Handle show copy links toggling.
  const showCopyLinksToggle = document.getElementById('show-copy-links-toggle');
  showCopyLinksToggle.checked = settings.showCopyLinks;
  showCopyLinksToggle.addEventListener('click', () => {
    settings.showCopyLinks = savedSettings.showCopyLinks = showCopyLinksToggle.checked;
    saveSettings();
  });

  // Handle background color picking.
  const backgroundColorPicker = document.getElementById('background-color-picker');
  const backgroundColorPreview = document.getElementById('background-color-preview');

  backgroundColorPicker.value = settings.backgroundColor;
  svg.style.backgroundColor = settings.backgroundColor; 
  backgroundColorPreview.style['background-color'] = settings.backgroundColor;
  backgroundColorPicker.addEventListener('input', () => {
    settings.backgroundColor = savedSettings.backgroundColor = backgroundColorPicker.value;
    backgroundColorPreview.style['background-color'] = settings.backgroundColor;
    svg.style.backgroundColor = settings.backgroundColor; 
    saveSettings();
  });

  const dialogOverlay = document.getElementById('dialog-overlay');

  // Handle open dialog.
  const openButton = document.getElementById('open-button');
  const openCancelButton = document.getElementById('open-cancel-button');
  const openDialog = document.getElementById('open-dialog');
  const openDialogFileList = document.getElementById('open-dialog-files-list');

  function closeOpenDialog() {
    dialogOverlay.style.display = 'none';
    openDialog.style.display = 'none';
    document.removeEventListener('keydown', openEscapeListener);
  }

  function openEscapeListener(event) {
    if (event.key === 'Escape') {
      closeOpenDialog();
    }
  }

  function loadFile(event) {
    const name = event.target.innerText; 
    const twos = JSON.parse(localStorage.getItem('twos')); 
    const file = twos[name];
    editor.setValue(file.source, 1);
    closeOpenDialog();
  }

  const alertDialog = document.getElementById('alert-dialog');
  const alertDialogHeadingField = document.getElementById('alert-dialog-heading-field');
  const alertDialogMessageField = document.getElementById('alert-dialog-message-field');
  const alertDialogOkayButton = document.getElementById('alert-dialog-okay-button');

  function alertEscapeListener(event) {
    if (event.key === 'Escape') {
      closeAlertDialog();
    }
  }

  function showAlertDialog(heading, message) {
    alertDialog.style.display = 'flex';
    dialogOverlay.style.display = 'flex';
    alertDialogHeadingField.innerText = heading;
    alertDialogMessageField.innerText = message;
    document.addEventListener('keydown', alertEscapeListener);
  }

  function closeAlertDialog() {
    alertDialog.style.display = 'none';
    dialogOverlay.style.display = 'none';
    document.removeEventListener('keydown', alertEscapeListener);
  }

  alertDialogOkayButton.addEventListener('click', closeAlertDialog);

  openButton.addEventListener('click', () => {
    const twos = JSON.parse(localStorage.getItem('twos')) ?? {}; 
    const names = Object.keys(twos);

    if (names.length === 0) {
      showAlertDialog('No Files', 'There are no programs available to open. Try saving one first.');
    } else {
      dialogOverlay.style.display = 'flex';
      openDialog.style.display = 'flex';
      clearChildren(openDialogFileList);

      for (let name of Object.keys(twos)) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.classList.add('link-button');
        button.appendChild(document.createTextNode(name));
        button.addEventListener('click', loadFile);
        li.appendChild(button);
        openDialogFileList.appendChild(li);
      }

      document.addEventListener('keydown', openEscapeListener);
    }
  });

  openCancelButton.addEventListener('click', closeOpenDialog);

  // Handle save as dialog.
  const saveAsButton = document.getElementById('save-as-button');
  const saveAsCancelButton = document.getElementById('save-as-cancel-button');
  const saveAsOkayButton = document.getElementById('save-as-okay-button');
  const saveAsDialog = document.getElementById('save-as-dialog');
  const saveAsFileNameInput = document.getElementById('save-as-file-name-input');
  const saveAsErrorBox = document.getElementById('save-as-error-box');

  function closeSaveAsDialog() {
    dialogOverlay.style.display = 'none';
    saveAsDialog.style.display = 'none';
    document.removeEventListener('keydown', saveAsEscapeListener);
  }

  function saveAsEscapeListener(event) {
    if (event.key === 'Escape') {
      closeSaveAsDialog();
    }
  }

  function showSaveAsDialog() {
    saveAsErrorBox.style.display = 'none';
    dialogOverlay.style.display = 'flex';
    saveAsDialog.style.display = 'flex';
    saveAsFileNameInput.focus();
    document.addEventListener('keydown', saveAsEscapeListener);
  }

  saveAsButton.addEventListener('click', () => {
    saveAsFileNameInput.value = ''; // TODO use existing
    showSaveAsDialog();
  });
  saveAsCancelButton.addEventListener('click', closeSaveAsDialog);

  function reallySaveAs() {
    const name = saveAsFileNameInput.value;
    const twos = JSON.parse(localStorage.getItem('twos')) ?? {}; 
    const now = new Date().getTime();
    twos[name] = {
      createdAt: now,
      ...twos[name],
      modifiedAt: now,
      source: editor.getValue(),
    };
    localStorage.setItem('twos', JSON.stringify(twos));
  }

  function trySaveAs() {
    const name = saveAsFileNameInput.value;
    if (name.match(/^\s*$/)) {
      saveAsErrorBox.innerText = `The name "${name}" is not valid. Try something different.`;
      saveAsErrorBox.style.display = 'block';
    } else {
      const twos = JSON.parse(localStorage.getItem('twos')) ?? {}; 
      closeSaveAsDialog();
      if (twos.hasOwnProperty(name)) {
        showOverwriteDialog(name);
      } else {
        reallySaveAs();
      }
    }
  }

  saveAsOkayButton.addEventListener('click', trySaveAs);
  saveAsFileNameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      trySaveAs();
    }
  });

  // Handle overwrite dialog.
  const overwriteDialog = document.getElementById('overwrite-dialog');
  const overwriteNameField = document.getElementById('overwrite-name-field');
  const overwriteCancelButton = document.getElementById('overwrite-cancel-button');
  const overwriteOkayButton = document.getElementById('overwrite-okay-button');

  function showOverwriteDialog(name) {
    dialogOverlay.style.display = 'flex';
    overwriteDialog.style.display = 'flex';
    overwriteNameField.innerText = name;
    document.addEventListener('keydown', overwriteEscapeListener);
  }

  function closeOverwriteDialog() {
    overwriteDialog.style.display = 'none';
    document.removeEventListener('keydown', overwriteEscapeListener);
    showSaveAsDialog(); 
  }

  function overwriteEscapeListener(event) {
    if (event.key === 'Escape') {
      closeOverwriteDialog();
    }
  }

  overwriteCancelButton.addEventListener('click', closeOverwriteDialog);
  overwriteOkayButton.addEventListener('click', () => {
    reallySaveAs();
    overwriteDialog.style.display = 'none';
    dialogOverlay.style.display = 'none';
  });

  if (source0) {
    editor.setValue(source0, 1);
  } else if (!isEmbedded && localStorage.getItem('src') !== null) {
    editor.setValue(localStorage.getItem('src'), 1);
  }

  editor.getSession().on('change', onSourceChanged);
  editor.getSession().setMode("ace/mode/twoville");
  editor.getSession().selection.on('changeCursor', () => {
    if (scene) {
      const cursor = editor.getCursorPosition();
      scene.castCursor(cursor.column, cursor.row);
    }
  });

  recordGifButton.addEventListener('click', () => {
    startSpinning();
    let box = scene.svg.getBoundingClientRect();

    scene.hideMarks();

    let size = scene.get('gif').get('size');
    let transparentColor = scene.get('gif').get('transparency');
    let name = scene.get('gif').get('name');
    let loop = scene.get('gif').get('loop');
    let skip = scene.get('gif').get('skip');
    let backgroundColor = scene.get('gif').get('background').toHexColor();

    const time = scene.get('time');
    let delay = time.get('delay').value * 1000;
    delay = Math.max(20, delay);

    // I don't know why I need to set the viewport explicitly. Setting the size
    // of the image isn't sufficient.
    scene.svg.setAttribute('width', size.get(0).value);
    scene.svg.setAttribute('height', size.get(1).value);

    let gif = new GIF({
      workers: 3,
      quality: 1,
      background: backgroundColor,
      transparent: null,
      repeat: loop.value,
      width: size.get(0).value,
      height: size.get(1).value,
    });

    gif.on('finished', (blob) => {
      downloadBlob(name.value, blob);
      stopSpinning();
    });

    function tick(i) {
      try {
        // TODO if looping, go >=, otherwise >
        if (i >= scrubber.max) {
          gif.render();
        } else {
          scene.scrub(i);

          let data = new XMLSerializer().serializeToString(scene.cloneSvgWithoutMarks());
          let svgBlob = new Blob([data], {type: 'image/svg+xml;charset=utf-8'});
          let url = URL.createObjectURL(svgBlob);

          let img = new Image(size.get(0).value, size.get(1).value);
          img.onload = () => {
            gif.addFrame(img, {
              delay: delay,
              copy: true,
            });

            URL.revokeObjectURL(url);
            tick(i + skip.value);
          };

          img.src = url;

          // settingsRoot.appendChild(img);
        }
      } catch (e) {
        stopSpinning();
        throw e;
      }
    }

    tick(parseInt(scrubber.min));
  });

  recordFramesButton.addEventListener('click', () => {
    startSpinning();
    let box = scene.svg.getBoundingClientRect();

    scene.hideMarks();

    let size = scene.get('gif').get('size');
    let name = scene.get('gif').get('name');

    const time = scene.get('time');
    let delay = time.get('delay').value * 1000;
    delay = Math.max(20, delay);

    // I don't know why I need to set the viewport explicitly. Setting the size
    // of the image isn't sufficient.
    scene.svg.setAttribute('width', size.get(0).value);
    scene.svg.setAttribute('height', size.get(1).value);

    // gif.on('finished', (blob) => {
      // downloadBlob(name.value, blob);
      // stopSpinning();
    // });

    const pngUrls = [];
    const zip = new JSZip();

    function tick(i) {
      try {
        if (i >= scrubber.max) {
          zip.generateAsync({type: 'blob'})
            .then(blob => downloadBlob(`${name.value}.zip`, blob));
        } else {
          scene.scrub(i);

          let data = new XMLSerializer().serializeToString(scene.cloneSvgWithoutMarks());
          let svgBlob = new Blob([data], {type: 'image/svg+xml;charset=utf-8'});
          let url = URL.createObjectURL(svgBlob);

          let img = new Image(size.get(0).value, size.get(1).value);
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = size.get(0).value;
            canvas.height = size.get(1).value;
            const context = canvas.getContext('2d');
            context.drawImage(img, 0, 0);
            canvas.toBlob(blob => {
              zip.file(`${name.value}-${('' + i).padStart(3, '0')}.png`, blob);
              URL.revokeObjectURL(url);
              tick(i + 1);
            }, 'image/png');
          };

          img.src = url;
        }
      } catch (e) {
        stopSpinning();
        throw e;
      }
    }

    tick(parseInt(scrubber.min));
  });

  saveDirtyButton.addEventListener('click', save);
  saveCleanButton.addEventListener('click', save);

  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      save();
      event.preventDefault();
      return false;
    } else {
      return true;
    }
  });

  exportButton.addEventListener('click', exportSvgWithoutMarks);

  fitButton.addEventListener('click', () => {
    if (scene) scene.fit();
  });

  scrubber.addEventListener('input', () => {
    stopAnimation();
    scrubTo(parseInt(scrubber.value));
  });

  timeSpinner.addEventListener('input', () => {
    stopAnimation();
    let tick = timeToTick(parseFloat(timeSpinner.value));
    scrubTo(tick);
  });

  playOnceButton.addEventListener('click', (e) => {
    play(false);
  });

  playLoopButton.addEventListener('click', e => {
    if (animateTask) {
      stopAnimation();
    } else {
      play(true);
    }
  });

  stopButton.addEventListener('click', e => {
    stopInterpreting();
  });

  evaluateButton.addEventListener('click', () => {
    startInterpreting();
  });

  if (source0) {
    left.style.width = '300px';
    messagerContainer.style.height = '50px';
    editor.resize();

    if (runZeroMode) {
      startInterpreting(() => {
        if (runZeroMode == 'loop') {
          play(true);
        }
      });
    }
  }

  const generateHeightResizer = resizer => {
    const onMouseMove = e => {
      const parentPanel = resizer.parentNode;
      const bounds = resizer.parentNode.getBoundingClientRect();
      const relativeY = e.clientY - bounds.y;
      parentPanel.children[0].style['height'] = `${relativeY - 4}px`;
      parentPanel.children[2].style['height'] = `${bounds.height - (relativeY + 4)}px`;
      editor.resize();
      e.preventDefault();
    };

    const onMouseDown = e => {
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', () => {
        document.removeEventListener('mousemove', onMouseMove);
      });
      e.preventDefault();
    };

    return onMouseDown;
  }

  // const generateWidthResizer = resizer => {
    // const onMouseMove = e => {
      // const parentPanel = resizer.parentNode;
      // const bounds = resizer.parentNode.getBoundingClientRect();
      // const relativeX = e.clientX - bounds.x;
      // parentPanel.children[0].style['width'] = `${relativeX - 4}px`;
      // parentPanel.children[2].style['width'] = `${bounds.height - (relativeX + 4)}px`;
      // editor.resize();

      // if (!isEmbedded) {
        // localStorage.setItem('left-width', parentPanel.children[0].style.width);
      // }

      // e.preventDefault();
    // };

    // const onMouseDown = e => {
      // document.addEventListener('mousemove', onMouseMove);
      // document.addEventListener('mouseup', () => {
        // document.removeEventListener('mousemove', onMouseMove);
      // });
      // e.preventDefault();
    // };

    // return onMouseDown;
  // }

  const generateLeftResizer = (resizer, i) => {
    const onMouseMove = e => {
      const parentPanel = resizer.parentNode;
      const bounds = parentPanel.children[i - 1].getBoundingClientRect();
      const newWidth = e.clientX - 4 - bounds.x;

      parentPanel.children[i - 1].style['width'] = `${newWidth}px`;

      editor.resize();
      if (!isEmbedded) {
        localStorage.setItem('left-width', parentPanel.children[i - 1].style.width);
      }
      // resizeWindow();
      editor.resize();

      e.preventDefault();
    };

    const onMouseDown = e => {
      const parentPanel = resizer.parentNode;
      const style = window.getComputedStyle(parentPanel.children[4]);
      const originalMinWidth = style['min-width'];
      parentPanel.children[4].style['min-width'] = style['width'];

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', () => {
        parentPanel.children[4].style['min-width'] = originalMinWidth;
        document.removeEventListener('mousemove', onMouseMove);
      });
      e.preventDefault();
    };

    return onMouseDown;
  };

  const generateRightResizer = (resizer, i) => {
    const onMouseMove = e => {
      const parentPanel = resizer.parentNode;
      const bounds = parentPanel.children[i + 1].getBoundingClientRect();

      if (!isEmbedded) {
        localStorage.setItem('right-width', parentPanel.children[i + 1].style.width);
      }
      // resizeWindow();
      editor.resize();
      for (let docEditor of docEditors) {
        docEditor.resize();
      }
  
      const newWidth = bounds.right - e.clientX + 4;
      parentPanel.children[i + 1].style['width'] = `${newWidth}px`;

      // resizeWindow();
      e.preventDefault();
    };

    const onMouseDown = e => {
      const parentPanel = resizer.parentNode;
      const style = window.getComputedStyle(parentPanel.children[0]);
      const originalMinWidth = style['min-width'];
      parentPanel.children[0].style['min-width'] = style['width'];

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', () => {
        parentPanel.children[0].style['min-width'] = originalMinWidth;
        document.removeEventListener('mousemove', onMouseMove);
      });
      e.preventDefault();
    };

    return onMouseDown;
  };

  const editorMessagerResizer = document.getElementById('editor-messager-resizer');
  editorMessagerResizer.addEventListener('mousedown', generateHeightResizer(editorMessagerResizer)); 

  const settingsDocsResizer = document.getElementById('settings-docs-resizer');
  settingsDocsResizer.addEventListener('mousedown', generateHeightResizer(settingsDocsResizer)); 

  const leftMiddleResizer = document.getElementById('left-middle-resizer');
  leftMiddleResizer.addEventListener('mousedown', generateLeftResizer(leftMiddleResizer, 1)); 

  const middleRightResizer = document.getElementById('middle-right-resizer');
  middleRightResizer.addEventListener('mousedown', generateRightResizer(middleRightResizer, 3));

  const openPanelButton = document.getElementById('open-panel-button');
  const closePanelButton = document.getElementById('close-panel-button');
  const panel = document.getElementById('right');

  settingsRoot = document.getElementById('settings-root');

  const targetMillis = 300;

  // Restore editor width from last time, unless we're embedded.
  if (!isEmbedded) {
    const leftWidth0 = localStorage.getItem('left-width');
    if (leftWidth0) {
      left.style['width'] = leftWidth0;
    }

    const isPanelOpen = localStorage.getItem('is-panel-open') === 'true';
    if (isPanelOpen) {
      right.style.display = 'flex';
      middleRightResizer.style.display = 'block';
      closePanelButton.style.display = 'block';
      openPanelButton.style.display = 'none';
    }

    const rightWidth0 = localStorage.getItem('right-width');
    if (rightWidth0) {
      right.style['width'] = rightWidth0;
    }
  }

  openPanelButton.addEventListener('click', () => {
    if (!isEmbedded) {
      localStorage.setItem('is-panel-open', true);
    }
    openPanelButton.style.display = 'none';

    panel.style.display = 'flex';
    const bounds = panel.getBoundingClientRect(); 

    const startValue = bounds.right;
    const endValue = bounds.x;
    const startMillis = new Date().getTime();

    panel.style.position = 'absolute';
    panel.style.top = '0';
    panel.style.bottom = '0';

    const animation = () => {
      const currentMillis = new Date().getTime();
      const elapsedMillis = currentMillis - startMillis;

      if (elapsedMillis <= targetMillis) {
        const proportion = elapsedMillis / targetMillis;
        const value = startValue + (endValue - startValue) * proportion;
        panel.style.left = `${value}px`;
        requestAnimationFrame(animation);
      } else {
        panel.style.left = `${endValue}px`;
        panel.style.position = 'static';
        middleRightResizer.style.display = 'block';
        closePanelButton.style.display = 'block';
      }

      // resizeWindow();
    };

    animation();
  });

  closePanelButton.addEventListener('click', () => {
    if (!isEmbedded) {
      localStorage.setItem('is-panel-open', false);
    }
    closePanelButton.style.display = 'none';
    middleRightResizer.style.display = 'none';

    const bounds = panel.getBoundingClientRect(); 

    const startValue = bounds.left;
    const endValue = bounds.right;
    const startMillis = new Date().getTime();

    panel.style.position = 'absolute';
    panel.style.top = '0';
    panel.style.bottom = '0';

    const animation = () => {
      const currentMillis = new Date().getTime();
      const elapsedMillis = currentMillis - startMillis;

      if (elapsedMillis <= targetMillis) {
        const proportion = elapsedMillis / targetMillis;
        const value = startValue + (endValue - startValue) * proportion;
        panel.style.left = `${value}px`;
        requestAnimationFrame(animation);
      } else {
        panel.style.position = 'static';
        panel.style.display = 'none';
        openPanelButton.style.display = 'block';
      }

      // resizeWindow();
    };

    animation();
  });

  initializeDocs();
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
      .catch(e => console.error(e)); 
  }
}

function initializeDocs() {
  const root = document.getElementById('docs-root');
  const contentPanel = document.getElementById('docs-content-panel');
  const toolbar = document.getElementById('docs-toolbar');
  const backButton = document.getElementById('docs-back-button');

  const history = [];

  const docify = html => {
    contentPanel.innerHTML = html;
    root.scrollTop = 0;
    docEditors.splice(0, docEditors.length);

    const links = contentPanel.querySelectorAll('.docs-link');
    for (let link of links) {
      link.addEventListener('click', e => {
        load(link.hash);

        // If I don't prevent default, then the anchor clicking sets the hash
        // to #. I want to customize the hash.
        e.preventDefault();
      });
    }

    const sources = contentPanel.querySelectorAll('.docs-source');
    for (let source of sources) {
      const code = source.innerText;
      const editor = ace.edit(source);
      editor.setTheme('ace/theme/twilight');
      editor.getSession().setMode('ace/mode/twoville');
      editor.setValue(code, 1);
      editor.setOptions({
        fontFamily: 'Roboto Mono',
        fontSize: '14pt',
        tabSize: 2,
        useSoftTabs: true,
        maxLines: 100,
        readOnly: true,
      });

      if (settings.showCopyLinks) {
        const copyAnchor = document.createElement('a');
        copyAnchor.href = '#';
        copyAnchor.innerText = 'copy';
        copyAnchor.classList.add('copy-button');
        copyAnchor.addEventListener('click', e => {
          copyToClipboard(code);
          e.preventDefault();
        });

        source.parentNode.insertBefore(copyAnchor, source.nextSibling);
      }

      docEditors.push(editor);
    }
  };

  const load = tag => {
    window.history.replaceState(undefined, undefined, tag);
    history.push(tag);
    fetch(`/docs/${tag.substring(1)}.html`).
      then(response => response.text()).
      then(html => {
        toolbar.style.display = tag === '#index' ? 'none' : 'block';
        docify(html);
      });
  };

  backButton.addEventListener('click', () => {
    if (history.length <= 1) return;
    history.pop();
    load(history.pop());
  });

  if (window.location.hash) {
    history.push('#index');
    load(window.location.hash);
  } else {
    load('#index');
  }
}

initialize();
