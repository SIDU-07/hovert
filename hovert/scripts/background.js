/**
 * background.js
 * ---------------------------------------------------------------------------
 * hovert — background service worker (Manifest V3, type: "module").
 *
 * Content scripts run in a page's context and are subject to that page's
 * CSP, which can silently block outbound fetch() calls. To keep lookups
 * reliable on every site, the content script sends the selected text here,
 * and this worker performs the actual network request via aiService.js.
 *
 * NOTE: No history, logging, or persistence of selected text/results
 * happens anywhere in this file — lookups are handled in memory only and
 * discarded once the response is sent back to the tab.
 * ---------------------------------------------------------------------------
 */

import { getDefinition } from "./aiService.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "HOVERT_LOOKUP") return false;

  if (typeof message.text !== "string" || !message.text.trim()) {
    sendResponse({ ok: false, error: "Select a word or phrase first." });
    return false;
  }

  (async () => {
    try {
      const { hovertConfig } = await chrome.storage.local.get("hovertConfig");

      if (!hovertConfig || !hovertConfig.apiKey || !hovertConfig.endpoint || !hovertConfig.model) {
        sendResponse({
          ok: false,
          error: "Set up your API key, endpoint, and model in the hovert popup first.",
        });
        return;
      }

      const result = await getDefinition(message.text, hovertConfig, message.pageTitle);
      sendResponse({ ok: true, result });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || "Lookup failed." });
    }
  })();

  // Keep the message channel open for the async response above.
  return true;
});
