# hovert

hovert is a lightweight Chrome/Chromium extension that lets you select any word or short phrase on a webpage and instantly see a quick definition and AI-generated summary in a floating tooltip.

It is designed for fast reading and language learning: highlight text, get a plain-English explanation, and optionally hear it spoken with the browser's built-in text-to-speech.

## Features

- Instant lookup on selected text
- Floating tooltip positioned near the selection
- AI-powered definition + summary using OpenAI, Gemini, Groq, or a custom OpenAI-compatible endpoint
- Browser-local API key storage
- Built-in text-to-speech for selected words
- Works across most websites with one-click configuration

## Project structure

```text
hovert/
├── assets/
├── icons/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── scripts/
│   ├── aiService.js
│   ├── background.js
│   └── content.js
└── ...
```

## How it works

- The content script watches for text selection on the active page.
- When text is selected, it sends the selection to the extension service worker.
- The service worker reads the configured API credentials and calls the selected AI provider.
- The result is displayed in a floating tooltip near the selected text.

## Installation

1. Open Google Chrome or another Chromium-based browser.
2. Go to `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the `hovert` folder in this repository.

## Setup

1. Click the hovert icon in the browser toolbar.
2. Choose a provider preset or use a custom endpoint.
3. Enter your API key, endpoint URL, and model name.
4. Save the settings.

Supported provider patterns include:

- OpenAI-compatible endpoints
- Google Gemini
- Groq
- Custom OpenAI-compatible API servers

## Usage

1. Open any webpage.
2. Highlight a word or short phrase.
3. A tooltip will appear with a definition and summary.
4. Use the speaker button to hear the selected text read aloud.

## Notes

- The extension stores your API configuration locally in the browser only.
- Selected text and lookup results are not persisted by the extension.
- You must provide your own valid API key and endpoint for the provider you use.

## License

This project is currently distributed without a formal license file. If you plan to reuse or distribute it, confirm the licensing terms before publishing or shipping it.
