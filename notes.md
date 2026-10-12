use hugging face to run docker container

groq api



## Deployment Plan

### What deploys normally
- **Frontend** → Vercel (free, standard Vite/React build)
- **Supabase** → already cloud-hosted
- **Groq API** → already hosted

### What needs a VPS (Nmap + ZAP require root/Docker)
- Nmap needs raw sockets and a host binary — serverless platforms don't allow it
- OWASP ZAP runs as a persistent Docker container — needs a long-running process

### Recommended setup
```
Frontend     → Vercel (free)
Backend      → VPS e.g. DigitalOcean $6/mo Droplet (Ubuntu 22.04)
ZAP + Nmap   → same VPS
Supabase     → already hosted
Groq         → already hosted
```

### VPS setup steps
```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Nmap
sudo apt install -y nmap

# Docker (for ZAP)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### Run ZAP on VPS (bind to localhost only)
```bash
docker run -d \
  --name owasp-zap \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  zaproxy/zap-stable zap.sh \
  -daemon -host 0.0.0.0 -port 8080 \
  -config api.disablekey=true \
  -config api.addrs.addr.name=.* \
  -config api.addrs.addr.regex=true
```

### Run backend with PM2
```bash
cd backend
npm install
pm2 start src/server.js --name cyberp-backend
pm2 save && pm2 startup
```

### Nginx reverse proxy + HTTPS (Let's Encrypt, free)
```nginx
server {
    server_name api.yourdomain.com;
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo certbot --nginx -d api.yourdomain.com
```

### Vercel frontend env vars
```env
VITE_API_BASE_URL=https://api.yourdomain.com
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Lock down CORS after deploy
```js
app.use(cors({
  origin: 'https://your-app.vercel.app',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
```

### Cost estimate
| Service | Cost |
|---|---|
| Vercel (frontend) | Free |
| Supabase | Free tier |
| Groq API | Free tier (6,000 req/day) |
| DigitalOcean Droplet 1vCPU/1GB | ~$6/month |
| SSL (Let's Encrypt) | Free |

### If deploying without Nmap/ZAP (serverless backend)
Railway or Render will work — headers, SSL, and WHOIS still function.
Nmap returns `nmapStatus: 'unavailable'` and ZAP buttons show an error.
The UI handles both gracefully.
