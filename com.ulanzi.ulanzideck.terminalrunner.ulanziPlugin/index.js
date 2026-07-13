import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

import UlanziApi, { Utils } from "./plugin-common-node/index.js";

const PLUGIN_UUID = "com.ulanzi.ulanzideck.terminalrunner";
const MAX_COMMAND_LENGTH = 12000;
const RUNNING_STATE = 1;
const IDLE_STATE = 0;

const ACTION_SETTINGS = new Map();

const $UD = new UlanziApi();
$UD.connect(PLUGIN_UUID);

$UD.onConnected(() => {
  $UD.logMessage("Terminal Runner connected", "info");
});

$UD.onAdd((message) => {
  const context = message.context;
  const settings = sanitizeSettings(message.param);

  ACTION_SETTINGS.set(context, settings);
  $UD.setStateIcon(context, IDLE_STATE, buildKeyLabel(settings));

  // Pull persisted settings to avoid missing host-side values.
  $UD.getSettings(context);
});

$UD.onDidReceiveSettings((message) => {
  const context = message.context;
  const settings = sanitizeSettings(message.settings);

  ACTION_SETTINGS.set(context, settings);
  $UD.setStateIcon(context, IDLE_STATE, buildKeyLabel(settings));
});

$UD.onParamFromApp((message) => {
  onSettingsUpdate(message);
});

$UD.onParamFromPlugin((message) => {
  onSettingsUpdate(message);
});

$UD.onRun(async (message) => {
  const context = message.context;
  const mergedSettings = sanitizeSettings({
    ...(ACTION_SETTINGS.get(context) || {}),
    ...(message.param || {}),
  });

  ACTION_SETTINGS.set(context, mergedSettings);

  const validation = validateCommand(mergedSettings.command);
  if (!validation.ok) {
    $UD.toast(validation.error);
    $UD.showAlert(context);
    $UD.logMessage(`Invalid command for ${context}: ${validation.error}`, "warn");
    $UD.setStateIcon(context, IDLE_STATE, buildKeyLabel(mergedSettings));
    return;
  }

  $UD.setStateIcon(context, RUNNING_STATE, buildKeyLabel(mergedSettings));

  try {
    await runCommandInNativeTerminal(mergedSettings.command, mergedSettings);
    $UD.toast("Command sent to terminal");
    $UD.logMessage(`Command executed for ${context}`, "info");
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    $UD.toast(`Execution error: ${truncate(errMsg, 80)}`);
    $UD.showAlert(context);
    $UD.logMessage(`Execution failed for ${context}: ${errMsg}`, "error");
  } finally {
    $UD.setStateIcon(context, IDLE_STATE, buildKeyLabel(mergedSettings));
  }
});

$UD.onClear((message) => {
  if (!Array.isArray(message.param)) {
    return;
  }

  for (const item of message.param) {
    if (item && item.context) {
      ACTION_SETTINGS.delete(item.context);
    }
  }
});

function onSettingsUpdate(message) {
  const context = message.context;
  const settings = sanitizeSettings(message.param);

  if (!context) {
    return;
  }

  ACTION_SETTINGS.set(context, settings);
  $UD.setSettings(settings, context);
  $UD.setStateIcon(context, IDLE_STATE, buildKeyLabel(settings));
}

function sanitizeSettings(input) {
  const settings = input && typeof input === "object" ? input : {};

  return {
    command: typeof settings.command === "string" ? settings.command : "",
    title: typeof settings.title === "string" ? settings.title : "Run",
    macTerminal:
      settings.macTerminal === "iterm2" || settings.macTerminal === "terminal"
        ? settings.macTerminal
        : "iterm2",
    timeoutMs: normalizeTimeout(settings.timeoutMs),
    autoCloseTerminal: normalizeAutoClose(settings.autoCloseTerminal),
    closeDelayMs: normalizeCloseDelay(settings.closeDelayMs),
  };
}

function normalizeTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 30000;
  }

  if (parsed < 1000) {
    return 1000;
  }

  if (parsed > 300000) {
    return 300000;
  }

  return Math.floor(parsed);
}

function normalizeAutoClose(value) {
  return value === "on" || value === true ? "on" : "off";
}

function normalizeCloseDelay(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1200;
  }

  if (parsed < 0) {
    return 0;
  }

  if (parsed > 30000) {
    return 30000;
  }

  return Math.floor(parsed);
}

function validateCommand(command) {
  if (typeof command !== "string") {
    return { ok: false, error: "Command must be a string" };
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return { ok: false, error: "Configure a command first" };
  }

  if (trimmed.length > MAX_COMMAND_LENGTH) {
    return { ok: false, error: `Command too long (max ${MAX_COMMAND_LENGTH})` };
  }

  return { ok: true };
}

function buildKeyLabel(settings) {
  const title = settings && typeof settings.title === "string" ? settings.title.trim() : "";
  return title ? truncate(title, 10) : "Run";
}

async function runCommandInNativeTerminal(command, settings) {
  const scriptPath = await writeTempScript(command, process.platform);

  try {
    if (process.platform === "darwin") {
      await runOnMac(scriptPath, settings);
      return;
    }

    if (process.platform === "win32") {
      await runOnWindows(scriptPath, settings.timeoutMs);
      return;
    }

    throw new Error(`Unsupported platform: ${process.platform}`);
  } finally {
    // Keep file for a short time in case terminal starts asynchronously.
    setTimeout(() => {
      fs.unlink(scriptPath).catch(() => {});
    }, 30000);
  }
}

async function writeTempScript(command, platform) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ulanzi-terminal-runner-"));

  if (platform === "win32") {
    const scriptPath = path.join(tempDir, "command.ps1");
    const body = `${command}\n`;
    await fs.writeFile(scriptPath, body, "utf8");
    return scriptPath;
  }

  const scriptPath = path.join(tempDir, "command.sh");
  const body = `#!/bin/zsh\nset -e\n${command}\n`;
  await fs.writeFile(scriptPath, body, "utf8");
  await fs.chmod(scriptPath, 0o700);
  return scriptPath;
}

async function runOnMac(scriptPath, settings) {
  const preferredTerminal = settings.macTerminal || "iterm2";
  const timeoutMs = normalizeTimeout(settings.timeoutMs);
  const shellCommand = buildMacShellCommand(scriptPath, settings);
  const escapedShellCommand = escapeAppleScriptString(shellCommand);

  const itermScript = [
    'tell application id "com.googlecode.iterm2"',
    "  activate",
    "  try",
    "    if (count of windows) = 0 then",
    "      create window with default profile",
    "    end if",
    "  on error",
    "    create window with default profile",
    "  end try",
    `  tell current session of current window to write text "${escapedShellCommand}"`,
    "end tell",
  ].join("\n");

  const terminalScript = [
    'tell application "Terminal"',
    "  activate",
    `  do script "${escapedShellCommand}"`,
    "end tell",
  ].join("\n");

  if (preferredTerminal === "iterm2") {
    try {
      await runSpawn("osascript", ["-e", itermScript], timeoutMs);
      return;
    } catch (itermError) {
      // Fallback is required by requirement.
      $UD.logMessage(`iTerm2 launch failed, fallback to Terminal: ${itermError.message}`, "warning");
    }
  }

  await runSpawn("osascript", ["-e", terminalScript], timeoutMs);
}

function buildMacShellCommand(scriptPath, settings) {
  const baseCommand = `zsh ${quoteShellArg(scriptPath)}`;

  if (settings.autoCloseTerminal !== "on") {
    return baseCommand;
  }

  const delayMs = normalizeCloseDelay(settings.closeDelayMs);
  const delaySeconds = formatSleepSeconds(delayMs);
  return `${baseCommand}; sleep ${delaySeconds}; exit`;
}

function formatSleepSeconds(delayMs) {
  const fixed = (delayMs / 1000).toFixed(3);
  const trimmed = fixed.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return trimmed || "0";
}

async function runOnWindows(scriptPath, timeoutMs) {
  const normalizedTimeout = normalizeTimeout(timeoutMs);
  const psArgs = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
  ];

  try {
    await runSpawn("powershell.exe", psArgs, normalizedTimeout);
    return;
  } catch (error) {
    if (!isMissingExecutableError(error)) {
      throw error;
    }

    $UD.logMessage("powershell.exe unavailable, falling back to cmd.exe", "warning");
    const cmdScriptPath = scriptPath.replace(/\.ps1$/i, ".cmd");
    const psBody = await fs.readFile(scriptPath, "utf8");
    await fs.writeFile(cmdScriptPath, `@echo off\r\n${psBody}\r\n`, "utf8");
    await runSpawn("cmd.exe", ["/c", cmdScriptPath], normalizedTimeout);
  }
}

function isMissingExecutableError(error) {
  return Boolean(error && typeof error === "object" && error.code === "ENOENT");
}

function runSpawn(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    });

    let timedOut = false;
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      reject(new Error(`Timeout starting command: ${command}`));
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join(" | ");
      reject(
        new Error(
          `${command} exited with code ${code}${details ? `: ${truncate(details, 200)}` : ""}`,
        ),
      );
    });
  });
}

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function escapeAppleScriptString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function truncate(value, maxLen) {
  if (value.length <= maxLen) {
    return value;
  }

  return `${value.slice(0, maxLen - 3)}...`;
}

process.on("uncaughtException", (error) => {
  $UD.logMessage(`Uncaught exception: ${error.message}`, "error");
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  $UD.logMessage(`Unhandled rejection: ${msg}`, "error");
});
