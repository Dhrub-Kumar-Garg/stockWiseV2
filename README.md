# StockWise (FabInvests)

StockWise is an advanced, hybrid autonomous algorithmic trading engine. It merges a deterministic, high-frequency quantitative core with a Large Language Model (LLM) macro analyst to execute trades across cryptocurrency and traditional equity markets.

By synthesizing real-time technical analysis with AI-driven macro sentiment, StockWise aims to eliminate human emotional bias from trading. The system is designed to be fully autonomous — it ingests live market data, reads financial news, evaluates 13 distinct mathematical strategies, dynamically sizes positions using the Kelly criterion, and manages risk with trailing stop-losses and equity safeguards.

---

## Core Features

- **Multi-Market Support:** Trades major cryptocurrencies (BTC, ETH, SOL, XRP, DOGE) via live WebSockets, with REST fallback for US and Indian equities.
- **AI Macro Analyst:** Uses Groq's high-speed API (powered by Qwen 3.6 27B) to parse global news, funding rates, and Fear & Greed metrics, outputting a definitive market regime (TREND, REVERT, or SLEEP).
- **Statistical Arbitrage:** Implements real-time pairs trading (e.g., BTC/ETH, SOL/ETH) using rolling z-scores on logarithmic price spreads to capture mean-reversion in highly correlated assets.
- **Machine Learning Ledger:** Strategies are continuously graded based on their performance (win rate, expected value). Position sizes dynamically scale up for winning strategies and shrink for losing ones.
- **Dynamic Risk Management:** Utilizes the Kelly Criterion for optimal bet sizing, combined with volatility-inverse scaling (ATR-based margin allocation) and strict account drawdown limits.
- **Integrated Backtester:** Includes a historical backtesting engine (`backtest.mjs`) to simulate years of data, test strategy viability, and train the ML ledger before deploying live.

---

## System Architecture

The project is built on a 6-layer event-driven architecture designed for high availability and low latency:

### 1. Data Ingestion (Input Layer)
- **Binance WebSockets:** Streams real-time 1-minute klines for core cryptocurrencies. Ensures sub-second reaction times to market volatility.
- **Financial News:** Automatically scrapes trending global financial headlines, Fed press releases, and FOMC minutes via RSS/REST.
- **Macro Metrics:** Polls perpetual futures funding rates, open interest, VIX, and the Crypto Fear & Greed Index to gauge retail crowd positioning.

### 2. Enrichment Module
- Calculates real-time technical indicators: Simple Moving Averages (SMA), Relative Strength Index (RSI), Average True Range (ATR), Bollinger Bands, and Donchian Channels.
- Quantitatively classifies the market into one of four regimes: `bull_quiet`, `bull_volatile`, `bear_volatile`, or `mixed_chop`.

### 3. AI Macro Analyst (LLM Layer)
- **Execution:** Runs every 15 minutes as a background job.
- **Prompting:** A prompt containing recent news headlines, funding rates, open interest, and the bot's recent PnL is sent to the Groq API.
- **Output:** The LLM is forced to output a strictly formatted JSON decision:
  - `mode`: **TREND** (activates momentum/breakout strategies), **REVERT** (activates stat-arb/mean-reversion), or **SLEEP** (halts trading during extreme black-swan events).
  - `direction_bias`: LONG, SHORT, or NEUTRAL.
  - `aggression`: A multiplier (0.1 to 1.0) applied to the base leverage.

### 4. Quantitative Execution Engine
- Runs on a strict 30-second deterministic loop (`engine.mjs`).
- Evaluates 13 distinct strategies simultaneously. Key strategies include:
  - **Time-Series Momentum:** Trades in the direction of the 200-SMA when momentum is confirmed.
  - **RSI-2 Dip (Connors):** Buys extreme short-term oversold dips in long-term uptrends.
  - **Stat-Arb (Pairs Trading):** Trades the mean reversion of the spread between correlated crypto assets using dynamic z-score thresholds.
- **Confluence Filter:** Requires multiple uncorrelated strategies to agree on a trade, or a single high-confidence signal bolstered by aligned news sentiment.

### 5. Risk Management & Sizing
- **Kelly Criterion:** `Kelly % = Win Rate - (1 - Win Rate) / (Avg Win / Avg Loss)`. Ensures the bot never risks more than mathematically optimal.
- **Volatility Scaling:** Wider stop-losses and smaller position sizes during high-volatility environments (high ATR).
- **Trailing Stops:** Implements dynamic trailing take-profits that activate only after a position achieves a minimum ROI, allowing winners to run while protecting capital.

### 6. Live Dashboard
- Built with **Next.js**, React, and TailwindCSS.
- Visualizes the live equity curve, current active positions, historical trades, and the strategy ML ledger in a clean, professional UI.

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- A Linux/Ubuntu environment (recommended for live deployment)
- A [Groq API Key](https://console.groq.com/) (Free tier works perfectly)

### 1. Configuration & Setup
Clone the repository and set up your configuration file:
```bash
# Clone the repository
git clone https://github.com/Dhrub-Kumar-Garg/stockWiseV2.git
cd stockWiseV2

# Set up configuration
cp config.example.json config.json
```
Open `config.json` and insert your Groq API Key:
```json
"analyst": {
  "enabled": true,
  "groqApiKey": "gsk_YOUR_API_KEY_HERE",
  "model": "qwen/qwen3.6-27b",
  "intervalMinutes": 15
}
```

### 2. Running the Backtester (Optional)
Before running live with real capital, you can test the strategies over historical data. This will populate your `strategies.json` ML ledger with accurate win rates.
```bash
cd scripts/v2
node fetch_hist.mjs
node backtest.mjs
```

### 3. Running the Engine Live
The backend engine runs continuously, streaming WebSockets and evaluating strategies every 30 seconds.
```bash
cd scripts/v2
node engine.mjs
```

### 4. Running the Dashboard (Frontend)
To view the UI, open a new terminal window and start the Next.js server:
```bash
cd web
npm install
npm run dev
```
Navigate to `http://localhost:3000` to monitor your bot.

---

## Production Deployment (Oracle Cloud / Ubuntu)

For 24/7 autonomous trading, the engine should be deployed to a cloud VPS (e.g., AWS, DigitalOcean, Oracle Cloud) and run via systemd.

1. **Create a systemd service file:**
```bash
sudo nano /etc/systemd/system/stockwise-engine.service
```
2. **Add the following configuration:**
```ini
[Unit]
Description=StockWise V2 Engine
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/stockWiseV2/scripts/v2
ExecStart=/usr/bin/node engine.mjs
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```
3. **Enable and start the service:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable stockwise-engine
sudo systemctl start stockwise-engine
```
4. **Monitor logs:**
```bash
sudo journalctl -u stockwise-engine -f
```

---

## Project Structure

- `/scripts/v2/` — The core trading engine.
  - `engine.mjs` — The main execution loop, data aggregator, and risk manager.
  - `strategies.mjs` — The mathematical logic for all 13 trading strategies and stat-arb.
  - `analyst.mjs` — The LLM integration, prompt generation, and JSON parsing logic.
  - `ws_feed.mjs` — The Binance WebSocket client for real-time crypto prices.
  - `backtest.mjs` — The historical backtesting module.
  - `fetch_hist.mjs` — Utility to pull historical klines from Binance REST API.
- `/web/` — The Next.js frontend dashboard.
- `/data/` — Local storage (JSON/JSONL) for trade history, state, and ML ledgers.
- `config.json` — Global configuration parameters (capital, leverage, risk, API keys).

---

## Disclaimer

**Educational Purposes Only.** This software is provided "as is", without warranty of any kind. Do not use this engine to trade real capital without a comprehensive understanding of quantitative finance, risk management, and the code's execution paths. Algorithmic trading in cryptocurrency and equity markets is inherently highly volatile and can result in total loss of funds. The developers accept no liability for any financial losses incurred while using this software.
