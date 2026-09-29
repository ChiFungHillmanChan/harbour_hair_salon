import { initI18n, t } from './i18n.js';

initI18n();

const emit = (name, detail = {}) => window.dispatchEvent(new CustomEvent(`salon:${name}`, { detail }));
const $ = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const state = { mode: 'dollhouse', zone: null, light: 70, labels: true, cleanView: false, tour: false };
let noticeTimer;
const movementReleases = new Set();

function releaseMovement() {
  movementReleases.forEach((release) => release());
}

function focusScene() {
  if (!document.querySelector('dialog[open]')) $('#scene').focus({ preventScroll: true });
}

function setCleanView(enabled) {
  releaseMovement();
  state.cleanView = Boolean(enabled);
  document.body.dataset.cleanView = String(state.cleanView);
  all('[data-studio-ui]').forEach((element) => { element.inert = state.cleanView; });
  const button = $('[data-action="labels"]');
  button.setAttribute('aria-pressed', String(state.cleanView));
  button.title = t(state.cleanView ? 'Show viewing controls and labels' : 'Hide viewing controls and labels');
  $('[data-clean-eye-slash]').classList.toggle('hidden', !state.cleanView);
  emit('labels', { visible: !state.cleanView && state.labels });
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !state.cleanView || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  event.stopPropagation();
  setCleanView(false);
}, { capture: true });

function announce(message) {
  const notice = $('#notice');
  notice.textContent = t(message);
  notice.classList.remove('hidden');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.add('hidden'), 2600);
}

function updateMode(mode) {
  if (!['dollhouse', 'walk', 'plan'].includes(mode)) return;
  if (mode !== state.mode) releaseMovement();
  state.mode = mode;
  document.body.dataset.view = mode;
  all('[data-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  $('#walk-controls').classList.toggle('hidden', mode !== 'walk');
  $('#walk-controls').classList.toggle('grid', mode === 'walk');
  $('#interaction-hint').textContent = t(mode === 'walk' ? 'WASD / arrows to walk · Drag to look' : mode === 'plan' ? 'Drag to move · Scroll to zoom' : 'Drag to orbit · Scroll to zoom');
  $('#scene').setAttribute('aria-label', t(mode === 'walk' ? 'Walk inside Harbour Hair. Use W A S D or arrow keys to move and drag to look around.' : mode === 'plan' ? 'Overhead floor plan of Harbour Hair. Drag to move and scroll to zoom.' : 'Interactive 3D model of Harbour Hair salon. Drag to rotate and scroll to zoom.'));
}

function updateZone(zone) {
  if (zone !== null && !['welcome', 'styling', 'wash', 'colour'].includes(zone)) return;
  state.zone = zone;
  all('[data-zone]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.zone === zone)));
}

function updateLight(value) {
  value = Math.max(0, Math.min(100, Number(value)));
  if (!Number.isFinite(value)) return;
  state.light = value;
  $('#daylight').value = value;
  $('#light-value').textContent = `${Math.round(value)}%`;
  all('[data-light]').forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.light) === value)));
}

function updateTour(playing) {
  state.tour = Boolean(playing);
  const button = $('[data-action="tour"]');
  button.setAttribute('aria-pressed', String(state.tour));
  $('[data-tour-label]').textContent = t(state.tour ? 'Pause the tour' : 'Take a little tour');
}

function restorePanels() {
  $('#design-home').append($('#design-panel'));
  $('#atmosphere-home').append($('#atmosphere-panel'));
}

const settingsDialog = $('#settings-dialog');
const photosDialog = $('#photos-dialog');
settingsDialog.addEventListener('close', restorePanels);
for (const dialog of [settingsDialog, photosDialog, $('#export-dialog')]) {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}
window.matchMedia('(min-width: 901px)').addEventListener('change', (event) => {
  if (event.matches && settingsDialog.open) settingsDialog.close();
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.mode) {
    updateMode(button.dataset.mode);
    updateTour(false);
    emit('mode', { mode: state.mode });
    if (state.mode === 'walk') focusScene();
  } else if (button.dataset.zone) {
    updateZone(button.dataset.zone);
    updateTour(false);
    emit('zone', { zone: state.zone });
    if (state.mode === 'walk') focusScene();
  } else if (button.dataset.light !== undefined) {
    updateLight(button.dataset.light);
    emit('light', { value: state.light });
  } else if (button.dataset.close) {
    document.getElementById(button.dataset.close).close();
  } else {
    switch (button.dataset.action) {
      case 'settings':
        releaseMovement();
        $('#mobile-settings-content').append($('#design-panel'), $('#atmosphere-panel'));
        settingsDialog.showModal();
        break;
      case 'photos':
        releaseMovement();
        photosDialog.showModal();
        break;
      case 'labels':
        setCleanView(!state.cleanView);
        if (state.mode === 'walk') focusScene();
        break;
      case 'reset':
        updateMode('dollhouse');
        updateZone(null);
        updateLight(70);
        updateTour(false);
        state.labels = true;
        setCleanView(false);
        emit('reset');
        announce('View and lighting reset.');
        break;
      case 'capture':
        emit('capture');
        break;
      case 'tour':
        updateTour(!state.tour);
        emit('tour', { playing: state.tour });
        if (state.tour) focusScene();
        break;
      case 'reload':
        window.location.reload();
        break;
    }
  }
});
$('#daylight').addEventListener('input', (event) => {
  updateLight(event.target.value);
  emit('light', { value: state.light });
});

all('[data-move]').forEach((button) => {
  let held = false;
  const release = () => {
    if (!held) return;
    held = false;
    emit('move', { direction: button.dataset.move, active: false });
  };
  movementReleases.add(release);
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    held = true;
    emit('move', { direction: button.dataset.move, active: true });
  });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (held) return;
      held = true;
      emit('move', { direction: button.dataset.move, active: true });
    }
  });
  button.addEventListener('keyup', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      release();
    }
  });
  button.addEventListener('blur', release);
});
window.addEventListener('blur', releaseMovement);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseMovement();
});
window.addEventListener('salon:ready', () => $('#loading').classList.add('hidden'));
window.addEventListener('salon:error', (event) => {
  $('#loading').classList.add('hidden');
  $('#error-message').textContent = t(event.detail?.message || 'Open this file in a current browser with hardware acceleration enabled, then reload.');
  $('#error').classList.remove('hidden');
  $('#error').classList.add('flex');
});
window.addEventListener('salon:state', (event) => {
  const next = event.detail || {};
  if (next.mode) updateMode(next.mode);
  if (Object.prototype.hasOwnProperty.call(next, 'zone')) updateZone(next.zone);
  if (next.light !== undefined) updateLight(next.light);
  if (next.tour !== undefined) updateTour(next.tour);
  if (next.message) announce(next.message);
});

window.addEventListener('salon:notice', (event) => {
  if (event.detail?.message) announce(event.detail.message);
});

window.addEventListener('salon:captured', (event) => {
  $('#export-image').src = event.detail.url;
  $('#export-download').href = event.detail.url;
  $('#export-dialog').showModal();
});
