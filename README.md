# Trendify website

Static HTML website for Trendify. The main `tiff.co.ke` site is served by Vercel from the repository's `main` branch; GitHub Pages is also configured for this repository.

## Local preview

Open `index.html` in a browser, or run a local server from the repository root:

```sh
python3 -m http.server 8000
```

The site uses standalone HTML pages, shared styles in `assets/style.css`, and shared navigation and footer markup in `assets/site.js`.


## Tiff Chat architecture

The homepage provides a question launcher. It carries the first prompt to the legacy full conversation page at `/page/` using tab-scoped session storage, without putting the prompt in the URL. The same chat is also hosted at `https://ai.tiff.co.ke/` as a dedicated static Cloudflare Pages project, `tiff-ai-chat`. Both frontends call the same Cloudflare Worker. The service key must exist only as the Worker secret `GEMINI_API_KEY`; never place it in HTML, JavaScript, a public GitHub secret, or another file shipped to visitors.

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

4. Publish changes to the main website through the repository's normal `main` deployment. To update the separate chat-only Pages project, build to a new empty output directory and deploy it with an account token scoped for Pages:

   ```sh
   node scripts/build-chat-pages.mjs /tmp/tiff-chat-pages-output
   npx wrangler pages deploy /tmp/tiff-chat-pages-output --project-name=tiff-ai-chat --branch=main
   ```

   The build includes only the chat page and its required assets. The public endpoint URL and Turnstile sitekey are safe to commit; secret keys are not.
5. The Worker includes Cloudflare's native approximate rate limiter at 12 requests per 60 seconds per client IP. Its counters are local to each Cloudflare location and can briefly allow excess requests, so also set an appropriate Gemini project quota and monitor usage. CORS alone is not protection against automated direct requests. Restrict the Gemini key to the Gemini API where available and follow Google's current key-security guidance.

## Chat protection

The chat uses a managed Cloudflare Turnstile challenge for visitors (no account or sign-in), server-side token verification, and a SQLite-backed Durable Object that allows at most 250 accepted chat attempts globally per UTC day. This is a request-count ceiling, not an exact currency spend cap; each accepted attempt consumes one slot even if the provider later fails. The existing per-IP limiter remains in place. The Worker fails closed if challenge verification or the global counter is unavailable.

The Turnstile widget is permitted on `tiff.co.ke`, `www.tiff.co.ke`, `ai.tiff.co.ke` and the existing Cloudflare preview host. Its public sitekey is `TIFF_TURNSTILE_SITE_KEY` in `assets/chat-config.js`; the matching secret is the Worker binding `TURNSTILE_SECRET_KEY`. The `TIFF_CHAT_USAGE` binding, SQLite-backed migration, daily limit and allowed origins are configured in `wrangler.toml`. Preserve the existing secrets and other bindings on redeploy.

For local Worker development, create an ignored `.dev.vars` file containing `GEMINI_API_KEY=...`, then run `npx wrangler dev`. Never commit `.dev.vars`; `.gitignore` excludes it and other local secret files.
