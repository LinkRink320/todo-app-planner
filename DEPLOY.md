Deploy guide (Railway / Render)

Railway (recommended)

1. Create new project from GitHub repo
2. Service type: Node.js
3. Env vars:
   - PORT=3000
   - API_KEY=your_api_key
   - DATABASE_PATH=/data/data.db (and add a Persistent Volume mounted at /data)
   - LINE_CHANNEL_SECRET=...
   - LINE_CHANNEL_ACCESS_TOKEN=...
   - DEFAULT_LINE_USER_ID (optional)
   - DEFAULT_LINE_USER_NAME (optional)
4. Postinstall builds frontend automatically (package.json postinstall)
5. Health check: /healthz
6. Set domain; set LINE webhook to https://<domain>/line/webhook

Render (alt)

1. Web Service → Build Command: npm install
2. Start Command: npm start
3. Same env vars as above
4. Static files served from frontend/dist in production

Local build

- npm install
- npm run web:build
- npm start
