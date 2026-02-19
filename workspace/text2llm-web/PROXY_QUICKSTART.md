# text2llm Web Proxy Quickstart

## Preferred 24/7 host

Use **Fly.io** with `min_machines_running = 1`.

- It stays always on (no sleep) when billing allows at least one running machine.
- It already has a health endpoint (`/health`) and production config in `fly.proxy.toml`.

## 1) Start proxy

```bash
cp .env.proxy.example .env
# edit values as needed
npm run start:proxy
```

Proxy listens on `http://localhost:8790` by default.

## 1.1) Deploy 24/7 on Fly.io (preferred)

From `workspace/text2llm-web`:

```bash
fly launch --no-deploy --copy-config --config fly.proxy.toml
fly secrets set \
  SUPABASE_URL="https://YOUR_PROJECT_ID.supabase.co" \
  SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="YOUR_SUPABASE_SERVICE_ROLE_KEY" \
  PROXY_ALLOWED_ORIGIN="https://YOUR_UI_DOMAIN"
fly deploy --config fly.proxy.toml
```

Then verify:

```bash
curl https://YOUR_FLY_APP.fly.dev/health
```

## 1.2) Deploy on Render (alternative)

- Use blueprint file: `render.proxy.yaml`
- Set the same secrets (`SUPABASE_*`, `PROXY_ALLOWED_ORIGIN`)
- Keep `healthCheckPath: /health`

## 2) Run in local dev (no Supabase validation)

Set in `.env`:

```env
PROXY_SKIP_AUTH=true
```

For production, use:

```env
PROXY_SKIP_AUTH=false
```

## 3) Configure UI for web mode

Set UI env:

```env
VITE_TEXT2LLM_WEB_PROXY_URL=http://localhost:8790
```

For hosted proxy:

```env
VITE_TEXT2LLM_WEB_PROXY_URL=https://YOUR_FLY_APP.fly.dev
```

Then run the UI dev server as usual.

## 4) Provide runtime provider config in browser localStorage

In browser devtools console:

```js
localStorage.setItem("text2llm.web.proxy.provider", "openai");
localStorage.setItem("text2llm.web.proxy.key", "YOUR_PROVIDER_API_KEY");
localStorage.setItem("text2llm.web.proxy.model", "gpt-4.1-mini");
// optional when PROXY_SKIP_AUTH=false:
localStorage.setItem(
  "text2llm.web.supabase.access_token",
  "SUPABASE_ACCESS_TOKEN",
);
```

## 5) Verify

- `GET /health` returns `{ ok: true }`
- Chat tab can send while gateway is offline when `VITE_TEXT2LLM_WEB_PROXY_URL` is set
- Requests go to `/v1/proxy/chat/completions`

## 6) 24/7 conditions checklist

- `PROXY_SKIP_AUTH=false`
- `PROXY_ALLOWED_ORIGIN` set to your exact UI origin
- Fly: `min_machines_running=1` and `auto_stop_machines=false`
- Supabase RLS schema applied from `supabase/schema.sql`
- Health endpoint monitored (`/health`)
