import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Candle, CandleBinanceResponse } from '../../shared/types/candle.type';
import { PairFormatHelper } from '../../shared/helper/pair-format.helper';

@Injectable()
export class HistoricalDataService {
  private readonly logger = new Logger(HistoricalDataService.name);
  private readonly API_URL = 'https://fapi.binance.com/fapi/v1/continuousKlines';
  private readonly requestQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;
  private lastRequestTime = 0;
  private readonly RATE_LIMIT_DELAY = 500; // 500ms between requests

  constructor(private readonly httpService: HttpService) {}

  async getCandles(
    symbol: string,
    interval = '15m',
    limit = 100,
  ): Promise<Candle[]> {
    return new Promise((resolve) => {
      this.requestQueue.push(async () => {
        try {
          const symbolFormatted = await PairFormatHelper.formatPair(symbol,'BINANCE');
          
          const candles = await this.fetchCandlesWithRetry(
            symbolFormatted,
            interval,
            limit,
          );
          resolve(candles);
        } catch (error) {
          if (error.response?.status === 429) {
            this.logger.error(
              `Rate limit hit for ${symbol}`
            );
            resolve([]);
          }
          else {
            this.logger.error(
              `Error fetching candles for ${symbol}: ${error.message}`,
            );
            resolve([]);
          }
          
        }
      });

      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) return;

    this.isProcessingQueue = true;
    try {
      while (this.requestQueue.length > 0) {
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;
        if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.RATE_LIMIT_DELAY - timeSinceLastRequest),
          );
        }

        const request = this.requestQueue.shift();
        if (request) {
          this.lastRequestTime = Date.now();
          await request();
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async fetchCandlesWithRetry(
    symbol: string,
    interval: string,
    limit: number,
    retryCount = 0,
  ): Promise<Candle[]> {
    const maxRetries = 1;
    const retryDelay = 2000; // 2 seconds

    try {
      const endTime = Date.now();
      const startTime = endTime - limit * this.getIntervalMs(interval);

      // this.logger.debug(
      //   `Fetching candles for ${symbol} (attempt ${retryCount + 1}/${maxRetries + 1})`,
      // );
      const { data } = await firstValueFrom(
        this.httpService.get<CandleBinanceResponse[]>(
          `${this.API_URL}?pair=${symbol}&contractType=PERPETUAL&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`,
          {
            timeout: 10000, // 10 second timeout
          }
        )
      );
      return data.map((response) => this.mapResponseToCandle(response, symbol, interval));
    } catch (error) {
      if (retryCount < maxRetries) {
        // this.logger.warn(
        //   `Retrying candle fetch for ${symbol} (${retryCount + 1}/${maxRetries})`,
        // );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        return this.fetchCandlesWithRetry(
          symbol,
          interval,
          limit,
          retryCount + 1,
        );
      }
      throw error;
    }
  }

  private mapResponseToCandle(response: CandleBinanceResponse, symbol, interval): Candle {
    return {
      timestamp: response[0],
      open: parseFloat(response[1]),
      high: parseFloat(response[2]),
      low: parseFloat(response[3]),
      close: parseFloat(response[4]),
      volume: parseFloat(response[5]),
      symbol,
      interval,
    };
  }

  private getIntervalMs(interval: string): number {
    const unit = interval.slice(-1);
    const value = parseInt(interval.slice(0, -1));

    switch (unit) {
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 15 * 60 * 1000; // default to 15m
    }
  }
}
