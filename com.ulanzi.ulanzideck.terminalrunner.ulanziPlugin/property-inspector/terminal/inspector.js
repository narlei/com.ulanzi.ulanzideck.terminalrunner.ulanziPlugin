let actionSetting = {
  title: "Run",
  command: "",
  macTerminal: "iterm2",
  timeoutMs: 30000,
  autoCloseTerminal: "off",
  closeDelayMs: 1200,
};

let form = null;
const SAVE_DEBOUNCE_MS = 120;
const SETTINGS_CMD = "setSettings";

$UD.connect("com.ulanzi.ulanzideck.terminalrunner.run");

$UD.onConnected(() => {
  form = document.querySelector("#property-inspector");
  const wrapper = document.querySelector("#wrapper");

  if (!form || !wrapper) {
    return;
  }

  wrapper.classList.remove("hidden");

  const syncSettingsDebounced = Utils.debounce(syncSettings, SAVE_DEBOUNCE_MS);

  form.addEventListener("input", syncSettingsDebounced);
  form.addEventListener("change", syncSettings);
  window.addEventListener("beforeunload", syncSettings);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      syncSettings();
    }
  });
});

$UD.onAdd((jsonObj) => {
  if (jsonObj && jsonObj.param) {
    applySettings(jsonObj.param);
  }
});

$UD.onParamFromApp((jsonObj) => {
  if (jsonObj && jsonObj.param) {
    applySettings(jsonObj.param);
  }
});

$UD.onParamFromPlugin((jsonObj) => {
  if (jsonObj && jsonObj.param) {
    applySettings(jsonObj.param);
  }
});

$UD.onDidReceiveSettings((jsonObj) => {
  if (jsonObj && jsonObj.settings) {
    applySettings(jsonObj.settings);
  }
});

function applySettings(params) {
  actionSetting = normalizeSettings(params || {});

  if (!form) {
    return;
  }

  Utils.setFormValue(actionSetting, form);
}

function normalizeSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const timeoutMs = Number(input.timeoutMs);
  const closeDelayMs = Number(input.closeDelayMs);

  return {
    title: typeof input.title === "string" && input.title.trim() ? input.title : "Run",
    command: typeof input.command === "string" ? input.command : "",
    macTerminal: input.macTerminal === "terminal" ? "terminal" : "iterm2",
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 300000
        ? Math.floor(timeoutMs)
        : 30000,
    autoCloseTerminal: input.autoCloseTerminal === "on" ? "on" : "off",
    closeDelayMs:
      Number.isFinite(closeDelayMs) && closeDelayMs >= 0 && closeDelayMs <= 30000
        ? Math.floor(closeDelayMs)
        : 1200,
  };
}

function syncSettings() {
  if (!form) {
    return;
  }

  const next = normalizeSettings(Utils.getFormValue(form));
  actionSetting = next;

  $UD.sendParamFromPlugin(actionSetting);
  sendSetSettingsFallback(actionSetting);
}

function sendSetSettingsFallback(settings) {
  if (typeof $UD.send !== "function") {
    return;
  }

  $UD.send(SETTINGS_CMD, { settings });
}
