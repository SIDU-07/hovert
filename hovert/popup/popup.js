/**
 * popup.js
 * ---------------------------------------------------------------------------
 * hovert — settings popup logic.
 *
 * Persists { apiKey, endpoint, model } to chrome.storage.local under the key
 * "hovertConfig". No selection text, lookup results, or usage history is
 * ever written here or anywhere else in the extension.
 * ---------------------------------------------------------------------------
 */

const PRESET_ENDPOINTS = {
  openai: {
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  },
  gemini: {
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-1.5-flash",
  },
  groq: {
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.1-8b-instant",
  },
  custom: {
    endpoint: "",
    model: "",
  },
};

const presetEl = document.getElementById("preset");
const endpointEl = document.getElementById("endpoint");
const apiKeyEl = document.getElementById("apiKey");
const modelEl = document.getElementById("model");
const languageEl = document.getElementById("language");
const formEl = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const supportBtn = document.getElementById("support-btn");
const supportPanel = document.getElementById("support-panel");

supportBtn.addEventListener("click", () => {
  const isExpanded = supportBtn.getAttribute("aria-expanded") === "true";
  supportBtn.setAttribute("aria-expanded", String(!isExpanded));
  supportPanel.hidden = isExpanded;
});

function detectPresetFromEndpoint(endpoint) {
  if (!endpoint) return "openai";
  if (endpoint.includes("generativelanguage.googleapis.com")) return "gemini";
  if (endpoint.includes("groq.com")) return "groq";
  if (endpoint.includes("api.openai.com")) return "openai";
  return "custom";
}

async function loadSettings() {
  const { hovertConfig } = await chrome.storage.local.get("hovertConfig");

  if (hovertConfig) {
    endpointEl.value = hovertConfig.endpoint || "";
    apiKeyEl.value = hovertConfig.apiKey || "";
    modelEl.value = hovertConfig.model || "";
    languageEl.value = hovertConfig.language || "English";
    presetEl.value = detectPresetFromEndpoint(hovertConfig.endpoint);
  } else {
    // Default to OpenAI preset on first run.
    presetEl.value = "openai";
    applyPreset("openai", { onlyIfEmpty: false });
    languageEl.value = "English";
  }
}

function applyPreset(presetKey, { onlyIfEmpty } = { onlyIfEmpty: true }) {
  const preset = PRESET_ENDPOINTS[presetKey];
  if (!preset) return;
  if (!onlyIfEmpty || !endpointEl.value) endpointEl.value = preset.endpoint;
  if (!onlyIfEmpty || !modelEl.value) modelEl.value = preset.model;
}

presetEl.addEventListener("change", () => {
  applyPreset(presetEl.value, { onlyIfEmpty: false });
});

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();

  const config = {
    endpoint: endpointEl.value.trim(),
    apiKey: apiKeyEl.value.trim(),
    model: modelEl.value.trim(),
    language: (languageEl.value || "English").trim() || "English",
  };

  if (!config.endpoint || !config.apiKey || !config.model) {
    showStatus("Please fill in endpoint, API key, and model.", "error");
    return;
  }

  try {
    const endpoint = new URL(config.endpoint);
    if (!['http:', 'https:'].includes(endpoint.protocol)) {
      throw new Error("Endpoint must use HTTP or HTTPS.");
    }

    await chrome.storage.local.set({ hovertConfig: config });
    showStatus("Settings saved ✓", "success");
  } catch (err) {
    showStatus(err?.message || "Could not save settings.", "error");
  }
});

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  if (type === "success") {
    setTimeout(() => {
      statusEl.textContent = "";
      statusEl.className = "status";
    }, 2200);
  }
}

loadSettings();
