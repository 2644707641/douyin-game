(function () {
  "use strict";

  window.__SUPABASE_SAVE__ = {
    // 填好 Supabase 项目地址与匿名公钥后，将 enabled 改为 true。
    enabled: true,
    supabaseUrl: "https://nbjxlztrqgitotspsvib.supabase.co",
    // 这里使用匿名 / publishable key，不要填 service_role。
    anonKey: "sb_publishable_BjuFlOp8Tm7OFk2NXxbPAA_jo1vNsW5",
    table: "game_saves",
    saveIdParam: "save",
    saveTokenHashParam: "saveToken",
    requestTimeoutMs: 8000,
    syncDebounceMs: 1200,
    retryDelayMs: 5000,
    migratedKeys: ["playerData", "oaPointQueue", "privacy_user_agreement_v1"],
  };
})();
