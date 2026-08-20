// scripts/v2/ws_feed.mjs — Live Binance WebSocket Data Feed
import WebSocket from 'ws';

export class CryptoFeed {
  constructor(symbols, onTick) {
    this.symbols = symbols.map(s => s.toLowerCase().replace("-usd", "usdt"));
    this.onTick = onTick; // Callback when a price updates
    this.ws = null;
    this.prices = {};
  }

  connect() {
    const streams = this.symbols.map(s => `${s}@kline_1m`).join('/');
    const url = `wss://stream.binance.com:9443/ws/${streams}`;
    
    console.log(`Connecting to Binance WS: ${url}`);
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('✅ WebSocket Connected');
    });

    this.ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.e === 'kline') {
        const symbol = msg.s.replace('USDT', '-USD');
        const price = parseFloat(msg.k.c);
        const prevPrice = this.prices[symbol] || price;
        
        this.prices[symbol] = price;

        // Dispatch tick if price moved significantly (e.g., 0.01% to prevent noise)
        if (Math.abs(price - prevPrice) / prevPrice > 0.0001) {
          this.onTick(symbol, price);
        }
      }
    });

    this.ws.on('error', (err) => {
      console.error('❌ WebSocket Error:', err);
    });

    this.ws.on('close', () => {
      console.log('⚠️ WebSocket Closed. Reconnecting in 5s...');
      setTimeout(() => this.connect(), 5000);
    });
  }

  getPrices() {
    return { ...this.prices };
  }
}

// Quick Test Execution
if (process.argv.includes('--test')) {
  const feed = new CryptoFeed(["BTC-USD", "ETH-USD"], (sym, price) => {
    console.log(`[TICK] ${sym} @ $${price}`);
  });
  feed.connect();
}
