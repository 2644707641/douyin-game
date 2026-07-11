(function () {
  "use strict";

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error("脚本加载失败: " + src));
      };
      document.body.appendChild(script);
    });
  }

  function report(error) {
    console.error("[Bootstrap] 游戏脚本加载失败", error);
    if (typeof window.onLayaInitError === "function") {
      window.onLayaInitError(error);
    }
  }

  function waitForPatchReady() {
    var patch = window.__LayaWebPlatformPatch || {};
    var ready = patch.ready;
    if (!ready || typeof ready.then !== "function") {
      return Promise.resolve();
    }

    return ready.catch(function (error) {
      console.error("[Bootstrap] 云存档初始化失败，回退到默认启动流程", error);
    });
  }

  waitForPatchReady()
    .then(function () {
      return loadScript("js/bundle.js");
    })
    .then(function () {
      return loadScript("js/index.js");
    })
    .catch(report);
})();
