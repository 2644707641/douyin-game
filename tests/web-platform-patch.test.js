const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const patchPath = path.join(
  __dirname,
  "..",
  "build-ctx",
  "html",
  "js",
  "web-platform-patch.js"
);

function extractNamedFunction(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);

  assert.notEqual(start, -1, `未找到函数 ${name}`);

  const bodyStart = source.indexOf("{", start);
  let depth = 0;

  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`函数 ${name} 的花括号不完整`);
}

function createAfterSignedInHarness(accountRow) {
  const calls = [];
  const source = fs.readFileSync(patchPath, "utf8");
  const functionSource = extractNamedFunction(source, "afterSignedIn");
  const context = {
    bindCurrentSave() {
      calls.push("bind");
      return Promise.resolve();
    },
    isUuidLike(value) {
      return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
    },
    reloadGameToCurrentSave() {
      calls.push("reload");
    },
    restoreBoundSave() {
      calls.push("restore");
      return Promise.resolve(true);
    },
    selectAccountRow() {
      calls.push("select");
      return Promise.resolve(accountRow);
    },
    syncProfileNow() {
      calls.push("sync");
      return Promise.resolve();
    },
    updatePanelState() {
      calls.push("update");
    },
    warn() {},
  };

  vm.runInNewContext(`${functionSource}; this.afterSignedIn = afterSignedIn;`, context);

  return {
    afterSignedIn: context.afterSignedIn,
    calls,
  };
}

function loadProductionFunctions(names, context) {
  const source = fs.readFileSync(patchPath, "utf8");
  const functionSources = names.map((name) => extractNamedFunction(source, name));
  const assignments = names.map((name) => `this.${name} = ${name};`).join("\n");

  vm.runInNewContext(`${functionSources.join("\n")}\n${assignments}`, context);
  return context;
}

test("已有绑定存档时，登录恢复完成后重载游戏", async () => {
  const harness = createAfterSignedInHarness({
    save_id: "11111111-1111-4111-8111-111111111111",
    save_token: "22222222-2222-4222-8222-222222222222",
  });

  await harness.afterSignedIn({ reloadPage: true });

  assert.deepEqual(harness.calls, ["select", "restore", "sync", "update", "reload"]);
});

test("账号尚未绑定存档时，登录自动绑定当前设备进度", async () => {
  const harness = createAfterSignedInHarness({
    save_id: null,
    save_token: null,
  });

  await harness.afterSignedIn({ reloadPage: true });

  assert.deepEqual(harness.calls, ["select", "bind", "sync", "update"]);
});

test("页面启动时恢复绑定存档但不重复重载", async () => {
  const harness = createAfterSignedInHarness({
    save_id: "11111111-1111-4111-8111-111111111111",
    save_token: "22222222-2222-4222-8222-222222222222",
  });

  await harness.afterSignedIn();

  assert.deepEqual(harness.calls, ["select", "restore", "sync", "update"]);
});

test("只有精确账号 xuwang 被授权使用升星功能", () => {
  function check(account) {
    const context = {
      isSignedIn() {
        return Boolean(account);
      },
      state: {
        session: account
          ? {
              user: { account },
            }
          : null,
      },
    };

    loadProductionFunctions(["isStarPromotionAuthorized"], context);
    return context.isStarPromotionAuthorized();
  }

  assert.equal(check("xuwang"), true);
  assert.equal(check("XuWang"), false);
  assert.equal(check("other"), false);
  assert.equal(check(""), false);
});

test("bundle 暴露调用游戏正式段位逻辑的测试桥", () => {
  const bundlePath = path.join(__dirname, "..", "build-ctx", "html", "js", "bundle.js");
  const bundleSource = fs.readFileSync(bundlePath, "utf8");

  assert.match(bundleSource, /__LayaGameTestTools/);
  assert.match(bundleSource, /promoteRankStar/);
  assert.match(bundleSource, /Pn\.instance\(\)\.zG\(1\)/);
  assert.match(bundleSource, /restoreRankStar/);
});

test("页面脚本使用本次升星修复版本避免旧 bundle 缓存", () => {
  const htmlPath = path.join(__dirname, "..", "build-ctx", "html", "index.html");
  const bootstrapPath = path.join(
    __dirname,
    "..",
    "build-ctx",
    "html",
    "js",
    "game-bootstrap.js"
  );
  const htmlSource = fs.readFileSync(htmlPath, "utf8");
  const bootstrapSource = fs.readFileSync(bootstrapPath, "utf8");

  assert.match(htmlSource, /web-platform-patch\.js\?v=merchant-rank-20260713/);
  assert.match(htmlSource, /game-bootstrap\.js\?v=merchant-rank-20260713/);
  assert.match(bootstrapSource, /bundle\.js\?v=merchant-rank-20260713/);
  assert.match(bootstrapSource, /index\.js\?v=merchant-rank-20260713/);
});

test("商人恢复最早的段位解锁与首次出现机制", () => {
  const bundlePath = path.join(__dirname, "..", "build-ctx", "html", "js", "bundle.js");
  const bundleSource = fs.readFileSync(bundlePath, "utf8");

  assert.match(
    bundleSource,
    /Px\(\)\s*\{\s*F\.instance\(\)\.player\.openProps\s*=\s*F\.instance\(\)\.rank\.ca\.id\s*>=\s*this\.Ue\.Re/
  );
  assert.match(
    bundleSource,
    /K\.instance\(\)\.Eu\("MainScene"\),\s*F\.instance\(\)\.player\.openProps\)\s*\{[\s\S]*?K\.instance\(\)\.Eu\("ShopScene",\s*!1,\s*t\)/
  );
  assert.doesNotMatch(
    bundleSource,
    /s\.openProps\s*&&\s*\(this\.shopBtn\.visible\s*=\s*!0,\s*this\.shopWalk\.visible\s*=\s*!1\)/
  );
});

test("xuwang 通过游戏运行时桥升星后强制上传并同步资料", async () => {
  const calls = [];
  const context = {
    cloudSaveController: {
      flushNow(options) {
        calls.push(["flush", options.force, options.throwOnError]);
        return Promise.resolve(true);
      },
    },
    isSignedIn() {
      return true;
    },
    state: {
      session: { user: { account: "xuwang" } },
    },
    syncProfileNow(profile) {
      calls.push(["sync", profile.bestStar]);
      return Promise.resolve();
    },
    warn() {},
    window: {
      __LayaGameTestTools: {
        promoteRankStar() {
          calls.push(["promote"]);
          return { previousStar: 4, star: 5 };
        },
        restoreRankStar(star) {
          calls.push(["restore", star]);
          return star;
        },
      },
    },
  };

  loadProductionFunctions(
    ["isStarPromotionAuthorized", "promoteCurrentPlayerStar"],
    context
  );

  const star = await context.promoteCurrentPlayerStar();

  assert.equal(star, 5);
  assert.deepEqual(calls, [
    ["promote"],
    ["flush", true, true],
    ["sync", 5],
  ]);
});

test("上传失败时通过游戏运行时桥恢复原星级", async () => {
  const calls = [];
  let flushCount = 0;
  const context = {
    cloudSaveController: {
      flushNow() {
        flushCount += 1;
        calls.push(["flush", flushCount]);
        return flushCount === 1 ? Promise.reject(new Error("upload failed")) : Promise.resolve(true);
      },
    },
    isSignedIn: () => true,
    state: { session: { user: { account: "xuwang" } } },
    syncProfileNow() {
      calls.push(["sync"]);
      return Promise.resolve();
    },
    warn() {},
    window: {
      __LayaGameTestTools: {
        promoteRankStar() {
          calls.push(["promote"]);
          return { previousStar: 4, star: 5 };
        },
        restoreRankStar(star) {
          calls.push(["restore", star]);
          return star;
        },
      },
    },
  };

  loadProductionFunctions(
    ["isStarPromotionAuthorized", "promoteCurrentPlayerStar"],
    context
  );

  await assert.rejects(() => context.promoteCurrentPlayerStar(), /upload failed/);
  assert.deepEqual(calls, [
    ["promote"],
    ["flush", 1],
    ["restore", 4],
    ["flush", 2],
  ]);
});

test("非 xuwang 直接调用升星操作也会被拒绝且无副作用", async () => {
  const calls = [];
  const context = {
    cloudSaveController: {
      flushNow() {
        calls.push("flush");
        return Promise.resolve(true);
      },
    },
    isSignedIn: () => true,
    state: { session: { user: { account: "other" } } },
    syncProfileNow() {
      calls.push("sync");
      return Promise.resolve();
    },
    warn() {},
    window: {
      __LayaGameTestTools: {
        promoteRankStar() {
          calls.push("promote");
          return { previousStar: 1, star: 2 };
        },
      },
    },
  };

  loadProductionFunctions(
    ["isStarPromotionAuthorized", "promoteCurrentPlayerStar"],
    context
  );

  await assert.rejects(() => context.promoteCurrentPlayerStar(), /无权使用/);
  assert.deepEqual(calls, []);
});

test("强制上传会等待在途写入结束后再次上传最新存档", async () => {
  let resolvePending;
  const requests = [];
  const pending = new Promise((resolve) => {
    resolvePending = resolve;
  });
  const state = {
    lastFlushSucceeded: true,
    lastSyncedSerialized: JSON.stringify({ playerData: "old" }),
    storageMap: { playerData: "promoted" },
    writeInFlight: null,
  };
  state.writeInFlight = pending.finally(() => {
    state.writeInFlight = null;
  });
  const context = {
    config: { table: "game_saves", retryDelayMs: 5000 },
    http: {
      buildHeaders: () => ({}),
      buildRestUrl: () => "/game_saves",
      requestJson(url, options) {
        requests.push({ url, options });
        return Promise.resolve();
      },
    },
    scheduleFlush() {},
    serializeStorageMap(value) {
      return JSON.stringify(value);
    },
    state,
    warn() {},
  };

  loadProductionFunctions(["flushNow"], context);
  const flushing = context.flushNow({ force: true, throwOnError: true });

  assert.equal(requests.length, 0);
  resolvePending(false);
  const result = await flushing;

  assert.equal(result, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.body[0].storage_map.playerData, "promoted");
});

test("账号面板只为 xuwang 显示并启用升星按钮", () => {
  function createContext(authorized) {
    const panel = {
      account: { value: "" },
      authSection: { hidden: false },
      bindButton: { disabled: false },
      password: { value: "secret" },
      promoteStarButton: { disabled: false },
      restoreButton: { disabled: false },
      signOutButton: { disabled: false },
      starPromotionSection: { hidden: false },
      status: { textContent: "" },
    };
    const context = {
      buildPanelStatusText: () => "status",
      isSignedIn: () => true,
      isStarPromotionAuthorized: () => authorized,
      state: {
        accountRow: null,
        panel,
        session: { user: { account: authorized ? "xuwang" : "other" } },
      },
    };

    loadProductionFunctions(["updatePanelState"], context);
    context.updatePanelState();
    return panel;
  }

  const authorizedPanel = createContext(true);
  assert.equal(authorizedPanel.starPromotionSection.hidden, false);
  assert.equal(authorizedPanel.promoteStarButton.disabled, false);

  const deniedPanel = createContext(false);
  assert.equal(deniedPanel.starPromotionSection.hidden, true);
  assert.equal(deniedPanel.promoteStarButton.disabled, true);
});
