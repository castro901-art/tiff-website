# Trendify website

Static HTML website for Trendify, published from this repository with GitHub Pages.

## Local preview

Open `index.html` in a browser, or run a local server from the repository root:

```sh
python3 -m http.server 8000
```

The site uses standalone HTML pages, shared styles in `assets/style.css`, and shared navigation and footer markup in `assets/site.js`.


## Tiff Chat architecture

The homepage provides a question launcher. It carries the first prompt to the full conversation page at `/page` using tab-scoped session storage, without putting the prompt in the URL. The full chat UI is served by GitHub Pages and sends requests to a separate Cloudflare Worker, which forwards them to its configured AI service. The service key must exist only as the Worker secret `GEMINI_API_KEY`; never place it in HTML, JavaScript, a public GitHub secret, or another file shipped to visitors.

The current Worker model is the stable Gemini 3.6 Flash (`gemini-3.6-flash`); set `GEMINI_MODEL` in the Worker configuration to choose another supported Gemini model. The Worker makes one bounded retry for transient provider errors, with a 15-second timeout per attempt.

The frontend endpoint is a public URL, not a secret. Set `window.TIFF_CHAT_API_URL` in `assets/chat-config.js` to the deployed Worker URL ending in `/chat`.
The deployed public endpoint is configured in that file; it contains no API key. Update the URL only if the Worker hostname changes.

The browser keeps conversation history in memory only; refreshing or closing the page clears it. The Worker does not persist chat history. The visitor-facing notice says that Tiff processes messages, with help from service providers, to generate replies, and advises against sending sensitive information.

## Deploying the chat backend

1. Install Node.js and Wrangler, then authenticate Wrangler with a Cloudflare account that can deploy a Worker.
2. From the repository root, set the Gemini key directly as a Worker secret. Wrangler prompts for the value; do not put it in a source file or command history:

   ```sh
   npx wrangler secret put GEMINI_API_KEY
   ```

3. Deploy the Worker:

   ```sh
   npx wrangler deploy
   ```

   Wrangler prints a public `workers.dev` URL. Add `/chat` to that URL in `assets/chat-config.js`, for example:

   ```js
   window.TIFF_CHAT_API_URL = 'https://tiff-chat-api.<account-subdomain>.workers.dev/chat';
   ```

4. Publish the static-site changes through the repository's normal GitHub Pages workflow. The public endpoint URL is safe to commit; the API key is not.
5. The Worker includes Cloudflare's native approximate rate limiter at 12 requests per 60 seconds per client IP. Its counters are local to each Cloudflare location and can briefly allow excess requests, so also set an appropriate Gemini project quota and monitor usage. CORS alone is not protection against automated direct requests. Restrict the Gemini key to the Gemini API where available and follow Google's current key-security guidance.

For local Worker development, create an ignored `.dev.vars` file containing `GEMINI_API_KEY=...`, then run `npx wrangler dev`. Never commit `.dev.vars`; `.gitignore` excludes it and other local secret files.
