(function () {
  'use strict';

  var music = null;
  var listenersInstalled = false;
  var QUEUE_TARGET_SECONDS = 3.0;
  var CHUNK_FRAMES = 4096;

  function handlePromise(promise, action) {
    if (promise && typeof promise.catch === 'function') {
      promise.catch(function (error) {
        console.warn('[dragonwake] WebAudio ' + action + ' failed', error);
      });
    }
  }

  function pageActive() {
    return typeof document === 'undefined' || !document.hidden;
  }

  function cleanSource(state, source) {
    source.onended = null;
    try { source.disconnect(); } catch (error) {}
    state.sources.delete(source);
  }

  function clearScheduled(state, fade) {
    var now = state.ctx.currentTime;
    var stopTime = fade ? now + 0.030 : now;
    state.lifecycleGain.gain.cancelScheduledValues(now);
    state.lifecycleGain.gain.setValueAtTime(state.lifecycleGain.gain.value, now);
    state.lifecycleGain.gain.linearRampToValueAtTime(0.0, stopTime);
    state.sources.forEach(function (source) {
      try { source.stop(stopTime); } catch (error) {}
    });
    state.nextTime = 0.0;
    state.resumeFadePending = true;
  }

  function queueSamples(state, samples, frames) {
    if (!state.active || state.paused || !state.trackId || frames <= 0) {
      return;
    }
    var buffer = state.ctx.createBuffer(2, frames, state.sampleRate);
    var left = buffer.getChannelData(0);
    var right = buffer.getChannelData(1);
    for (var frame = 0, sample = 0; frame < frames; ++frame, sample += 2) {
      left[frame] = samples[sample] || 0.0;
      right[frame] = samples[sample + 1] || 0.0;
    }

    var source = state.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(state.lifecycleGain);
    source.onended = function () { cleanSource(state, source); };
    state.sources.add(source);

    var now = state.ctx.currentTime;
    if (!state.nextTime || state.nextTime < now + 0.100) {
      state.nextTime = now + 0.100;
    }
    var startTime = state.nextTime;
    if (state.resumeFadePending) {
      state.lifecycleGain.gain.cancelScheduledValues(startTime);
      state.lifecycleGain.gain.setValueAtTime(0.0, startTime);
      state.lifecycleGain.gain.linearRampToValueAtTime(1.0, startTime + 0.030);
      state.resumeFadePending = false;
    }
    try {
      source.start(startTime);
      state.nextTime = startTime + frames / state.sampleRate;
    } catch (error) {
      cleanSource(state, source);
      state.nextTime = now;
      state.error = String(error);
    }
  }

  function pump(state) {
    if (!state.ready || !state.active || state.paused || !state.trackId ||
        state.renderPending || state.error) {
      return;
    }
    var queuedSeconds = Math.max(0.0, (state.nextTime || 0.0) - state.ctx.currentTime);
    if (queuedSeconds >= QUEUE_TARGET_SECONDS) {
      return;
    }
    state.renderPending = true;
    state.worker.postMessage({
      type: 'render',
      generation: state.generation,
      frames: CHUNK_FRAMES
    });
  }

  function setActive(state, active) {
    if (state.active === active) {
      if (active && state.ctx.state === 'suspended') {
        handlePromise(state.ctx.resume(), 'resume');
      }
      return;
    }
    state.active = active;
    state.generation += 1;
    clearScheduled(state, true);
    if (active) {
      handlePromise(state.ctx.resume(), 'resume');
      pump(state);
    }
  }

  function initialize(sampleRate) {
    if (music) {
      return true;
    }
    var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor || typeof Worker !== 'function') {
      return false;
    }

    var ctx = new AudioContextCtor();
    var lifecycleGain = ctx.createGain();
    var volumeGain = ctx.createGain();
    lifecycleGain.connect(volumeGain);
    volumeGain.connect(ctx.destination);
    music = {
      ctx: ctx,
      lifecycleGain: lifecycleGain,
      volumeGain: volumeGain,
      worker: new Worker(new URL('music-worker.js', document.baseURI).href),
      ready: false,
      active: pageActive(),
      paused: false,
      trackId: '',
      randomEntry: true,
      sampleRate: sampleRate,
      generation: 1,
      renderPending: false,
      nextTime: 0.0,
      resumeFadePending: !pageActive(),
      sources: new Set(),
      error: '',
      timer: 0
    };
    lifecycleGain.gain.value = music.active ? 1.0 : 0.0;
    volumeGain.gain.value = 1.0;

    music.worker.onmessage = function (event) {
      var message = event.data || {};
      if (message.type === 'ready') {
        music.ready = true;
        music.sampleRate = message.sampleRate || music.sampleRate;
        pump(music);
        return;
      }
      if (message.type === 'error') {
        music.renderPending = false;
        music.error = message.message || 'music worker failed';
        console.error('[dragonwake] ' + music.error);
        return;
      }
      if (message.type === 'samples') {
        music.renderPending = false;
        if ((message.generation | 0) === music.generation && message.samples) {
          queueSamples(music, message.samples, message.frames | 0);
        }
        setTimeout(function () { if (music) { pump(music); } }, 0);
      }
    };
    music.worker.onerror = function (event) {
      music.renderPending = false;
      music.error = event.message || 'music worker failed to load';
      console.error('[dragonwake] ' + music.error);
    };
    music.timer = window.setInterval(function () { if (music) { pump(music); } }, 50);

    if (!listenersInstalled) {
      var resume = function () {
        if (music) {
          setActive(music, pageActive());
        }
      };
      window.addEventListener('pointerdown', resume, { capture: true });
      window.addEventListener('keydown', resume, { capture: true });
      window.addEventListener('touchstart', resume, { capture: true });
      window.addEventListener('pageshow', resume, { capture: true });
      window.addEventListener('pagehide', function () {
        if (music) { setActive(music, false); }
      }, { capture: true });
      document.addEventListener('visibilitychange', function () {
        if (music) { setActive(music, pageActive()); }
      }, { capture: true });
      listenersInstalled = true;
    }
    return true;
  }

  function setTrack(trackId, randomEntry) {
    if (!music) {
      return false;
    }
    trackId = trackId || '';
    if (music.trackId === trackId && music.randomEntry === !!randomEntry) {
      return true;
    }
    music.trackId = trackId;
    music.randomEntry = !!randomEntry;
    music.generation += 1;
    clearScheduled(music, true);
    music.worker.postMessage({
      type: 'set-track',
      trackId: trackId,
      randomEntry: !!randomEntry
    });
    pump(music);
    return true;
  }

  function setPaused(paused) {
    if (!music || music.paused === !!paused) {
      return;
    }
    music.paused = !!paused;
    music.generation += 1;
    clearScheduled(music, true);
    if (!music.paused) {
      pump(music);
    }
  }

  function setVolume(volume) {
    if (!music) {
      return;
    }
    music.volumeGain.gain.value = Math.max(0.0, Math.min(1.5, volume));
  }

  function takeError() {
    if (!music || !music.error) {
      return '';
    }
    var error = music.error;
    music.error = '';
    return error;
  }

  function shutdown() {
    if (!music) {
      return;
    }
    var state = music;
    music = null;
    window.clearInterval(state.timer);
    clearScheduled(state, false);
    state.worker.terminate();
    handlePromise(state.ctx.close(), 'close');
  }

  window.DragonwakeMusic = {
    initialize: initialize,
    setTrack: setTrack,
    setPaused: setPaused,
    setVolume: setVolume,
    takeError: takeError,
    shutdown: shutdown
  };
})();
