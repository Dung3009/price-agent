export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol: string;
  interval: string;
}

export interface CandleHyperliquidResponse {
  t: number; // Start timestamp
  T: number; // End timestamp
  s: string; // Symbol
  i: string; // Interval
  o: string; // Open
  c: string; // Close
  h: string; // High
  l: string; // Low
  v: string; // Volume
  n: number; // Number of trades
}

export interface CandleBinanceResponse {
  openTime: number;           // Open time (timestamp)
  open: string;              // Open price
  high: string;              // High price
  low: string;               // Low price
  close: string;             // Close price (or latest price)
  volume: string;            // Volume
  closeTime: number;         // Close time (timestamp)
  quoteAssetVolume: string;  // Quote asset volume
  numberOfTrades: number;    // Number of trades
  takerBuyVolume: string;    // Taker buy volume
  takerBuyQuoteAssetVolume: string; // Taker buy quote asset volume
  ignored: string;           // Ignored field
}