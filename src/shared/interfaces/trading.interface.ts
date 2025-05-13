export interface TradeResult {
  mainOrder: OrderResponse;
  takeProfitOrder?: OrderResponse;
  stopLossOrder?: OrderResponse;
}

export interface OrderResponse {
  orderId: number;
  symbol: string;
  status: string;
  price: string;
  origQty: string;
  side: 'BUY' | 'SELL';
  type: OrderType;
  timeInForce?: TimeInForce;
}

export interface OrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: OrderType;
  quantity: string;
  price?: string;
  stopPrice?: string;
  timeInForce?: TimeInForce;
}

export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_MARKET';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';

export interface BinanceConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  fixedNotional: number;
  leverage: number;
}