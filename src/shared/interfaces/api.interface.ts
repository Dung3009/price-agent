export interface BinanceApiConfig {
  method: string;
  url: string;
  headers: {
    'X-MBX-APIKEY': string;
  };
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  statusText: string;
}