import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import * as crypto from 'crypto';
import { TradeService } from '../services/trading-binance.service';


/**
 * Interface for news item with impact classification.
 */
interface NewsItem {
  id: string;
  title: string;
  timestamp: number; // Unix timestamp in ms
  impact: 'HIGH' | 'MEDIUM' | 'LOW' | 'HOLIDAY';
}

/**
 * Interface for risk check result.
 */
interface RiskCheckResult {
  canTrade: boolean;
  reason?: string;
}

@Injectable()
export class RiskManagementService {
  private readonly logger = new Logger(RiskManagementService.name);
  private initialMargin: number | null = null;
  private marginFetchTime: number | null = null;
  private readonly BASE_URL = 'https://testnet.binancefuture.com';
  private readonly MAX_LOSS_PERCENTAGE = 0.1; // 10%
  private readonly NEWS_WINDOW_MINUTES = 30; // 30 minutes before/after high-impact news
  private readonly NEWS_API_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  private readonly NEWS_CACHE_DURATION = 60 * 60 * 1000; // 1 hour
  private cachedNews: NewsItem[] = [];
  private lastNewsFetch: number | null = null;

  constructor(
    private configService: ConfigService,
    private tradeService: TradeService,
  ) {
    this.logger.debug(`Crypto module: ${typeof crypto}, createHmac: ${typeof crypto?.createHmac}`);
    this.fetchInitialMargin().catch((error) =>
      this.logger.error(`Initial margin fetch failed: ${error.message}`),
    );
  }

  /**
   * Creates an HMAC-SHA256 signature for Binance API requests.
   * @param queryString The query string to sign.
   * @param apiSecret The API secret key.
   * @returns The HMAC-SHA256 signature.
   * @throws Error if crypto module or API secret is not available.
   */
  private static createSignature(queryString: string, apiSecret: string): string {
    if (!crypto || typeof crypto.createHmac !== 'function') {
      throw new Error('Crypto module is not available or misconfigured.');
    }
    if (!apiSecret) {
      throw new Error('API secret is not set');
    }
    return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
  }

  /**
   * Makes an API call to Binance with authentication.
   * @param method HTTP method (GET, POST, etc.).
   * @param endpoint API endpoint.
   * @param params Request parameters.
   * @returns API response data.
   * @throws Error if the API call fails.
   */
  private async callBinanceApi(method: string, endpoint: string, params: any = {}): Promise<any> {
    const apiKey = this.configService.get<string>('BINANCE_TESTNET_APIKEY');
    const apiSecret = this.configService.get<string>('BINANCE_TESTNET_APISECRET');
    if (!apiKey || !apiSecret) {
      this.logger.error('API key or secret is not configured');
      throw new Error('API key or secret is not configured');
    }

    const timestamp = Date.now();
    const queryString = new URLSearchParams({ ...params, timestamp }).toString();
    const signature = RiskManagementService.createSignature(queryString, apiSecret);
    const url = `${this.BASE_URL}${endpoint}?${queryString}&signature=${signature}`;
    const config = {
      method,
      url,
      headers: { 'X-MBX-APIKEY': apiKey },
    };
    try {
      const response = await axios(config);
      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data?.msg || error.message;
      this.logger.error(`Failed to call API ${endpoint}: ${errorMsg}`);
      throw new Error(`Lỗi API: ${errorMsg}`);
    }
  }

  /**
   * Fetches total margin balance at the start of the day.
   * Runs daily at 00:00 UTC.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async fetchInitialMargin(): Promise<void> {
    try {
      const account = await this.callBinanceApi('GET', '/fapi/v2/account');
      this.initialMargin = parseFloat(account.totalMarginBalance);
      this.marginFetchTime = Date.now();
      this.logger.log(`Fetched initial margin: ${this.initialMargin} USDT at ${new Date(this.marginFetchTime).toISOString()}`);
    } catch (error: any) {
      this.logger.error(`Failed to fetch initial margin: ${error.message}`);
      throw error;
    }
  }

  /**
   * Calculates total realized PnL since margin fetch time.
   * @param symbol Trading pair (e.g., BTCUSDT).
   * @returns Total realized PnL.
   * @throws Error if fetching trades fails.
   */
  private async calculatePnL(symbol: string): Promise<number> {
    if (!this.marginFetchTime) {
      this.logger.error('Margin fetch time not set. Run fetchInitialMargin first.');
      throw new Error('Margin fetch time not set');
    }
    try {
      const trades = await this.callBinanceApi('GET', '/fapi/v1/userTrades', {
        symbol,
        startTime: this.marginFetchTime,
      });
      const totalPnL = trades.reduce((sum: number, trade: any) => sum + parseFloat(trade.realizedPnl), 0);
      this.logger.debug(`Total realized PnL for ${symbol} since ${new Date(this.marginFetchTime).toISOString()}: ${totalPnL}`);
      return totalPnL;
    } catch (error: any) {
      this.logger.error(`Failed to calculate PnL for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Checks if trading is allowed based on PnL loss limit.
   * @param symbol Trading pair (e.g., BTCUSDT).
   * @returns Risk check result.
   */
  private async checkPnL(symbol: string): Promise<RiskCheckResult> {
    if (!this.initialMargin) {
      return { canTrade: false, reason: 'Initial margin not fetched' };
    }
    try {
      const totalPnL = await this.calculatePnL(symbol);
      const maxLoss = this.initialMargin * this.MAX_LOSS_PERCENTAGE;
      if (totalPnL < -maxLoss) {
        this.logger.warn(`Trading blocked: Loss (${totalPnL}) exceeds 10% of initial margin (${maxLoss})`);
        return { canTrade: false, reason: `Loss exceeds 10% of initial margin` };
      }
      return { canTrade: true };
    } catch (error: any) {
      this.logger.error(`PnL check failed: ${error.message}`);
      return { canTrade: false, reason: `PnL check failed: ${error.message}` };
    }
  }

  /**
   * Fetches and classifies news (mock implementation).
   * @returns Array of classified news items.
   */
  private async fetchNews(attempts = 3, delay = 5000): Promise<NewsItem[]> {
    // Check cache
    if (this.lastNewsFetch && Date.now() - this.lastNewsFetch < this.NEWS_CACHE_DURATION && this.cachedNews.length > 0) {
      this.logger.debug('Returning cached news data');
      return this.cachedNews;
    }

    for (let i = 0; i < attempts; i++) {
      try {
        this.logger.debug('Fetching news from economic calendar API');
        const response = await axios.get(this.NEWS_API_URL);
        const data = response.data;

        if (!Array.isArray(data)) {
          throw new Error('Invalid news data format: Expected an array');
        }

        const newsItems: NewsItem[] = data.map((item: any, index: number) => {
          const impact = item.impact === 'Holiday' ? 'HOLIDAY' : item.impact.toUpperCase();
          if (!['HIGH', 'MEDIUM', 'LOW', 'HOLIDAY'].includes(impact)) {
            this.logger.warn(`Invalid impact value for event "${item.title}": ${item.impact}`);
          }
          return {
            id: `${item.title}-${item.date}-${index}`, // Unique ID
            title: item.title,
            timestamp: Date.parse(item.date), // Convert ISO 8601 to ms
            impact: impact as 'HIGH' | 'MEDIUM' | 'LOW' | 'HOLIDAY',
          };
        }).filter((item: NewsItem) => ['HIGH', 'MEDIUM', 'LOW', 'HOLIDAY'].includes(item.impact));

        this.cachedNews = newsItems;
        this.lastNewsFetch = Date.now();
        this.logger.debug(`Fetched ${newsItems.length} news items from API`);
        console.log(newsItems)
        return newsItems;
      } catch (error: any) {
        this.logger.error(`Attempt ${i + 1} failed to fetch news: ${error.message}`);
        if (i < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          this.logger.error('Failed to fetch news after all attempts');
          throw new Error(`Failed to fetch news: ${error.message}`);
        }
      }
    }
    return []; // Fallback (never reached due to throw)
  }

  /**
   * Checks if trading is restricted due to high-impact news.
   * @returns Risk check result.
   */
  private async restrictTradingByNews(): Promise<RiskCheckResult> {
    try {
      const news = await this.fetchNews();
      const now = Date.now();
      const windowMs = this.NEWS_WINDOW_MINUTES * 60 * 1000; // 30 minutes in ms
      for (const item of news) {
        if (item.impact === 'HIGH') {
          const newsTime = item.timestamp;
          if (now >= newsTime - windowMs && now <= newsTime + windowMs) {
            this.logger.warn(`Trading blocked due to high-impact news: ${item.title}`);
            return { canTrade: false, reason: `High-impact news: ${item.title}` };
          }
          // Check if within 30 minutes before news to force close positions
          if (now >= newsTime - windowMs && now < newsTime) {
            await this.forceClosePositions();
          }
        }
      }
      return { canTrade: true };
    } catch (error: any) {
      this.logger.error(`News restriction check failed: ${error.message}`);
      return { canTrade: false, reason: `News check failed: ${error.message}` };
    }
  }

  /**
   * Forces closure of all open positions across all symbols.
   * @throws Error if closing positions fails.
   */
  private async forceClosePositions(): Promise<void> {
    try {
      await this.tradeService.closeAllPositions();
      this.logger.log('Forced closure of all open positions completed');
    } catch (error: any) {
      this.logger.error(`Failed to force close positions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Checks if trading is allowed based on risk rules (PnL and news).
   * @param symbol Trading pair (e.g., BTCUSDT).
   * @returns Risk check result.
   */
  async canTrade(symbol: string): Promise<RiskCheckResult> {
    try {
      // Check PnL
      const pnlCheck = await this.checkPnL(symbol);
      if (!pnlCheck.canTrade) {
        return pnlCheck;
      }
      // Check news restrictions
      const newsCheck = await this.restrictTradingByNews();
      if (!newsCheck.canTrade) {
        return newsCheck;
      }
      this.logger.debug(`Trading allowed for ${symbol}`);
      return { canTrade: true };
    } catch (error: any) {
      this.logger.error(`Risk check failed for ${symbol}: ${error.message}`);
      return { canTrade: false, reason: `Risk check failed: ${error.message}` };
    }
  }
}