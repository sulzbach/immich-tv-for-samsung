// Open when the TV turns on (ADR 0024): a Tizen web service bundled with the
// app. Each time the TV comes out of standby, it opens the app straight into
// ambient mode, before Samsung TV Plus or the Home screen settle in front.
//
// The one signal it relies on is the TV's power state, from the TV's local
// REST API on 127.0.0.1:8001 (/api/v2/, device.PowerState). The service keeps
// running across standby; while the TV is in standby the API answers another
// state, or nothing, and the service's timers may not run at all. So the TV
// has turned on when the API says "on" after it said something else, or after
// no "on" answer for longer than a few checks would take.
//
// On power-on it asks the app for ambient mode two ways, with one nonce: a
// message on the app's message port, which reaches the app while it runs,
// even when the TV has already brought it back to the front by itself (the
// TV tells such an app nothing of a new launch request), and a launch
// request, which opens the app or brings it to the front. The TV brings the
// app back before this service's next check sees the power-on, so the app,
// back in front, asks on this service's message port whether the TV is just
// turning on; the answer is the same request, or "none".
//
// The app starts this service and passes its setting in the launch request
// (data "config": {"enabled": bool}). It opens no network port; message
// ports are local to the TV, between this app and its service. Plain ES5 and Node
// built-ins only: the TV's service runtime is Node 16 on 2023 models, older
// on earlier ones.
"use strict";

var http = require("http");

var appId = "imchTV0001.ImmichTV";
var appPortName = "immich-tv-ambient";
var servicePortName = "immich-tv-ambient-service";
var checkMs = 2000;
// Longer than this without an "on" answer, and the TV was not on meanwhile.
var offAfterMs = 20000;
var config = { enabled: false };
// The last time the API answered "on", and whether its last answer was
// another state.
var lastOnAt = null;
var lastAnswerOff = false;
var timer = null;

function powerState(done) {
  var finished = false;
  var finish = function (value) {
    if (!finished) {
      finished = true;
      done(value);
    }
  };
  var request = http.get(
    { host: "127.0.0.1", port: 8001, path: "/api/v2/", timeout: 1500 },
    function (res) {
      var body = "";
      res.on("data", function (chunk) {
        body += chunk;
      });
      res.on("end", function () {
        try {
          var parsed = JSON.parse(body.replace(/[\u0000-\u001f]/g, " "));
          finish((parsed && parsed.device && parsed.device.PowerState) || null);
        } catch (error) {
          finish(null);
        }
      });
    }
  );
  request.on("error", function () {
    finish(null);
  });
  request.on("timeout", function () {
    request.abort();
    finish(null);
  });
}

function sendToApp(items) {
  try {
    tizen.messageport.requestRemoteMessagePort(appId, appPortName).sendMessage(items);
  } catch (error) {
    // The app isn't running: the launch request opens it.
  }
}

function openAmbient() {
  var nonce = String(Date.now());

  sendToApp([
    { key: "action", value: "ambient" },
    { key: "nonce", value: nonce }
  ]);
  try {
    var request = new tizen.ApplicationControlData("immich-tv-request", [
      JSON.stringify({ action: "ambient", nonce: nonce })
    ]);
    tizen.application.launchAppControl(
      new tizen.ApplicationControl(
        "http://tizen.org/appcontrol/operation/default",
        null,
        null,
        null,
        [request]
      ),
      appId,
      function () {},
      function () {}
    );
  } catch (error) {
    // Nothing to do: the next time the TV turns on tries again.
  }
}

function check() {
  powerState(function (state) {
    var now = Date.now();

    if (state === null) {
      // No answer: says nothing by itself; the gap since the last "on" does.
      return;
    }

    if (state !== "on") {
      lastAnswerOff = true;
      return;
    }

    var turnedOn = turningOn(now);

    lastOnAt = now;
    lastAnswerOff = false;
    if (turnedOn && config.enabled) {
      openAmbient();
    }
  });
}

// Whether the TV has come out of standby since the last "on" answer.
function turningOn(now) {
  return lastOnAt !== null && (lastAnswerOff || now - lastOnAt > offAfterMs);
}

// The app, back in front, asks whether the TV is just turning on. The TV
// answers "on" by now; what this service saw before says whether it was in
// standby.
function answerApp() {
  powerState(function (state) {
    var now = Date.now();

    if (state === "on" && config.enabled && turningOn(now)) {
      lastOnAt = now;
      lastAnswerOff = false;
      openAmbient();
      return;
    }

    sendToApp([{ key: "action", value: "none" }]);
  });
}

function listenToApp() {
  try {
    tizen.messageport
      .requestLocalMessagePort(servicePortName)
      .addMessagePortListener(function (data) {
        if (
          (data || []).some(function (item) {
            return item.key === "query";
          })
        ) {
          answerApp();
        }
      });
  } catch (error) {
    // The app's question then goes unanswered; it stops waiting by itself.
  }
}

function readConfig() {
  try {
    var requested = tizen.application.getCurrentApplication().getRequestedAppControl();
    var data = (requested && requested.appControl && requested.appControl.data) || [];

    data.forEach(function (item) {
      if (item.key === "config" && item.value && item.value[0]) {
        config = { enabled: JSON.parse(item.value[0]).enabled === true };
      }
    });
  } catch (error) {
    // Keep the last setting.
  }
}

module.exports.onStart = function () {
  readConfig();
  listenToApp();
  timer = setInterval(check, checkMs);
  check();
};

// Each launch from the app carries its current setting.
module.exports.onRequest = function () {
  readConfig();
};

module.exports.onExit = function () {
  if (timer) {
    clearInterval(timer);
  }
};
