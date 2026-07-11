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

  function isNonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  function getRawLocalStorage() {
    try {
      return window.localStorage;
    } catch (error) {
      return null;
    }
  }

  function readHashParams(hash) {
    var value = hash || "";
    if (value.charAt(0) === "#") {
      value = value.slice(1);
    }
    return new URLSearchParams(value);
  }

  function createUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (char) {
      var random = Math.floor(Math.random() * 16);
      var value = char === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  function normalizeStorageMap(map) {
    var source = map && typeof map === "object" ? map : {};
    var normalized = {};

    Object.keys(source).forEach(function (key) {
      var value = source[key];
      if (value == null) {
        return;
      }
      normalized[key] = String(value);
    });

    return normalized;
  }

  function serializeStorageMap(map) {
    var normalized = normalizeStorageMap(map);
    var ordered = {};

    Object.keys(normalized)
      .sort()
      .forEach(function (key) {
        ordered[key] = normalized[key];
      });

    return JSON.stringify(ordered);
  }

  function getPlayerSaveTime(storageMap) {
    if (!storageMap || !storageMap.playerData) {
      return 0;
    }

    try {
      var parsed = JSON.parse(storageMap.playerData);
      return parsed && typeof parsed._saveTime === "number" ? parsed._saveTime : 0;
    } catch (error) {
      return 0;
    }
  }

  function mergeStorageMaps(localMap, remoteMap) {
    var localNormalized = normalizeStorageMap(localMap);
    var remoteNormalized = normalizeStorageMap(remoteMap);
    var localSaveTime = getPlayerSaveTime(localNormalized);
    var remoteSaveTime = getPlayerSaveTime(remoteNormalized);
    var primary = remoteNormalized;
    var secondary = localNormalized;

    if (localSaveTime > remoteSaveTime) {
      primary = localNormalized;
      secondary = remoteNormalized;
    }

    var merged = {};

    Object.keys(primary).forEach(function (key) {
      merged[key] = primary[key];
    });

    Object.keys(secondary).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(merged, key) || merged[key] === "") {
        merged[key] = secondary[key];
      }
    });

    return {
      map: merged,
      localSaveTime: localSaveTime,
      remoteSaveTime: remoteSaveTime,
    };
  }

  function normalizeCloudSaveConfig(source) {
    var config = source && typeof source === "object" ? source : {};

    return {
      enabled: config.enabled === true,
      supabaseUrl: isNonEmptyString(config.supabaseUrl)
        ? config.supabaseUrl.replace(/\/+$/, "")
        : "",
      anonKey: isNonEmptyString(config.anonKey) ? config.anonKey : "",
      table: isNonEmptyString(config.table) ? config.table : "game_saves",
      saveIdParam: isNonEmptyString(config.saveIdParam) ? config.saveIdParam : "save",
      saveTokenHashParam: isNonEmptyString(config.saveTokenHashParam)
        ? config.saveTokenHashParam
        : "saveToken",
      requestTimeoutMs:
        typeof config.requestTimeoutMs === "number" && config.requestTimeoutMs >= 1000
          ? config.requestTimeoutMs
          : 8000,
      syncDebounceMs:
        typeof config.syncDebounceMs === "number" && config.syncDebounceMs >= 0
          ? config.syncDebounceMs
          : 1200,
      retryDelayMs:
        typeof config.retryDelayMs === "number" && config.retryDelayMs >= 1000
          ? config.retryDelayMs
          : 5000,
      migratedKeys:
        Array.isArray(config.migratedKeys) && config.migratedKeys.length > 0
          ? config.migratedKeys.slice()
          : ["playerData", "oaPointQueue", "privacy_user_agreement_v1"],
    };
  }

  function createCloudSaveController(config) {
    var rawLocalStorage = getRawLocalStorage();
    var state = {
      storageMap: {},
      saveId: "",
      saveToken: "",
      pendingTimer: 0,
      lastSyncedSerialized: serializeStorageMap({}),
      writeInFlight: null,
      flushHooksInstalled: false,
      lastFlushSucceeded: true,
    };

    function log() {
      console.info.apply(console, ["[CloudSave]"].concat(Array.prototype.slice.call(arguments)));
    }

    function warn() {
      console.warn.apply(console, ["[CloudSave]"].concat(Array.prototype.slice.call(arguments)));
    }

    function buildRestUrl(queryString) {
      var url = config.supabaseUrl + "/rest/v1/" + encodeURIComponent(config.table);
      if (queryString) {
        url += "?" + queryString;
      }
      return url;
    }

    function buildHeaders(extraHeaders) {
      var headers = {
        apikey: config.anonKey,
        Authorization: "Bearer " + config.anonKey,
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-save-token": state.saveToken,
      };

      if (extraHeaders && typeof extraHeaders === "object") {
        Object.keys(extraHeaders).forEach(function (key) {
          headers[key] = extraHeaders[key];
        });
      }

      return headers;
    }

    function createFetchOptions(options) {
      var fetchOptions = Object.assign({ cache: "no-store" }, options || {});
      var timeoutId = 0;

      if (typeof AbortController === "function") {
        var controller = new AbortController();
        fetchOptions.signal = controller.signal;
        timeoutId = window.setTimeout(function () {
          controller.abort();
        }, config.requestTimeoutMs);
      }

      return {
        fetchOptions: fetchOptions,
        clear: function () {
          if (timeoutId) {
            window.clearTimeout(timeoutId);
          }
        },
      };
    }

    function fetchWithTimeout(url, options) {
      var wrapped = createFetchOptions(options);

      return fetch(url, wrapped.fetchOptions).finally(function () {
        wrapped.clear();
      });
    }

    function readLegacyStorage() {
      var legacyMap = {};

      if (!rawLocalStorage) {
        return legacyMap;
      }

      config.migratedKeys.forEach(function (key) {
        try {
          var value = rawLocalStorage.getItem(key);
          if (value !== null) {
            legacyMap[key] = value;
          }
        } catch (error) {
          warn("读取旧存档失败:", key, error);
        }
      });

      return legacyMap;
    }

    function mirrorToLocalStorage(key, value) {
      if (!rawLocalStorage) {
        return;
      }

      try {
        rawLocalStorage.setItem(key, value);
      } catch (error) {
        warn("写入本地兜底存档失败:", key, error);
      }
    }

    function removeLocalMirror(key) {
      if (!rawLocalStorage) {
        return;
      }

      try {
        rawLocalStorage.removeItem(key);
      } catch (error) {
        warn("删除本地兜底存档失败:", key, error);
      }
    }

    function syncLocalMirror() {
      if (!rawLocalStorage) {
        return;
      }

      Object.keys(state.storageMap).forEach(function (key) {
        mirrorToLocalStorage(key, state.storageMap[key]);
      });
    }

    function clearLocalMirror() {
      var keysToRemove = {};

      if (!rawLocalStorage) {
        return;
      }

      config.migratedKeys.forEach(function (key) {
        keysToRemove[key] = true;
      });

      Object.keys(state.storageMap).forEach(function (key) {
        keysToRemove[key] = true;
      });

      Object.keys(keysToRemove).forEach(function (key) {
        removeLocalMirror(key);
      });
    }

    function buildSaveUrl() {
      var url = new URL(window.location.href);
      var hashParams = readHashParams(url.hash);

      url.searchParams.set(config.saveIdParam, state.saveId);
      hashParams.set(config.saveTokenHashParam, state.saveToken);
      url.hash = hashParams.toString();

      return url.toString();
    }

    function exposeCloudSaveHelpers() {
      window.getCloudSaveLink = function () {
        return buildSaveUrl();
      };

      window.copyCloudSaveLink = function () {
        var link = buildSaveUrl();
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
          return Promise.reject(new Error("当前浏览器不支持 clipboard API"));
        }
        return navigator.clipboard.writeText(link).then(function () {
          return link;
        });
      };
    }

    function ensureCloudIdentity() {
      var url = new URL(window.location.href);
      var hashParams = readHashParams(url.hash);
      var saveId = url.searchParams.get(config.saveIdParam);
      var saveToken = hashParams.get(config.saveTokenHashParam);
      var created = false;

      if (!isNonEmptyString(saveId)) {
        saveId = createUuid();
        url.searchParams.set(config.saveIdParam, saveId);
        created = true;
      }

      if (!isNonEmptyString(saveToken)) {
        saveToken = createUuid();
        hashParams.set(config.saveTokenHashParam, saveToken);
        created = true;
      }

      if (created) {
        url.hash = hashParams.toString();
        window.history.replaceState(null, "", url.toString());
      }

      state.saveId = saveId;
      state.saveToken = saveToken;

      exposeCloudSaveHelpers();

      if (created) {
        log("已生成云存档链接，请收藏当前地址以便在清理浏览器数据后恢复进度。");
      }
    }

    function installFlushHooks() {
      if (state.flushHooksInstalled) {
        return;
      }

      state.flushHooksInstalled = true;

      document.addEventListener("visibilitychange", function () {
        if (document.hidden) {
          void flushNow({ keepalive: true });
        }
      });

      window.addEventListener("pagehide", function () {
        void flushNow({ keepalive: true });
      });
    }

    function installStorageOverride() {
      if (!window.Laya || !window.Laya.LocalStorage) {
        throw new Error("Laya.LocalStorage 不可用，无法安装云存档覆盖层");
      }

      var storageApi = {
        setItem: function (key, value) {
          state.storageMap[key] = String(value);
          mirrorToLocalStorage(key, state.storageMap[key]);
          scheduleFlush();
        },
        getItem: function (key) {
          return Object.prototype.hasOwnProperty.call(state.storageMap, key)
            ? state.storageMap[key]
            : null;
        },
        setJSON: function (key, value) {
          storageApi.setItem(key, JSON.stringify(value));
        },
        getJSON: function (key) {
          var value = storageApi.getItem(key);
          return JSON.parse(value || null);
        },
        removeItem: function (key) {
          if (!Object.prototype.hasOwnProperty.call(state.storageMap, key)) {
            return;
          }
          delete state.storageMap[key];
          removeLocalMirror(key);
          scheduleFlush();
        },
        clear: function () {
          if (Object.keys(state.storageMap).length === 0) {
            return;
          }
          clearLocalMirror();
          state.storageMap = {};
          scheduleFlush();
        },
      };

      Object.defineProperty(storageApi, "count", {
        configurable: true,
        enumerable: true,
        get: function () {
          return Object.keys(state.storageMap).length;
        },
      });

      window.Laya.LocalStorage = storageApi;
    }

    function scheduleFlush(delayMs) {
      if (state.pendingTimer) {
        window.clearTimeout(state.pendingTimer);
      }

      state.pendingTimer = window.setTimeout(function () {
        state.pendingTimer = 0;
        void flushNow();
      }, typeof delayMs === "number" ? delayMs : config.syncDebounceMs);
    }

    async function fetchRemoteStorage() {
      var query =
        "select=storage_map,updated_at&save_id=eq." +
        encodeURIComponent(state.saveId) +
        "&limit=1";
      var response = await fetchWithTimeout(buildRestUrl(query), {
        method: "GET",
        headers: buildHeaders({ "Content-Type": "application/json" }),
      });

      if (!response.ok) {
        throw new Error("读取 Supabase 云存档失败: " + response.status + " " + response.statusText);
      }

      var rows = await response.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        return {};
      }

      return normalizeStorageMap(rows[0] && rows[0].storage_map);
    }

    async function flushNow(options) {
      var serialized = serializeStorageMap(state.storageMap);
      var payloadMap;

      if (serialized === state.lastSyncedSerialized) {
        return false;
      }

      if (state.writeInFlight) {
        return state.writeInFlight;
      }

      payloadMap = JSON.parse(serialized);

      var request = fetchWithTimeout(buildRestUrl("on_conflict=save_id"), {
        method: "POST",
        headers: buildHeaders({
          Prefer: "resolution=merge-duplicates,return=minimal",
        }),
        body: JSON.stringify([
          {
            save_id: state.saveId,
            save_token: state.saveToken,
            storage_map: payloadMap,
          },
        ]),
        keepalive: options && options.keepalive === true,
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error(
              "写入 Supabase 云存档失败: " + response.status + " " + response.statusText
            );
          }

          state.lastFlushSucceeded = true;
          state.lastSyncedSerialized = serialized;
          return true;
        })
        .catch(function (error) {
          state.lastFlushSucceeded = false;
          warn(error);
          return false;
        })
        .finally(function () {
          if (state.writeInFlight === request) {
            state.writeInFlight = null;
          }

          if (serializeStorageMap(state.storageMap) !== state.lastSyncedSerialized) {
            scheduleFlush(state.lastFlushSucceeded ? 0 : config.retryDelayMs);
          }
        });

      state.writeInFlight = request;
      return request;
    }

    async function init() {
      ensureCloudIdentity();
      installFlushHooks();

      var legacyMap = readLegacyStorage();
      var remoteMap = {};

      try {
        remoteMap = await fetchRemoteStorage();
      } catch (error) {
        warn(error);
      }

      var merged = mergeStorageMaps(legacyMap, remoteMap);
      state.storageMap = merged.map;
      state.lastSyncedSerialized = serializeStorageMap(remoteMap);
      syncLocalMirror();

      installStorageOverride();

      if (serializeStorageMap(state.storageMap) !== state.lastSyncedSerialized) {
        scheduleFlush(0);
      }

      log(
        "云存档已接管 Laya.LocalStorage。",
        "localSaveTime=" + merged.localSaveTime,
        "remoteSaveTime=" + merged.remoteSaveTime
      );
    }

    return {
      init: init,
    };
  }

  var patchState = {
    ready: Promise.resolve(),
  };
  var cloudSaveConfig = normalizeCloudSaveConfig(window.__SUPABASE_SAVE__);

  if (cloudSaveConfig.enabled) {
    if (!cloudSaveConfig.supabaseUrl || !cloudSaveConfig.anonKey) {
      patchState.ready = Promise.resolve().then(function () {
        console.error("[CloudSave] enabled=true 但 Supabase 配置不完整，已跳过云存档初始化。");
      });
    } else {
      patchState.ready = createCloudSaveController(cloudSaveConfig)
        .init()
        .catch(function (error) {
          console.error("[CloudSave] 初始化失败。", error);
        });
    }
  }

  window.__LayaWebPlatformPatch = patchState;
})();
