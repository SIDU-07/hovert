/**
 * content.js
 * ---------------------------------------------------------------------------
 * hovert — content script.
 *
 * Listens for text selections on the page and renders a floating,
 * Shadow-DOM-isolated tooltip next to the selection with an AI-generated
 * definition + summary. No selection or result data is ever stored,
 * logged, or persisted — everything lives only in local variables for the
 * lifetime of a single tooltip.
 * ---------------------------------------------------------------------------
 */

(() => {
  const HOST_ID = "hovert-tooltip-host";
  const MIN_SELECTION_LENGTH = 1;
  const MAX_SELECTION_LENGTH = 300;

  /** @type {HTMLElement|null} */
  let hostEl = null;
  /** @type {ShadowRoot|null} */
  let shadowRoot = null;
  /** Incrementing token so stale async responses never overwrite a newer lookup. */
  let requestToken = 0;
  /** @type {SpeechSynthesisUtterance|null} */
  let activeUtterance = null;

  // ---------------------------------------------------------------------
  // Tooltip lifecycle
  // ---------------------------------------------------------------------
  function removeTooltip() {
    stopSpeech();

    if (hostEl && hostEl.parentNode) {
      hostEl.parentNode.removeChild(hostEl);
    }
    hostEl = null;
    shadowRoot = null;
  }

  function createTooltip(x, y) {
    removeTooltip();

    hostEl = document.createElement("div");
    hostEl.id = HOST_ID;
    // Fixed positioning relative to the viewport; we computed x/y from
    // getBoundingClientRect() so no scroll-offset math is needed.
    Object.assign(hostEl.style, {
      position: "fixed",
      left: `${x}px`,
      top: `${y}px`,
      zIndex: "2147483647",
      // The host itself stays a zero-size anchor point; the actual box
      // is sized/placed by the shadow content below.
    });

    shadowRoot = hostEl.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <style>${TOOLTIP_CSS}</style>
      <div class="hovert-card" part="card">
        <button class="hovert-close" aria-label="Close">×</button>
        <div class="hovert-body" id="hovert-body">
          ${loadingSkeletonHTML()}
        </div>
        <div class="hovert-footer">
          <span class="hovert-logo-dot"></span>
          <span class="hovert-brand">hovert</span>
        </div>
      </div>
    `;

    document.documentElement.appendChild(hostEl);

    shadowRoot.querySelector(".hovert-close").addEventListener("click", removeTooltip);

    // Flip above the selection if there isn't room below the viewport.
    requestAnimationFrame(() => flipIfNeeded(y));

    return shadowRoot.getElementById("hovert-body");
  }

  function flipIfNeeded(originalY) {
    if (!hostEl || !shadowRoot) return;
    const card = shadowRoot.querySelector(".hovert-card");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const viewportH = window.innerHeight;

    if (rect.bottom > viewportH - 8) {
      // Not enough room below — flip above the selection instead.
      const newTop = originalY - rect.height - 28; // 28 ~= selection line height + gap
      hostEl.style.top = `${Math.max(8, newTop)}px`;
    }

    // Clamp horizontally so the card never spills off-screen.
    const viewportW = window.innerWidth;
    const cardRect = card.getBoundingClientRect();
    if (cardRect.right > viewportW - 8) {
      const overflow = cardRect.right - (viewportW - 8);
      const currentLeft = parseFloat(hostEl.style.left || "0");
      hostEl.style.left = `${Math.max(8, currentLeft - overflow)}px`;
    }
  }

  function loadingSkeletonHTML() {
    return `
      <div class="hovert-skeleton">
        <div class="hovert-spinner"></div>
        <span class="hovert-skeleton-text">Looking it up…</span>
      </div>
    `;
  }

  function renderResult(bodyEl, text, selectedText) {
    if (!bodyEl) return;
    // Parse the "Definition:" / "Summary:" lines produced by our prompt,
    // falling back to raw text if the model didn't follow the format.
    const defMatch = text.match(/Definition:\s*(.+)/i);
    const sumMatch = text.match(/Summary:\s*(.+)/i);
    const definition = defMatch ? defMatch[1].trim() : "";
    const speakTarget = selectedText || text.trim();

    if (defMatch || sumMatch) {
      bodyEl.innerHTML = `
        ${defMatch ? `<p class="hovert-line"><span class="hovert-label-row"><span class="hovert-label">Definition</span>${speakerButtonHTML(speakTarget)}</span>${escapeHTML(definition)}</p>` : ""}
        ${sumMatch ? `<p class="hovert-line"><span class="hovert-label">Summary</span>${escapeHTML(sumMatch[1].trim())}</p>` : ""}
      `;
    } else {
      bodyEl.innerHTML = `<p class="hovert-line"><span class="hovert-label-row">${speakerButtonHTML(speakTarget)}</span>${escapeHTML(text.trim())}</p>`;
    }

    const speakerButton = bodyEl.querySelector(".hovert-speaker");
    if (speakerButton) {
      speakerButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        speakText(speakTarget, speakerButton);
      });
    }
  }

  function renderError(bodyEl, message) {
    if (!bodyEl) return;
    bodyEl.innerHTML = `<p class="hovert-error">⚠ ${escapeHTML(message)}</p>`;
  }

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function speakerButtonHTML(text) {
    return `
      <button class="hovert-speaker" type="button" aria-label="Pronounce selected word" title="Pronounce selected word" ${text ? "" : "disabled"}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M11 5 6 9H3v6h3l5 4V5Z"></path>
          <path d="M15.5 8.5a5 5 0 0 1 0 7"></path>
          <path d="M18.5 5.5a9 9 0 0 1 0 13"></path>
        </svg>
      </button>
    `;
  }

  function speakText(text, buttonEl) {
    const value = (text || "").trim();
    if (!value || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;

    stopSpeech();

    const utterance = new SpeechSynthesisUtterance(value);
    activeUtterance = utterance;
    if (buttonEl) buttonEl.classList.add("is-speaking");

    utterance.onend = utterance.onerror = () => {
      if (activeUtterance === utterance) activeUtterance = null;
      if (buttonEl) buttonEl.classList.remove("is-speaking");
    };

    window.speechSynthesis.speak(utterance);
  }

  function stopSpeech() {
    if (activeUtterance && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    activeUtterance = null;

    if (shadowRoot) {
      shadowRoot.querySelectorAll(".hovert-speaker.is-speaking").forEach((button) => {
        button.classList.remove("is-speaking");
      });
    }
  }

  // ---------------------------------------------------------------------
  // Selection handling
  // ---------------------------------------------------------------------
  function handleMouseUp(event) {
    // Ignore mouseup events originating from inside our own tooltip
    // (e.g. the user selecting text within the result to copy it).
    const path = event.composedPath ? event.composedPath() : [];
    if (hostEl && path.includes(hostEl)) return;

    // Let click handled elsewhere close any open tooltip first.
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : "";

    if (!text || text.length < MIN_SELECTION_LENGTH) {
      removeTooltip();
      return;
    }

    if (text.length > MAX_SELECTION_LENGTH) {
      removeTooltip();
      return; // Selection too long to be a "word/phrase" lookup — do nothing.
    }

    if (selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const x = Math.max(8, rect.left);
    const y = rect.bottom + 8;

    const bodyEl = createTooltip(x, y);
    requestLookup(text, bodyEl);
  }

  function requestLookup(text, bodyEl) {
    const myToken = ++requestToken;

    chrome.runtime.sendMessage(
      {
        type: "HOVERT_LOOKUP",
        text,
        pageTitle: document.title || "",
      },
      (response) => {
        // Ignore if a newer selection has started a new request, or the
        // tooltip was closed while we were waiting.
        if (myToken !== requestToken || !shadowRoot) return;

        if (chrome.runtime.lastError) {
          renderError(bodyEl, "Could not reach hovert's background service.");
          return;
        }

        if (!response) {
          renderError(bodyEl, "No response from hovert.");
          return;
        }

        if (response.ok) {
          renderResult(bodyEl, response.result, text);
          requestAnimationFrame(() => flipIfNeeded(parseFloat(hostEl.style.top || "0")));
        } else {
          renderError(bodyEl, response.error || "Lookup failed.");
        }
      }
    );
  }

  // ---------------------------------------------------------------------
  // Dismissal
  // ---------------------------------------------------------------------
  function handleMouseDown(event) {
    const path = event.composedPath ? event.composedPath() : [];
    if (hostEl && !path.includes(hostEl)) {
      removeTooltip();
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") removeTooltip();
  }

  document.addEventListener("mouseup", handleMouseUp, true);
  document.addEventListener("mousedown", handleMouseDown, true);
  document.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("scroll", removeTooltip, true);
  window.addEventListener("resize", removeTooltip, true);

  // ---------------------------------------------------------------------
  // Styles (injected into the Shadow DOM — fully isolated from host page)
  // ---------------------------------------------------------------------
  const TOOLTIP_CSS = `
    :host { all: initial; }

    .hovert-card {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-width: 220px;
      max-width: 320px;
      background: rgba(255, 255, 255, 0.72);
      backdrop-filter: blur(12px) saturate(160%);
      -webkit-backdrop-filter: blur(12px) saturate(160%);
      border: 1px solid rgba(255, 255, 255, 0.5);
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.06);
      padding: 12px 14px 8px 14px;
      color: #1a1a2e;
      position: relative;
      animation: hovert-pop 0.14s ease-out;
      box-sizing: border-box;
    }

    @keyframes hovert-pop {
      from { opacity: 0; transform: translateY(-4px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .hovert-close {
      position: absolute;
      top: 6px;
      right: 8px;
      background: transparent;
      border: none;
      font-size: 15px;
      line-height: 1;
      color: rgba(26, 26, 46, 0.45);
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
    }
    .hovert-close:hover {
      background: rgba(0, 0, 0, 0.06);
      color: rgba(26, 26, 46, 0.85);
    }

    .hovert-body {
      padding-right: 14px;
      font-size: 13.5px;
      line-height: 1.45;
    }

    .hovert-line {
      margin: 0 0 6px 0;
    }
    .hovert-line:last-child {
      margin-bottom: 0;
    }

    .hovert-label {
      display: block;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #6366f1;
      margin-bottom: 2px;
    }

    .hovert-label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 2px;
    }

    .hovert-label-row .hovert-label {
      margin-bottom: 0;
    }

    .hovert-speaker {
      width: 22px;
      height: 22px;
      flex: 0 0 22px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: none;
      border-radius: 7px;
      background: rgba(99, 102, 241, 0.1);
      color: #4f46e5;
      cursor: pointer;
    }

    .hovert-speaker:hover {
      background: rgba(99, 102, 241, 0.18);
      color: #4338ca;
    }

    .hovert-speaker:focus-visible {
      outline: 2px solid rgba(99, 102, 241, 0.45);
      outline-offset: 2px;
    }

    .hovert-speaker:active {
      transform: translateY(1px);
    }

    .hovert-speaker.is-speaking {
      background: #6366f1;
      color: #ffffff;
    }

    .hovert-speaker:disabled {
      opacity: 0.45;
      cursor: default;
    }

    .hovert-speaker svg {
      width: 15px;
      height: 15px;
      display: block;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .hovert-error {
      margin: 0;
      font-size: 13px;
      color: #b91c1c;
      line-height: 1.4;
    }

    .hovert-skeleton {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 2px 0;
    }

    .hovert-spinner {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid rgba(99, 102, 241, 0.25);
      border-top-color: #6366f1;
      animation: hovert-spin 0.7s linear infinite;
      flex-shrink: 0;
    }

    @keyframes hovert-spin {
      to { transform: rotate(360deg); }
    }

    .hovert-skeleton-text {
      font-size: 13px;
      color: rgba(26, 26, 46, 0.6);
    }

    .hovert-footer {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid rgba(0, 0, 0, 0.08);
    }

    .hovert-logo-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      display: inline-block;
    }

    .hovert-brand {
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: 0.03em;
      color: rgba(26, 26, 46, 0.5);
    }
  `;
})();
