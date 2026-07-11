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
            window.setTimeout(function () {
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
      // 部分 Laya 版本会把平台标记做成只读属性。
    }

    try {
      Object.defineProperty(window.Laya.Browser, "onAndroid", {
        configurable: true,
        value: false,
      });
    } catch (error) {
      // 至少保留上面的 bridge stub，避免网页环境被识别成原生安卓。
    }
  }

  function noop() {}

  function isNonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  function isUuidLike(value) {
    return (
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.trim()
      )
    );
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

  function toSafeNumber(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clampInteger(value, minValue, maxValue, fallback) {
    var parsed = Math.floor(toSafeNumber(value, fallback));
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    if (parsed < minValue) {
      return minValue;
    }
    if (parsed > maxValue) {
      return maxValue;
    }
    return parsed;
  }

  function readJson(text, fallback) {
    try {
      return JSON.parse(text);
    } catch (error) {
      return fallback;
    }
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

  function cloneStorageMap(map) {
    return normalizeStorageMap(map);
  }

  function getPlayerSaveTime(storageMap) {
    if (!storageMap || !storageMap.playerData) {
      return 0;
    }

    var parsed = readJson(storageMap.playerData, null);
    if (!parsed || typeof parsed !== "object") {
      return 0;
    }

    return typeof parsed._saveTime === "number" ? parsed._saveTime : 0;
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

  function buildDefaultAvatarPath(index) {
    var avatarIndex = clampInteger(index, 1, 99, 1);
    return "resources/img/mainUI/avatar/avatar" + avatarIndex + ".png";
  }

  function extractPlayerProfile(storageMap) {
    var normalized = normalizeStorageMap(storageMap);
    var playerData = readJson(normalized.playerData || "", null);
    var gameAvatar = playerData && typeof playerData._gameAvatar === "number" ? playerData._gameAvatar : 1;
    var avatarUrl =
      playerData && isNonEmptyString(playerData._avatarUrl)
        ? playerData._avatarUrl
        : buildDefaultAvatarPath(gameAvatar);
    var nick =
      playerData && isNonEmptyString(playerData._nick) ? playerData._nick.trim() : "无名";
    var province =
      playerData && isNonEmptyString(playerData._province)
        ? playerData._province.trim()
        : "未知";
    var bestStar =
      playerData && typeof playerData._curStar === "number" && !Number.isNaN(playerData._curStar)
        ? playerData._curStar
        : 0;

    return {
      nick: nick,
      avatarUrl: avatarUrl,
      province: province,
      bestStar: Math.max(0, bestStar),
      gameAvatar: gameAvatar,
      saveTime: getPlayerSaveTime(normalized),
    };
  }

  function createFetchOptions(options, timeoutMs) {
    var fetchOptions = Object.assign({ cache: "no-store" }, options || {});
    var timeoutId = 0;

    if (typeof AbortController === "function") {
      var controller = new AbortController();
      fetchOptions.signal = controller.signal;
      timeoutId = window.setTimeout(function () {
        controller.abort();
      }, timeoutMs);
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

  function loadExternalScript(src, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-agent-src="' + src + '"]')) {
        resolve();
        return;
      }

      var script = document.createElement("script");
      var settled = false;
      var timeoutId = window.setTimeout(function () {
        if (settled) {
          return;
        }
        settled = true;
        script.remove();
        reject(new Error("脚本加载超时: " + src));
      }, timeoutMs);

      script.src = src;
      script.async = false;
      script.defer = false;
      script.dataset.agentSrc = src;
      script.onload = function () {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        resolve();
      };
      script.onerror = function () {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        reject(new Error("脚本加载失败: " + src));
      };

      (document.head || document.body || document.documentElement).appendChild(script);
    });
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
      accountTable: isNonEmptyString(config.accountTable) ? config.accountTable : "game_accounts",
      bindSaveRpc: isNonEmptyString(config.bindSaveRpc)
        ? config.bindSaveRpc
        : "bind_game_account_save",
      leaderboardRpc: isNonEmptyString(config.leaderboardRpc)
        ? config.leaderboardRpc
        : "get_game_leaderboard",
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
      accountSyncDebounceMs:
        typeof config.accountSyncDebounceMs === "number" && config.accountSyncDebounceMs >= 0
          ? config.accountSyncDebounceMs
          : 1800,
      leaderboardLimit:
        typeof config.leaderboardLimit === "number" && config.leaderboardLimit >= 1
          ? clampInteger(config.leaderboardLimit, 1, 100, 50)
          : 50,
      registerAccountRpc: isNonEmptyString(config.registerAccountRpc)
        ? config.registerAccountRpc
        : "register_game_account",
      loginAccountRpc: isNonEmptyString(config.loginAccountRpc)
        ? config.loginAccountRpc
        : "login_game_account",
      logoutAccountRpc: isNonEmptyString(config.logoutAccountRpc)
        ? config.logoutAccountRpc
        : "logout_game_account",
      sessionHeaderName: isNonEmptyString(config.sessionHeaderName)
        ? config.sessionHeaderName
        : "x-game-session",
      sessionStorageKey: isNonEmptyString(config.sessionStorageKey)
        ? config.sessionStorageKey
        : "laya_game_account_session_v1",
      supabaseJsUrl: isNonEmptyString(config.supabaseJsUrl) ? config.supabaseJsUrl : "",
      migratedKeys:
        Array.isArray(config.migratedKeys) && config.migratedKeys.length > 0
          ? config.migratedKeys.slice()
          : ["playerData", "oaPointQueue", "privacy_user_agreement_v1"],
    };
  }

  function createSupabaseHttp(config) {
    function buildRestUrl(tableName, queryString) {
      var url = config.supabaseUrl + "/rest/v1/" + encodeURIComponent(tableName);
      if (queryString) {
        url += "?" + queryString;
      }
      return url;
    }

    function buildRpcUrl(functionName) {
      return config.supabaseUrl + "/rest/v1/rpc/" + encodeURIComponent(functionName);
    }

    function buildHeaders(options) {
      var source = options && typeof options === "object" ? options : {};
      var headers = {
        apikey: config.anonKey,
        Authorization: "Bearer " + config.anonKey,
        Accept: "application/json",
      };

      if (source.includeJsonContentType !== false) {
        headers["Content-Type"] = "application/json";
      }

      if (isNonEmptyString(source.sessionToken)) {
        headers[config.sessionHeaderName] = source.sessionToken;
      }

      if (isNonEmptyString(source.saveToken)) {
        headers["x-save-token"] = source.saveToken;
      }

      if (source.extraHeaders && typeof source.extraHeaders === "object") {
        Object.keys(source.extraHeaders).forEach(function (key) {
          headers[key] = source.extraHeaders[key];
        });
      }

      return headers;
    }

    function extractErrorMessage(payload) {
      if (!payload) {
        return "";
      }

      if (typeof payload === "string" && payload.trim()) {
        return payload.trim();
      }

      if (typeof payload !== "object") {
        return "";
      }

      if (isNonEmptyString(payload.message)) {
        return payload.message;
      }
      if (isNonEmptyString(payload.error_description)) {
        return payload.error_description;
      }
      if (isNonEmptyString(payload.error)) {
        return payload.error;
      }
      if (isNonEmptyString(payload.msg)) {
        return payload.msg;
      }

      return "";
    }

    function requestJson(url, options) {
      var source = options && typeof options === "object" ? options : {};
      var fetchOptions = {
        method: source.method || "GET",
        headers: source.headers || buildHeaders(),
      };

      if (Object.prototype.hasOwnProperty.call(source, "body")) {
        fetchOptions.body =
          typeof source.body === "string" ? source.body : JSON.stringify(source.body);
      }

      if (source.keepalive === true) {
        fetchOptions.keepalive = true;
      }

      var wrapped = createFetchOptions(fetchOptions, config.requestTimeoutMs);

      return fetch(url, wrapped.fetchOptions)
        .then(function (response) {
          return response.text().then(function (text) {
            var data = text ? readJson(text, null) : null;
            if (!response.ok) {
              var error = new Error(
                extractErrorMessage(data) ||
                  "Supabase 请求失败: " + response.status + " " + response.statusText
              );
              error.status = response.status;
              error.payload = data;
              throw error;
            }
            return data;
          });
        })
        .finally(function () {
          wrapped.clear();
        });
    }

    return {
      buildRestUrl: buildRestUrl,
      buildRpcUrl: buildRpcUrl,
      buildHeaders: buildHeaders,
      requestJson: requestJson,
    };
  }

  function createCloudSaveController(config, http, hooks) {
    var rawLocalStorage = getRawLocalStorage();
    var state = {
      storageMap: {},
      saveId: "",
      saveToken: "",
      pendingTimer: 0,
      lastSyncedSerialized: serializeStorageMap({}),
      writeInFlight: null,
      flushHooksInstalled: false,
      storageOverrideInstalled: false,
      lastFlushSucceeded: true,
    };

    function log() {
      console.info.apply(console, ["[CloudSave]"].concat(Array.prototype.slice.call(arguments)));
    }

    function warn() {
      console.warn.apply(console, ["[CloudSave]"].concat(Array.prototype.slice.call(arguments)));
    }

    function notifyStorageChanged(reason) {
      if (hooks && typeof hooks.onStorageChanged === "function") {
        hooks.onStorageChanged(cloneStorageMap(state.storageMap), reason || "");
      }
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

    function syncLocalMirror(previousMap) {
      var previousNormalized = normalizeStorageMap(previousMap);
      var nextNormalized = normalizeStorageMap(state.storageMap);
      var keysToRemove = {};

      Object.keys(previousNormalized).forEach(function (key) {
        keysToRemove[key] = true;
      });
      config.migratedKeys.forEach(function (key) {
        keysToRemove[key] = true;
      });

      Object.keys(keysToRemove).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(nextNormalized, key)) {
          removeLocalMirror(key);
        }
      });

      Object.keys(nextNormalized).forEach(function (key) {
        mirrorToLocalStorage(key, nextNormalized[key]);
      });
    }

    function setSaveIdentity(saveId, saveToken, replaceHistory) {
      state.saveId = saveId;
      state.saveToken = saveToken;
      exposeCloudSaveHelpers();

      if (replaceHistory === false) {
        return;
      }

      var url = new URL(window.location.href);
      var hashParams = readHashParams(url.hash);

      url.searchParams.set(config.saveIdParam, state.saveId);
      hashParams.set(config.saveTokenHashParam, state.saveToken);
      url.hash = hashParams.toString();
      window.history.replaceState(null, "", url.toString());
    }

    function buildSaveUrl() {
      var url = new URL(window.location.href);
      var hashParams = readHashParams(url.hash);

      url.searchParams.set(config.saveIdParam, state.saveId);
      hashParams.set(config.saveTokenHashParam, state.saveToken);
      url.hash = hashParams.toString();

      return url.toString();
    }

    function copyText(text) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        return navigator.clipboard.writeText(text);
      }

      return new Promise(function (resolve, reject) {
        try {
          var textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.setAttribute("readonly", "readonly");
          textarea.style.position = "fixed";
          textarea.style.top = "-9999px";
          textarea.style.left = "-9999px";
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();

          var copied = false;
          try {
            copied = document.execCommand("copy");
          } catch (error) {
            copied = false;
          }

          textarea.remove();

          if (!copied) {
            reject(new Error("当前浏览器不支持自动复制"));
            return;
          }

          resolve();
        } catch (error) {
          reject(error);
        }
      });
    }

    function exposeCloudSaveHelpers() {
      window.getCloudSaveLink = function () {
        return buildSaveUrl();
      };

      window.copyCloudSaveLink = function () {
        var link = buildSaveUrl();
        return copyText(link).then(function () {
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

      if (!isUuidLike(saveId)) {
        saveId = createUuid();
        url.searchParams.set(config.saveIdParam, saveId);
        created = true;
      }

      if (!isUuidLike(saveToken)) {
        saveToken = createUuid();
        hashParams.set(config.saveTokenHashParam, saveToken);
        created = true;
      }

      if (created) {
        url.hash = hashParams.toString();
        window.history.replaceState(null, "", url.toString());
      }

      setSaveIdentity(saveId, saveToken, false);

      if (created) {
        log("已生成云存档链接，请收藏当前地址以便恢复数据库存档。");
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

    function scheduleFlush(delayMs) {
      if (state.pendingTimer) {
        window.clearTimeout(state.pendingTimer);
      }

      state.pendingTimer = window.setTimeout(function () {
        state.pendingTimer = 0;
        void flushNow();
      }, typeof delayMs === "number" ? delayMs : config.syncDebounceMs);
    }

    function fetchRemoteStorageFor(saveId, saveToken) {
      var query =
        "select=storage_map,updated_at&save_id=eq." +
        encodeURIComponent(saveId) +
        "&limit=1";

      return http
        .requestJson(http.buildRestUrl(config.table, query), {
          method: "GET",
          headers: http.buildHeaders({
            saveToken: saveToken,
          }),
        })
        .then(function (rows) {
          if (!Array.isArray(rows) || rows.length === 0) {
            return {};
          }

          return normalizeStorageMap(rows[0] && rows[0].storage_map);
        });
    }

    function flushNow(options) {
      var serialized = serializeStorageMap(state.storageMap);
      var payloadMap;
      var forceWrite = options && options.force === true;

      if (!forceWrite && serialized === state.lastSyncedSerialized) {
        return Promise.resolve(false);
      }

      if (state.writeInFlight) {
        return state.writeInFlight;
      }

      payloadMap = JSON.parse(serialized);

      var request = http
        .requestJson(http.buildRestUrl(config.table, "on_conflict=save_id"), {
          method: "POST",
          headers: http.buildHeaders({
            saveToken: state.saveToken,
            extraHeaders: {
              Prefer: "resolution=merge-duplicates,return=minimal",
            },
          }),
          body: [
            {
              save_id: state.saveId,
              save_token: state.saveToken,
              storage_map: payloadMap,
            },
          ],
          keepalive: options && options.keepalive === true,
        })
        .then(function () {
          state.lastFlushSucceeded = true;
          state.lastSyncedSerialized = serialized;
          return true;
        })
        .catch(function (error) {
          state.lastFlushSucceeded = false;
          warn(error);
          if (options && options.throwOnError === true) {
            throw error;
          }
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

    function installStorageOverride() {
      if (state.storageOverrideInstalled) {
        return;
      }

      if (!window.Laya || !window.Laya.LocalStorage) {
        throw new Error("Laya.LocalStorage 不可用，无法安装云存档覆盖层");
      }

      state.storageOverrideInstalled = true;

      var storageApi = {
        setItem: function (key, value) {
          state.storageMap[key] = String(value);
          mirrorToLocalStorage(key, state.storageMap[key]);
          notifyStorageChanged("set:" + key);
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
          notifyStorageChanged("remove:" + key);
          scheduleFlush();
        },
        clear: function () {
          var previousMap = state.storageMap;
          if (Object.keys(previousMap).length === 0) {
            return;
          }

          state.storageMap = {};
          syncLocalMirror(previousMap);
          notifyStorageChanged("clear");
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

    function restoreBoundSave(saveId, saveToken, options) {
      if (!isUuidLike(saveId) || !isUuidLike(saveToken)) {
        return Promise.reject(new Error("绑定存档标识无效"));
      }

      return fetchRemoteStorageFor(saveId, saveToken).then(function (remoteMap) {
        var sameIdentity = state.saveId === saveId && state.saveToken === saveToken;
        var shouldMerge =
          options && typeof options.mergeCurrent === "boolean"
            ? options.mergeCurrent
            : sameIdentity;
        var previousMap = cloneStorageMap(state.storageMap);
        var merged;

        if (shouldMerge) {
          merged = mergeStorageMaps(previousMap, remoteMap);
        } else {
          merged = {
            map: normalizeStorageMap(remoteMap),
            localSaveTime: getPlayerSaveTime(previousMap),
            remoteSaveTime: getPlayerSaveTime(remoteMap),
          };
        }

        setSaveIdentity(saveId, saveToken, true);
        state.storageMap = merged.map;
        state.lastSyncedSerialized = serializeStorageMap(remoteMap);
        syncLocalMirror(previousMap);
        notifyStorageChanged("restore");

        if (serializeStorageMap(state.storageMap) !== state.lastSyncedSerialized) {
          scheduleFlush(0);
        }

        log(
          "已恢复账号绑定存档。",
          "localSaveTime=" + merged.localSaveTime,
          "remoteSaveTime=" + merged.remoteSaveTime
        );

        return {
          remoteMap: remoteMap,
          merged: merged,
        };
      });
    }

    function init() {
      ensureCloudIdentity();
      installFlushHooks();

      var legacyMap = readLegacyStorage();
      var remoteMap = {};

      return fetchRemoteStorageFor(state.saveId, state.saveToken)
        .catch(function (error) {
          warn(error);
          return {};
        })
        .then(function (fetchedRemoteMap) {
          remoteMap = fetchedRemoteMap;

          var merged = mergeStorageMaps(legacyMap, remoteMap);
          state.storageMap = merged.map;
          state.lastSyncedSerialized = serializeStorageMap(remoteMap);
          syncLocalMirror({});
          installStorageOverride();
          notifyStorageChanged("init");

          if (serializeStorageMap(state.storageMap) !== state.lastSyncedSerialized) {
            scheduleFlush(0);
          }

          log(
            "云存档已接管 Laya.LocalStorage。",
            "localSaveTime=" + merged.localSaveTime,
            "remoteSaveTime=" + merged.remoteSaveTime
          );
        });
    }

    return {
      init: init,
      flushNow: flushNow,
      restoreBoundSave: restoreBoundSave,
      getSaveIdentity: function () {
        return {
          saveId: state.saveId,
          saveToken: state.saveToken,
        };
      },
      getStorageMap: function () {
        return cloneStorageMap(state.storageMap);
      },
      getPlayerProfile: function () {
        return extractPlayerProfile(state.storageMap);
      },
      getSaveLink: buildSaveUrl,
      copySaveLink: function () {
        return window.copyCloudSaveLink();
      },
    };
  }

  function hashStringToSafeInt(value) {
    var text = String(value || "");
    var hash = 0;
    var mod = 9007199254740881;
    var i;

    for (i = 0; i < text.length; i += 1) {
      hash = (hash * 131 + text.charCodeAt(i)) % mod;
    }

    return hash > 0 ? hash : 1;
  }

  function mapUserIdForGame(userId) {
    if (typeof userId === "number" && Number.isFinite(userId) && userId > 0) {
      return userId;
    }

    if (!isNonEmptyString(userId)) {
      return 0;
    }

    var text = String(userId).trim();
    var hex = text.replace(/-/g, "").toLowerCase();

    if (/^[0-9a-f]+$/.test(hex) && hex.length >= 13) {
      var mapped = parseInt(hex.slice(0, 13), 16);
      if (Number.isFinite(mapped) && mapped > 0) {
        return mapped;
      }
    }

    return hashStringToSafeInt(text);
  }

  function createAccountController(config, http, cloudSaveController) {
    var sessionStorage = getRawLocalStorage();
    var state = {
      session: null,
      accountRow: null,
      syncTimer: 0,
      panel: null,
      initialized: false,
      available: true,
    };

    function log() {
      console.info.apply(console, ["[Account]"].concat(Array.prototype.slice.call(arguments)));
    }

    function warn() {
      console.warn.apply(console, ["[Account]"].concat(Array.prototype.slice.call(arguments)));
    }

    function normalizeSessionPayload(payload) {
      var source = payload && typeof payload === "object" ? payload : {};
      var user = source.user && typeof source.user === "object" ? source.user : {};
      var userId = isNonEmptyString(source.user_id)
        ? source.user_id.trim()
        : isNonEmptyString(source.userId)
          ? source.userId.trim()
          : isNonEmptyString(user.id)
            ? user.id.trim()
            : "";
      var accountName = isNonEmptyString(source.account_name)
        ? source.account_name.trim()
        : isNonEmptyString(source.accountName)
          ? source.accountName.trim()
          : isNonEmptyString(user.account)
            ? user.account.trim()
            : "";
      var accessToken = isNonEmptyString(source.session_token)
        ? source.session_token
        : isNonEmptyString(source.access_token)
          ? source.access_token
          : isNonEmptyString(source.accessToken)
            ? source.accessToken
            : "";

      if (!isUuidLike(userId) || !isNonEmptyString(accessToken)) {
        return null;
      }

      return {
        userId: userId,
        accountName: accountName,
        accessToken: accessToken,
      };
    }

    function buildSession(userId, accountName, accessToken) {
      return {
        access_token: accessToken,
        token_type: "game-account",
        user: {
          id: userId,
          email: "",
          account: accountName || "",
        },
      };
    }

    function persistSession() {
      if (!sessionStorage) {
        return;
      }

      try {
        if (!isSignedIn()) {
          sessionStorage.removeItem(config.sessionStorageKey);
          return;
        }

        sessionStorage.setItem(
          config.sessionStorageKey,
          JSON.stringify({
            userId: state.session.user.id,
            accountName: state.session.user.account || "",
            accessToken: state.session.access_token,
          })
        );
      } catch (error) {
        warn("保存本地账号会话失败", error);
      }
    }

    function clearSession() {
      state.session = null;
      state.accountRow = null;
      persistSession();
    }

    function saveSession(payload) {
      var normalized = normalizeSessionPayload(payload);
      if (!normalized) {
        throw new Error("账号会话无效，请重新登录");
      }

      state.session = buildSession(
        normalized.userId,
        normalized.accountName,
        normalized.accessToken
      );
      persistSession();
      return state.session;
    }

    function restorePersistedSession() {
      if (!sessionStorage) {
        return false;
      }

      try {
        var raw = sessionStorage.getItem(config.sessionStorageKey);
        var payload = raw ? readJson(raw, null) : null;
        var normalized = normalizeSessionPayload(payload);

        if (!normalized) {
          sessionStorage.removeItem(config.sessionStorageKey);
          return false;
        }

        state.session = buildSession(
          normalized.userId,
          normalized.accountName,
          normalized.accessToken
        );
        return true;
      } catch (error) {
        warn("恢复本地账号会话失败", error);
        return false;
      }
    }

    function isSignedIn() {
      return !!(state.session && state.session.user && state.session.access_token);
    }

    function getAccessToken() {
      return isSignedIn() ? state.session.access_token : "";
    }

    function getSessionUserId() {
      return isSignedIn() ? state.session.user.id : "";
    }

    function getCurrentProfile() {
      return cloudSaveController.getPlayerProfile();
    }

    function mergeProfileOverrides(overrides) {
      var base = getCurrentProfile();
      var source = overrides && typeof overrides === "object" ? overrides : {};

      if (isNonEmptyString(source.nick)) {
        base.nick = source.nick.trim();
      }

      if (isNonEmptyString(source.avatarUrl)) {
        base.avatarUrl = source.avatarUrl;
      }

      if (isNonEmptyString(source.province)) {
        base.province = source.province.trim();
      }

      if (typeof source.bestStar === "number" && !Number.isNaN(source.bestStar)) {
        base.bestStar = Math.max(0, Math.floor(source.bestStar));
      }

      if (!isNonEmptyString(base.nick)) {
        base.nick = "无名";
      }
      if (!isNonEmptyString(base.avatarUrl)) {
        base.avatarUrl = buildDefaultAvatarPath(base.gameAvatar || 1);
      }
      if (!isNonEmptyString(base.province)) {
        base.province = "未知";
      }

      return base;
    }

    function shortValue(value) {
      var text = String(value || "");
      if (text.length <= 16) {
        return text;
      }
      return text.slice(0, 8) + "..." + text.slice(-4);
    }

    function selectAccountRow() {
      if (!isSignedIn()) {
        return Promise.resolve(null);
      }

      var query =
        "select=user_id,display_name,avatar_url,province,save_id,save_token,best_star,updated_at" +
        "&user_id=eq." +
        encodeURIComponent(getSessionUserId()) +
        "&limit=1";

      return http
        .requestJson(http.buildRestUrl(config.accountTable, query), {
          method: "GET",
          headers: http.buildHeaders({
            sessionToken: getAccessToken(),
          }),
        })
        .then(function (rows) {
          state.accountRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
          return state.accountRow;
        });
    }

    function upsertAccountRow(row) {
      return http
        .requestJson(http.buildRestUrl(config.accountTable, "on_conflict=user_id"), {
          method: "POST",
          headers: http.buildHeaders({
            sessionToken: getAccessToken(),
            extraHeaders: {
              Prefer: "resolution=merge-duplicates,return=representation",
            },
          }),
          body: [row],
        })
        .then(function (rows) {
          state.accountRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : state.accountRow;
          updatePanelState();
          return state.accountRow;
        });
    }

    function syncProfileNow(overrides) {
      if (!isSignedIn()) {
        return Promise.resolve(null);
      }

      var profile = mergeProfileOverrides(overrides);
      var row = {
        user_id: getSessionUserId(),
        display_name: profile.nick,
        avatar_url: profile.avatarUrl,
        province: profile.province,
        save_id: state.accountRow && state.accountRow.save_id ? state.accountRow.save_id : null,
        save_token:
          state.accountRow && state.accountRow.save_token ? state.accountRow.save_token : null,
        best_star: Math.max(0, profile.bestStar),
      };

      return upsertAccountRow(row);
    }

    function queueProfileSync(overrides, delayMs) {
      if (!isSignedIn()) {
        return;
      }

      if (state.syncTimer) {
        window.clearTimeout(state.syncTimer);
      }

      state.syncTimer = window.setTimeout(function () {
        state.syncTimer = 0;
        syncProfileNow(overrides).catch(function (error) {
          warn("同步账号资料失败", error);
        });
      }, typeof delayMs === "number" ? delayMs : config.accountSyncDebounceMs);
    }

    function restoreBoundSave(options) {
      if (!isSignedIn()) {
        return Promise.resolve(false);
      }

      return selectAccountRow().then(function (row) {
        if (!row || !isUuidLike(row.save_id) || !isUuidLike(row.save_token)) {
          updatePanelState();
          return false;
        }

        return cloudSaveController
          .restoreBoundSave(String(row.save_id), String(row.save_token), {
            mergeCurrent:
              options && typeof options.mergeCurrent === "boolean"
                ? options.mergeCurrent
                : false,
          })
          .then(function () {
            updatePanelState();
            return true;
          });
      });
    }

    function bindCurrentSave() {
      if (!isSignedIn()) {
        return Promise.reject(new Error("请先登录账号"));
      }

      var identity = cloudSaveController.getSaveIdentity();
      var profile = mergeProfileOverrides();

      return cloudSaveController
        .flushNow({
          force: true,
          throwOnError: true,
        })
        .then(function () {
          return http.requestJson(http.buildRpcUrl(config.bindSaveRpc), {
            method: "POST",
            headers: http.buildHeaders({
              sessionToken: getAccessToken(),
              saveToken: identity.saveToken,
            }),
            body: {
              p_save_id: identity.saveId,
              p_save_token: identity.saveToken,
              p_display_name: profile.nick,
              p_avatar_url: profile.avatarUrl,
              p_province: profile.province,
              p_best_star: Math.max(0, profile.bestStar),
            },
          });
        })
        .then(function (payload) {
          return selectAccountRow().then(function () {
            updatePanelState();
            return payload;
          });
        });
    }

    function fetchLeaderboard(scope, province) {
      return http
        .requestJson(http.buildRpcUrl(config.leaderboardRpc), {
          method: "POST",
          headers: http.buildHeaders({
            sessionToken: getAccessToken(),
          }),
          body: {
            p_scope: scope,
            p_limit: config.leaderboardLimit,
            p_province: scope === "province" ? province : null,
            p_user_id: isSignedIn() ? getSessionUserId() : null,
          },
        })
        .then(function (payload) {
          var source = payload && typeof payload === "object" ? payload : {};
          var rankList = Array.isArray(source.rankList) ? source.rankList : [];

          return {
            rank: typeof source.rank === "number" ? source.rank : -1,
            rankList: rankList.map(function (item, index) {
              var entry = item && typeof item === "object" ? item : {};
              var info = entry.info && typeof entry.info === "object" ? entry.info : {};
              var provinceName = isNonEmptyString(entry.province)
                ? entry.province
                : isNonEmptyString(entry.p)
                  ? entry.p
                  : "未知";
              var avatarUrl = isNonEmptyString(info.av) ? info.av : buildDefaultAvatarPath(1);

              return {
                userId: mapUserIdForGame(entry.userId),
                rank:
                  typeof entry.rank === "number" && !Number.isNaN(entry.rank)
                    ? entry.rank
                    : index + 1,
                star:
                  typeof entry.star === "number" && !Number.isNaN(entry.star)
                    ? Math.max(0, Math.floor(entry.star))
                    : 0,
                p: provinceName,
                province: provinceName,
                info: {
                  nk: isNonEmptyString(info.nk) ? info.nk : "无名",
                  av: avatarUrl,
                },
              };
            }),
          };
        });
    }

    function buildGameLoginData() {
      var profile = getCurrentProfile();

      return {
        authentication: getAccessToken(),
        userId: isSignedIn() ? mapUserIdForGame(getSessionUserId()) : 0,
        attach: {
          province: profile.province,
        },
      };
    }

    function buildPanelStatusText() {
      var identity = cloudSaveController.getSaveIdentity();

      if (!state.available) {
        return "账号系统未就绪，当前仍可通过链接云存档继续游戏。";
      }

      if (!isSignedIn()) {
        return "未登录。当前进度仍会写入数据库链接存档，登录后可绑定账号并跨设备恢复。";
      }

      return [
        "已登录：" + (state.session.user.account || shortValue(state.session.user.id)),
        state.accountRow && state.accountRow.save_id
          ? "已绑定存档：" + shortValue(state.accountRow.save_id)
          : "尚未绑定当前存档",
        "当前链接存档：" + shortValue(identity.saveId),
      ].join("\n");
    }

    function setPanelMessage(text, isError) {
      if (!state.panel || !state.panel.message) {
        return;
      }

      state.panel.message.textContent = text || "";
      state.panel.message.dataset.error = isError ? "1" : "0";
    }

    function setPanelBusy(isBusy) {
      if (!state.panel) {
        return;
      }

      var allButtons = state.panel.root.querySelectorAll("button");
      var i;

      for (i = 0; i < allButtons.length; i += 1) {
        allButtons[i].disabled = !!isBusy;
      }
    }

    function updatePanelState() {
      if (!state.panel) {
        return;
      }

      var signedIn = isSignedIn();
      state.panel.status.textContent = buildPanelStatusText();
      state.panel.authSection.hidden = signedIn;

      if (signedIn) {
        state.panel.account.value = state.session.user.account || state.panel.account.value;
        state.panel.password.value = "";
      }

      state.panel.bindButton.disabled = !signedIn;
      state.panel.restoreButton.disabled =
        !signedIn || !(state.accountRow && state.accountRow.save_id && state.accountRow.save_token);
      state.panel.signOutButton.disabled = !signedIn;
    }

    function closePanel() {
      if (!state.panel) {
        return;
      }

      state.panel.backdrop.hidden = true;
      state.panel.password.value = "";
      setPanelMessage("", false);
    }

    function openPanel() {
      if (!state.panel) {
        return;
      }

      updatePanelState();
      state.panel.backdrop.hidden = false;
    }

    function requireCredentials() {
      var account = state.panel ? state.panel.account.value.trim() : "";
      var password = state.panel ? state.panel.password.value : "";

      if (!account || !password) {
        throw new Error("请输入账号和密码");
      }

      return {
        account: account,
        password: password,
      };
    }

    function withPanelAction(action) {
      return function () {
        setPanelMessage("", false);
        setPanelBusy(true);

        Promise.resolve()
          .then(action)
          .then(function (result) {
            var outcome =
              result && typeof result === "object" && !Array.isArray(result)
                ? result
                : {
                    message: result,
                    close: false,
                  };

            updatePanelState();

            if (outcome.close === true) {
              closePanel();
              return;
            }

            if (isNonEmptyString(outcome.message)) {
              setPanelMessage(outcome.message, false);
            }
          })
          .catch(function (error) {
            setPanelMessage(error && error.message ? error.message : String(error), true);
          })
          .finally(function () {
            setPanelBusy(false);
          });
      };
    }

    function createAccountPanel() {
      if (state.panel) {
        updatePanelState();
        return;
      }

      var style = document.createElement("style");
      style.textContent = [
        "#laya-account-fab{position:fixed;top:12px;right:12px;z-index:2147483602;border:0;border-radius:999px;background:#111827;color:#fff;padding:10px 14px;font:600 14px/1 sans-serif;box-shadow:0 12px 30px rgba(17,24,39,.28);}",
        "#laya-account-backdrop{position:fixed;inset:0;z-index:2147483601;background:rgba(15,23,42,.42);display:flex;align-items:flex-start;justify-content:flex-end;padding:64px 12px 12px;box-sizing:border-box;}",
        "#laya-account-backdrop[hidden]{display:none !important;}",
        "#laya-account-dialog{width:min(360px,100%);background:#fff;border-radius:20px;box-shadow:0 20px 60px rgba(15,23,42,.3);padding:18px;box-sizing:border-box;font:14px/1.5 sans-serif;color:#0f172a;}",
        "#laya-account-dialog h2{margin:0;font:700 18px/1.2 sans-serif;}",
        "#laya-account-dialog pre{margin:10px 0 0;padding:12px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;white-space:pre-wrap;font:12px/1.5 ui-monospace,Consolas,monospace;color:#334155;}",
        "#laya-account-dialog label{display:block;margin-top:12px;font:600 13px/1.4 sans-serif;color:#334155;}",
        "#laya-account-dialog input{width:100%;margin-top:6px;border:1px solid #cbd5e1;border-radius:12px;padding:10px 12px;box-sizing:border-box;font:14px/1.2 sans-serif;}",
        "#laya-account-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;}",
        "#laya-account-actions button,#laya-account-secondary button{border:0;border-radius:12px;padding:10px 12px;font:600 13px/1.2 sans-serif;cursor:pointer;}",
        "#laya-account-actions button{background:#111827;color:#fff;}",
        "#laya-account-secondary{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;}",
        "#laya-account-secondary button{background:#e2e8f0;color:#0f172a;}",
        "#laya-account-header{display:flex;align-items:center;justify-content:flex-start;gap:10px;}",
        "#laya-account-hint{margin-top:12px;color:#475569;font-size:12px;}",
        "#laya-account-message{margin-top:12px;min-height:20px;font-size:12px;color:#0f766e;}",
        "#laya-account-message[data-error='1']{color:#b91c1c;}",
        "@media (max-width:640px){#laya-account-fab{top:10px;right:10px;padding:9px 12px;}#laya-account-backdrop{padding-top:56px;}#laya-account-dialog{width:100%;border-radius:18px;padding:16px;}}",
      ].join("");
      document.head.appendChild(style);

      var fab = document.createElement("button");
      fab.id = "laya-account-fab";
      fab.type = "button";
      fab.textContent = "账号";

      var backdrop = document.createElement("div");
      backdrop.id = "laya-account-backdrop";
      backdrop.hidden = true;
      backdrop.innerHTML = [
        '<div id="laya-account-dialog" role="dialog" aria-modal="true" aria-label="账号同步面板">',
        '  <div id="laya-account-header">',
        "    <h2>账号同步</h2>",
        "  </div>",
        '  <pre id="laya-account-status"></pre>',
        '  <div id="laya-account-auth">',
        '    <label>账号<input id="laya-account-name" type="text" autocomplete="username" placeholder="请输入自定义账号" /></label>',
        '    <label>密码<input id="laya-account-password" type="password" autocomplete="current-password" placeholder="请输入密码" /></label>',
        '    <div id="laya-account-actions">',
        '      <button type="button" data-action="signup">注册并登录</button>',
        '      <button type="button" data-action="signin">登录</button>',
        "    </div>",
        "  </div>",
        '  <div id="laya-account-secondary">',
        '    <button type="button" data-action="bind">绑定当前存档</button>',
        '    <button type="button" data-action="restore">恢复账号存档</button>',
        '    <button type="button" data-action="copy-link">复制存档链接</button>',
        '    <button type="button" data-action="signout">登出</button>',
        "  </div>",
        '  <div id="laya-account-hint">注册后可直接用账号密码跨设备登录，并恢复已绑定的云存档。</div>',
        '  <div id="laya-account-message" data-error="0"></div>',
        "</div>",
      ].join("");

      document.body.appendChild(fab);
      document.body.appendChild(backdrop);

      state.panel = {
        root: backdrop,
        backdrop: backdrop,
        fab: fab,
        dialog: backdrop.querySelector("#laya-account-dialog"),
        status: backdrop.querySelector("#laya-account-status"),
        authSection: backdrop.querySelector("#laya-account-auth"),
        account: backdrop.querySelector("#laya-account-name"),
        password: backdrop.querySelector("#laya-account-password"),
        message: backdrop.querySelector("#laya-account-message"),
        bindButton: backdrop.querySelector('[data-action="bind"]'),
        restoreButton: backdrop.querySelector('[data-action="restore"]'),
        signOutButton: backdrop.querySelector('[data-action="signout"]'),
      };

      function closeFromOutsideEvent(event) {
        if (!state.panel || !state.panel.dialog) {
          return;
        }

        if (state.panel.backdrop.hidden) {
          return;
        }

        var target = event.target;
        if (target && state.panel.dialog.contains(target)) {
          return;
        }

        if (target && state.panel.fab && state.panel.fab.contains(target)) {
          return;
        }

        if (event.type === "mousedown" && event.button !== undefined && event.button !== 0) {
          return;
        }

        if (typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        if (typeof event.stopPropagation === "function") {
          event.stopPropagation();
        }
        closePanel();
      }

      fab.addEventListener("click", function (event) {
        if (typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        if (typeof event.stopPropagation === "function") {
          event.stopPropagation();
        }

        if (state.panel && !state.panel.backdrop.hidden) {
          closePanel();
          return;
        }

        openPanel();
      });
      backdrop.addEventListener("pointerdown", closeFromOutsideEvent);
      document.addEventListener("mousedown", closeFromOutsideEvent, true);
      document.addEventListener("touchstart", closeFromOutsideEvent, true);
      document.addEventListener(
        "keydown",
        function (event) {
          if (!state.panel || state.panel.backdrop.hidden) {
            return;
          }

          if (event.key !== "Escape") {
            return;
          }

          if (typeof event.preventDefault === "function") {
            event.preventDefault();
          }
          if (typeof event.stopPropagation === "function") {
            event.stopPropagation();
          }
          closePanel();
        },
        true
      );
      backdrop
        .querySelector('[data-action="signup"]')
        .addEventListener(
          "click",
          withPanelAction(function () {
            if (isSignedIn()) {
              return {
                message: "当前已登录，如需切换账号请先登出。",
              };
            }

            var credentials = requireCredentials();

            return http
              .requestJson(http.buildRpcUrl(config.registerAccountRpc), {
                method: "POST",
                body: {
                  p_account_name: credentials.account,
                  p_password: credentials.password,
                },
              })
              .then(function (payload) {
                saveSession(payload);
                return afterSignedIn().then(function () {
                  return {
                    close: true,
                  };
                });
              });
          })
        );
      backdrop
        .querySelector('[data-action="signin"]')
        .addEventListener(
          "click",
          withPanelAction(function () {
            if (isSignedIn()) {
              return {
                message: "当前已登录，如需切换账号请先登出。",
              };
            }

            var credentials = requireCredentials();

            return http
              .requestJson(http.buildRpcUrl(config.loginAccountRpc), {
                method: "POST",
                body: {
                  p_account_name: credentials.account,
                  p_password: credentials.password,
                },
              })
              .then(function (payload) {
                saveSession(payload);
                return afterSignedIn().then(function () {
                  return {
                    close: true,
                  };
                });
              });
          })
        );
      backdrop
        .querySelector('[data-action="bind"]')
        .addEventListener(
          "click",
          withPanelAction(function () {
            return bindCurrentSave().then(function () {
              return {
                close: true,
              };
            });
          })
        );
      backdrop
        .querySelector('[data-action="restore"]')
        .addEventListener(
          "click",
          withPanelAction(function () {
            return restoreBoundSave({ mergeCurrent: false }).then(function (restored) {
              if (!restored) {
                return "当前账号还没有绑定存档。";
              }

              return {
                close: true,
              };
            });
          })
        );
      backdrop
        .querySelector('[data-action="copy-link"]')
        .addEventListener(
          "click",
          withPanelAction(function () {
            return cloudSaveController.copySaveLink().then(function () {
              return "存档链接已复制。";
            });
          })
        );
      backdrop
        .querySelector('[data-action="signout"]')
        .addEventListener(
          "click",
          withPanelAction(function () {
            return Promise.resolve()
              .then(function () {
                if (!isSignedIn()) {
                  return null;
                }

                return http.requestJson(http.buildRpcUrl(config.logoutAccountRpc), {
                  method: "POST",
                  headers: http.buildHeaders({
                    sessionToken: getAccessToken(),
                  }),
                  body: {},
                });
              })
              .catch(function (error) {
                warn("退出账号失败", error);
                return null;
              })
              .then(function () {
                clearSession();
                updatePanelState();
                return "已退出登录。";
              });
          })
        );

      updatePanelState();
    }

    function afterSignedIn() {
      return selectAccountRow()
        .then(function () {
          return restoreBoundSave({ mergeCurrent: false }).catch(function (error) {
            warn("恢复账号存档失败", error);
            return false;
          });
        })
        .then(function () {
          return syncProfileNow();
        })
        .then(function () {
          updatePanelState();
        });
    }

    function init() {
      if (state.initialized) {
        updatePanelState();
        return Promise.resolve();
      }

      state.initialized = true;
      createAccountPanel();
      restorePersistedSession();

      if (!isSignedIn()) {
        openPanel();
        log("账号系统已就绪。");
        return Promise.resolve();
      }

      return selectAccountRow()
        .then(function (row) {
          if (!row) {
            clearSession();
            updatePanelState();
            return null;
          }

          return afterSignedIn();
        })
        .catch(function (error) {
          warn("恢复账号会话失败", error);
          clearSession();
          updatePanelState();
          return null;
        })
        .then(function () {
          updatePanelState();
          log("账号系统已就绪。");
        });
    }

    return {
      init: init,
      isSignedIn: isSignedIn,
      getCurrentProfile: getCurrentProfile,
      getCurrentSession: function () {
        return state.session;
      },
      getGameLoginData: buildGameLoginData,
      syncProfileNow: syncProfileNow,
      queueProfileSync: queueProfileSync,
      bindCurrentSave: bindCurrentSave,
      restoreBoundSave: restoreBoundSave,
      fetchLeaderboard: fetchLeaderboard,
      openPanel: openPanel,
      updatePanelState: updatePanelState,
    };
  }

  function createGameRequestBridge(cloudSaveController, accountController) {
    function reportSuccess(callbacks, data) {
      if (callbacks && typeof callbacks.success === "function") {
        window.setTimeout(function () {
          callbacks.success({
            data: data,
          });
        }, 0);
      }
    }

    function reportFailure(callbacks, error) {
      if (callbacks && typeof callbacks.fail === "function") {
        window.setTimeout(function () {
          callbacks.fail(error && error.message ? error.message : String(error));
        }, 0);
      }
    }

    function parsePath(rawPath) {
      var value = isNonEmptyString(rawPath) ? rawPath : "";
      var index = value.indexOf("?");

      return {
        path: index >= 0 ? value.slice(0, index) : value,
        query: new URLSearchParams(index >= 0 ? value.slice(index + 1) : ""),
      };
    }

    function normalizeProfilePayload(payload) {
      var source = payload && typeof payload === "object" ? payload : {};
      var profile = {};

      if (isNonEmptyString(source.nk)) {
        profile.nick = source.nk;
      }
      if (isNonEmptyString(source.av)) {
        profile.avatarUrl = source.av;
      }
      if (isNonEmptyString(source.province)) {
        profile.province = source.province;
      } else if (isNonEmptyString(source.p)) {
        profile.province = source.p;
      }
      if (typeof source.star === "number" && !Number.isNaN(source.star)) {
        profile.bestStar = source.star;
      }

      return profile;
    }

    function routeRequest(path, payload) {
      var parsed = parsePath(path);
      var currentProfile = accountController.getCurrentProfile();

      switch (parsed.path) {
        case "sys/user/login":
          return Promise.resolve(accountController.getGameLoginData());

        case "sys/user/info":
          return accountController
            .syncProfileNow(normalizeProfilePayload(payload))
            .then(function () {
              return {
                ok: true,
              };
            })
            .catch(function () {
              return {
                ok: true,
              };
            });

        case "sys/server/time":
          return Promise.resolve(Date.now());

        case "zyyad/game/start":
          accountController.queueProfileSync(null, 0);
          return Promise.resolve({
            ok: true,
          });

        case "zyyad/game/end":
          accountController.queueProfileSync(
            {
              bestStar: Math.max(
                0,
                clampInteger(parsed.query.get("star"), 0, 999999, currentProfile.bestStar || 0)
              ),
            },
            0
          );
          return Promise.resolve({
            ok: true,
          });

        case "zyyad/game/country/list":
          return accountController.fetchLeaderboard("country", currentProfile.province);

        case "zyyad/game/province/detail/list":
          return accountController.fetchLeaderboard("province", currentProfile.province);

        case "bestRank":
          accountController.queueProfileSync(null, 0);
          return Promise.resolve({
            ok: true,
          });

        case "sys/oa/point/add/new":
          return Promise.resolve({
            ok: true,
          });

        default:
          return Promise.resolve({
            ok: true,
          });
      }
    }

    function handleGameRequest(path, payload, callbacks, method) {
      Promise.resolve()
        .then(function () {
          return routeRequest(path, payload, method);
        })
        .then(function (data) {
          reportSuccess(callbacks, data);
        })
        .catch(function (error) {
          console.error("[WebPatch] request failed", path, error);
          reportFailure(callbacks, error);
        });
    }

    return {
      handleGameRequest: handleGameRequest,
    };
  }

  var patchState = {
    ready: Promise.resolve(),
    handleGameRequest: function (path, payload, callbacks, method) {
      if (callbacks && typeof callbacks.fail === "function") {
        window.setTimeout(function () {
          callbacks.fail("web platform patch is not ready");
        }, 0);
      }
    },
  };
  var cloudSaveConfig = normalizeCloudSaveConfig(window.__SUPABASE_SAVE__);

  window.__LayaWebPlatformPatch = patchState;

  if (!cloudSaveConfig.enabled) {
    patchState.ready = Promise.resolve();
    return;
  }

  if (!cloudSaveConfig.supabaseUrl || !cloudSaveConfig.anonKey) {
    patchState.ready = Promise.resolve().then(function () {
      console.error("[CloudSave] enabled=true 但 Supabase 配置不完整，已跳过云存档初始化。");
    });
    return;
  }

  var http = createSupabaseHttp(cloudSaveConfig);
  var accountController;
  var cloudSaveController = createCloudSaveController(cloudSaveConfig, http, {
    onStorageChanged: function () {
      if (accountController) {
        accountController.queueProfileSync();
      }
    },
  });

  accountController = createAccountController(cloudSaveConfig, http, cloudSaveController);
  patchState.cloudSave = cloudSaveController;
  patchState.account = accountController;
  patchState.openAccountPanel = function () {
    accountController.openPanel();
  };
  patchState.bindCurrentSave = function () {
    return accountController.bindCurrentSave();
  };
  patchState.restoreBoundSave = function () {
    return accountController.restoreBoundSave({
      mergeCurrent: false,
    });
  };
  patchState.getStatus = function () {
    var session = accountController.getCurrentSession();
    var identity = cloudSaveController.getSaveIdentity();
    return {
      signedIn: !!(session && session.user),
      userId: session && session.user ? session.user.id : "",
      account: session && session.user ? session.user.account || "" : "",
      email: "",
      saveId: identity.saveId,
      saveToken: identity.saveToken,
      profile: cloudSaveController.getPlayerProfile(),
    };
  };
  patchState.handleGameRequest = createGameRequestBridge(
    cloudSaveController,
    accountController
  ).handleGameRequest;
  patchState.ready = cloudSaveController
    .init()
    .catch(function (error) {
      console.error("[CloudSave] 初始化失败。", error);
    })
    .then(function () {
      return accountController.init();
    })
    .catch(function (error) {
      console.error("[Account] 初始化失败。", error);
    });
})();
