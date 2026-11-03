/**
 * aiService.js
 * ---------------------------------------------------------------------------
 * hovert — AI request layer.
 *
 * This module builds and sends the actual request to whatever AI endpoint
 * the user has configured (OpenAI, Gemini, Groq, or any custom
 * OpenAI-compatible endpoint) and normalizes the response into plain text.
 *
 * This is the ONLY file you should need to touch to support a new provider
 * or change prompt behavior. Every provider-specific section is clearly
 * marked below with `>>> CUSTOMIZE HERE <<<`.
 *
 * This module is imported by scripts/background.js (a module-type service
 * worker), so it uses ES module export syntax.
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------
// This system prompt controls the tone/shape of every lookup. Tune freely.
const SYSTEM_PROMPT = `You are "hovert", an inline dictionary and summarizer embedded in a webpage tooltip.
The user has selected a word or short phrase on a page. Respond with:
1. A single short line labeled "Definition:" — the clearest, most common meaning (include part of speech in parentheses if it's a single word).
2. A single short line labeled "Summary:" — a one-sentence plain-English gloss of what the term means or is used for, written for a curious reader.
Keep the entire response under 60 words total. Do not add extra commentary, greetings, or markdown formatting. If the selection is a full sentence or phrase rather than a single term, treat "Definition" as a concise paraphrase and "Summary" as brief added context.`;

function buildUserPrompt(selectedText, pageContext) {
  const context = pageContext ? `\n\n(Context — page title: "${pageContext}")` : "";
  return `Selected text: "${selectedText}"${context}`;
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------
// We auto-detect the provider shape from the endpoint URL so the same
// "Custom endpoint" field in the popup can work for several providers
// without asking the user to pick a dropdown for request format.
function detectProvider(endpoint) {
  if (!endpoint) return "openai";
  const url = endpoint.toLowerCase();
  if (url.includes("generativelanguage.googleapis.com")) return "gemini";
  // Groq, OpenAI, OpenRouter, Together, local (Ollama/LM Studio), and most
  // "custom" endpoints all speak the OpenAI /chat/completions dialect.
  return "openai";
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
/**
 * @param {string} selectedText - The text the user selected on the page.
 * @param {object} config - { apiKey, endpoint, model }
 * @param {string} [pageContext] - Optional page title for extra context.
 * @returns {Promise<string>} - Plain text result to render in the tooltip.
 */
export async function getDefinition(selectedText, config, pageContext) {
  const { apiKey, endpoint, model } = config || {};

  if (!selectedText || !apiKey || !endpoint || !model) {
    throw new Error("Missing configuration. Open the hovert popup and set your API key, endpoint, and model.");
  }

  const provider = detectProvider(endpoint);

  if (provider === "gemini") {
    return await callGemini(selectedText, pageContext, config);
  }

  return await callOpenAICompatible(selectedText, pageContext, config);
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider (OpenAI, Groq, OpenRouter, local servers, etc.)
// ---------------------------------------------------------------------------
async function callOpenAICompatible(selectedText, pageContext, config) {
  const { apiKey, endpoint, model } = config;

  // >>> CUSTOMIZE HERE: headers <<<
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };

  // >>> CUSTOMIZE HERE: request body payload <<<
  const body = {
    model: model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(selectedText, pageContext) },
    ],
    temperature: 0.3,
    max_tokens: 150,
  };

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await safeReadError(response);
    throw new Error(`API error (${response.status}): ${errText}`);
  }

  const data = await response.json();

  // >>> CUSTOMIZE HERE: response parsing <<<
  const text =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    null;

  if (!text) {
    throw new Error("Unexpected response shape from API.");
  }

  return text.trim();
}

// ---------------------------------------------------------------------------
// Google Gemini provider
// ---------------------------------------------------------------------------
async function callGemini(selectedText, pageContext, config) {
  const { apiKey, endpoint, model } = config;

  // Gemini expects the API key as a query param and the model in the URL
  // path. If the user pasted a base endpoint without the model, we build
  // the full URL for them.
  // >>> CUSTOMIZE HERE: URL construction <<<
  let url = endpoint;
  if (!url.includes(":generateContent")) {
    const base = url.replace(/\/$/, "");
    url = `${base}/models/${model}:generateContent`;
  }
  const separator = url.includes("?") ? "&" : "?";
  url = `${url}${separator}key=${apiKey}`;

  // >>> CUSTOMIZE HERE: headers <<<
  const headers = {
    "Content-Type": "application/json",
  };

  // >>> CUSTOMIZE HERE: request body payload <<<
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${SYSTEM_PROMPT}\n\n${buildUserPrompt(selectedText, pageContext)}` }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 150,
    },
  };

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await safeReadError(response);
    throw new Error(`API error (${response.status}): ${errText}`);
  }

  const data = await response.json();

  // >>> CUSTOMIZE HERE: response parsing <<<
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

  if (!text) {
    throw new Error("Unexpected response shape from Gemini API.");
  }

  return text.trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function safeReadError(response) {
  try {
    const data = await response.json();
    return data?.error?.message || JSON.stringify(data).slice(0, 200);
  } catch {
    return response.statusText || "Unknown error";
  }
}

async function fetchWithTimeout(url, options, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("The AI request timed out. Check the endpoint and try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
