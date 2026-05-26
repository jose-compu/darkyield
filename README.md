```
.----------------------------------------------------------------------.
|    '||                  '||                ||          '||       '|| |
|  .. ||   ....   ... ..   ||  ..  .... ... ...    ....   ||     .. || |
|.'  '||  '' .||   ||' ''  || .'    '|.  |   ||  .|...||  ||   .'  '|| |
||.   ||  .|' ||   ||      ||'|.     '|.|    ||  ||       ||   |.   || |
|'|..'||. '|..'|' .||.    .||. ||.    '|    .||.  '|...' .||.  '|..'||.|
|                                  .. |                                |
|                                   ''                                 |
'----------------------------------------------------------------------'
```

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/Express-API-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![DefiLlama](https://img.shields.io/badge/yields-DefiLlama-0E76FD)](https://defillama.com/yields)
[![Paper Trading](https://img.shields.io/badge/mode-Paper%20Trading-22C55E)](https://github.com/jose-compu/darkyield)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![GitHub](https://img.shields.io/github/stars/jose-compu/darkyield?style=social)](https://github.com/jose-compu/darkyield)

# DarkYield

DarkYield is an automated yield farming optimization platform with a local web UI. It fetches yield data from DefiLlama, optimizes portfolio allocations using mathematical models, and executes automated rebalancing strategies.

## Features

- **Yield Pool Discovery**: Browse and filter pools by stablecoins, bluechips, long-tail, and more
- **Paper Trading**: Test strategies with simulated funds before live trading
- **Portfolio Optimization**: Mathematical optimization for risk-adjusted returns
- **Automated Rebalancing**: Schedule-based or triggered rebalancing
- **Risk Management**: Real-time risk monitoring with customizable triggers
- **Performance Analytics**: Track returns, APY, volatility, and Sortino ratio
- **Telegram Notifications**: Real-time alerts for rebalances, risks, and performance
- **Dark/Light UI**: DefiLlama-inspired interface with theme switching

## Architecture

```
darkyield/
├── backend/           # Node.js/Express API
│   ├── src/
│   │   ├── services/  # Core business logic
│   │   ├── routes/    # API endpoints
│   │   ├── config/    # Configuration
│   │   └── utils/     # Utilities
│   └── package.json
├── frontend/          # React + Vite + Tailwind
│   ├── src/
│   │   ├── pages/     # Page components
│   │   ├── components/# Reusable components
│   │   └── hooks/     # React hooks
│   └── package.json
├── shared/            # Shared TypeScript types
└── package.json       # Workspace root
```

## Quick Start

### Prerequisites

- Node.js >= 18
- npm or yarn

### Installation

1. Clone and install dependencies:
```bash
cd darkyield
npm install
```

2. Copy environment file:
```bash
cp .env.example .env
# Edit .env with your settings
```

3. Start development servers:
```bash
npm run dev
```

The app will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:4000

### Production

1. Create production env from the template and set `NODE_ENV=production`:

```bash
cp .env.example .env
# Edit .env: NODE_ENV=production, LOG_LEVEL=info, optional API keys, Telegram, etc.
```

2. Build and start the backend:

```bash
npm run build
NODE_ENV=production npm start
```

3. Serve the UI from `frontend/dist/` on the **same origin** as the API (reverse proxy). The frontend uses relative `/api` and `/ws` URLs — it does not embed `localhost:4000` in production builds.

Example with nginx:

```nginx
location / {
  root /path/to/darkyield/frontend/dist;
  try_files $uri /index.html;
}
location /api {
  proxy_pass http://127.0.0.1:4000;
}
location /ws {
  proxy_pass http://127.0.0.1:4000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

| Setting | Development | Production |
|---------|-------------|------------|
| `NODE_ENV` | `development` | `production` |
| Start command | `npm run dev` | `npm run build && npm start` |
| UI | Vite dev server `:3000` | Static files from `frontend/dist/` |
| API | Backend `:4000`, proxied by Vite | Backend `:4000`, proxied by nginx/Caddy |
| Logs | Colored console | Console + `backend/logs/*.log` |
| API errors | Message + stack trace | Generic message only |

See `.env.example` for the full variable list and production checklist.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | `development` (local dev) or `production` (deployed server) | `development` |
| `LOG_LEVEL` | Winston log level (`debug`, `info`, `warn`, `error`) | `info` |
| `PAPER_TRADING` | Enable paper trading mode | `true` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | - |
| `TELEGRAM_CHAT_ID` | Telegram chat ID | - |
| `DEFAULT_REBALANCE_FREQUENCY` | Default rebalance schedule | `DAILY` |
| `MIN_REBALANCE_INTERVAL` | Minimum minutes between rebalances | `60` |

### Yield Modes

- **Stablecoins**: USDC, USDT, DAI, etc. - Conservative, low-risk yields
- **Bluechips**: ETH, WBTC on major protocols - Balanced risk-reward
- **Long Tail**: Emerging protocols - Higher risk, higher potential returns
- **Memecoins**: High-risk speculative strategies

## API Endpoints

### Pools
- `GET /api/pools` - List all pools with filtering
- `GET /api/pools/stablecoins` - Stablecoin pools only
- `GET /api/pools/bluechips` - Bluechip pools only
- `GET /api/pools/:id` - Pool details with chart data

### Portfolios
- `GET /api/portfolios` - List portfolios
- `POST /api/portfolios` - Create new portfolio
- `GET /api/portfolios/:id` - Portfolio details
- `POST /api/portfolios/:id/rebalance` - Trigger rebalance
- `GET /api/portfolios/:id/risk` - Risk assessment
- `POST /api/portfolios/:id/optimize` - Run optimization

### System
- `GET /api/system/status` - System status
- `POST /api/system/scheduler/start` - Start scheduler
- `POST /api/system/scheduler/stop` - Stop scheduler

## Development

### Tech Stack

**Backend:**
- Node.js + Express
- TypeScript
- DefiLlama API
- WebSocket for real-time updates
- node-cron for scheduling

**Frontend:**
- React 18
- TypeScript
- Vite
- Tailwind CSS
- TanStack Query
- Recharts
- Zustand

### Scripts

```bash
npm run dev          # Start all dev servers
npm run dev:backend  # Backend only
npm run dev:frontend # Frontend only
npm run build        # Build all packages
npm start            # Start production server
```

## Risk Management

Default risk triggers:
- **TVL Drop**: Exit if TVL drops 30% in 7 days
- **APY Drop**: Exit if APY drops 50% from entry
- **Max Drawdown**: Reduce position by 50% at 15% drawdown
- **Volatility Spike**: Alert if volatility exceeds 3x normal

## Security Notes

- Paper trading is enabled by default
- Live trading requires wallet configuration
- Private keys should be encrypted
- Use secure RPC endpoints for mainnet

## License

MIT
