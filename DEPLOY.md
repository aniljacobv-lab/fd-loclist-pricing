# Deploying the FD Pricing Workbench

This deploys the app as a single always-on web service. The API and the React
UI are bundled into one process — there's one URL, no separate front-end host.

## One-time setup

### 1. Create a GitHub repo
Go to https://github.com/new and create an empty repo (no README, no
.gitignore). Call it whatever you like, e.g. `fd-loclist-pricing`.

### 2. Push this folder to it
Open a Command Prompt in `C:\Users\anilj\fd-loclist-pricing` and run:

    setup-git.bat https://github.com/<your-username>/fd-loclist-pricing.git

(Replace the URL with the real one from step 1.)

You'll need GitHub credentials the first time. The easiest way on Windows is
GitHub's Git Credential Manager (installed with Git for Windows by default) —
it will pop a browser window to sign you in.

### 3. Connect Render
Go to https://dashboard.render.com/select-repo, pick the repo you just pushed.
Render reads `render.yaml` and offers to create the Web Service automatically.
Click "Apply" and grab a coffee — first build takes ~5 minutes.

When it's done, Render gives you a public URL like
`https://fd-pricing-workbench.onrender.com`. That's the live app.

### 4. (Optional) Set the Anthropic key
In the Render dashboard, go to your service → Environment, and add
`ANTHROPIC_API_KEY` with your key. Save — Render auto-restarts. The "AI" pill
in the sidebar should flip to "live".

## Updating the deployed app

Every time you want to redeploy:

    push.bat "what you changed"

That stages everything, commits with your message, and pushes. Render sees the
push and rebuilds in ~2-3 minutes.

If you forget the message, `push.bat` (with no args) uses a timestamp.

## Notes

* **Free tier sleeps.** Render's free plan spins the service down after ~15
  minutes of inactivity. The first request after a nap takes ~30-50 seconds
  while it cold-starts. Upgrade to "Starter" ($7/month) to keep it warm.
* **In-memory data resets on every redeploy.** Anything you create through the
  UI (price changes, location lists, markdown chains) lives only until the
  next restart. The seed catalog (~18k items, 8.8k stores) re-loads every
  time. For real persistence, point `DATASTORE=oracle` and supply the
  `ORACLE_*` env vars in the Render dashboard.
* **Competitor scraping** runs from Render's IPs, which retailers don't
  recognize. Coverage will be limited (often only Dollar Tree gets through).
  That's a property of the real internet, not the app.
* **Logs** are visible in the Render dashboard. The "Logs" tab streams stdout
  from the API.
* **Local dev still works** exactly as before: `npm run dev` in `api/` and
  `web/`. The Vite proxy now keeps `/api` in the path (matches production).

## Alternative: Docker

If you'd rather host this somewhere that runs containers (Fly.io, AWS App
Runner, your own VM, etc.), the included `Dockerfile` is a multi-stage build:

    docker build -t fd-pricing .
    docker run -p 3001:3001 fd-pricing

Then browse to http://localhost:3001.
