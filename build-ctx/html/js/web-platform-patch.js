(function () {
  "use strict";

  window.$DLL_PATHS = window.$DLL_PATHS || {};

  window.hideSplashScreen = window.hideSplashScreen || function () {};
  window.onLayaInitError =
    window.onLayaInitError ||
    function (error) {
      console.error("[Laya] init error", error);
    };

  if (!window.PlatformClass) {
    function createBridge() {
      return {
        call: function () {
          return null;
        },
        callWithBack: function (callback, methodName) {
          if (typeof callback === "function") {
            setTimeout(function () {
              callback(methodName === "ShowRewardVideo");
            }, 0);
          }
          return null;
        },
      };
    }

    window.PlatformClass = {
      createClass: function () {
        return createBridge();
      },
    };

    window.PlatformObj = function () {};
  }

  if (window.Laya && window.Laya.Browser && !window.conch) {
    try {
      window.Laya.Browser.onAndroid = false;
    } catch (error) {
      // Some Laya builds expose platform flags as readonly accessors.
    }

    try {
      Object.defineProperty(window.Laya.Browser, "onAndroid", {
        configurable: true,
        value: false,
      });
    } catch (error) {
      // The bridge stub above still keeps Android browser sessions from crashing.
    }
  }
})();
