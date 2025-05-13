import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import * as crypto from 'crypto';
import { TradeService } from '../services/trading-binance.service';
import { NewsService } from './news.service';
import { NewsItem } from '../../shared/interfaces/news.interface';
import { config } from 'dotenv';
config();

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
  private readonly BASE_URL = process.env.BINANCE_URL;
  private readonly MAX_LOSS_PERCENTAGE = 0.1; // 10%
  private readonly NEWS_WINDOW_MINUTES = 30; // 30 minutes before/after high-impact news
  private readonly NEWS_API_URL = process.env.NEWS_API_URL;
  private readonly NEWS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  private cachedNews: NewsItem[] = [];
  private lastNewsFetch: number | null = null;
  private readonly RESTRICT_ONE_POSITION = true; // Temporary for testing
  private isTradingBlocked = false; // Flag to block trading after forced closure

  constructor(
    private configService: ConfigService,
    private tradeService: TradeService,
    private newsService: NewsService,
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
    const apiKey = this.configService.get<string>('BINANCE_APIKEY');
    const apiSecret = this.configService.get<string>('BINANCE_APISECRET');
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
      throw new Error(`Error API: ${errorMsg}`);
    }
  }

  /**
   * Fetches total margin balance at the start of the day.
   * Runs daily at 00:00 UTC.
   */
  @Cron(CronExpression.EVERY_12_HOURS)
  async fetchInitialMargin(): Promise<void> {
    try {
      const account = await this.callBinanceApi('GET', '/fapi/v2/account');
      this.initialMargin = parseFloat(account.totalMarginBalance);
      this.marginFetchTime = Date.now();
      this.isTradingBlocked = false; // Reset trading block on new margin fetch
      this.logger.log(`Fetched initial margin: ${this.initialMargin} USDT at ${new Date(this.marginFetchTime).toISOString()}`);
    } catch (error: any) {
      this.logger.error(`Failed to fetch initial margin: ${error.message}`);
      throw error;
    }
  }

  /**
   * Checks unrealized loss from open positions against initial margin.
   * Closes all positions and blocks trading if loss exceeds 10%.
   * @returns Risk check result.
   */
  public async checkUnrealizedLoss(): Promise<RiskCheckResult> {
    if (!this.initialMargin) {
      return { canTrade: false, reason: 'Initial margin not fetched' };
    }
    try {
      const positions = await this.callBinanceApi('GET', '/fapi/v3/positionRisk', {});
      const totalUnrealizedLoss = positions.reduce((sum: number, pos: any) => {
        return sum + parseFloat(pos.unRealizedProfit);
      }, 0);
      const maxLoss = this.initialMargin * this.MAX_LOSS_PERCENTAGE;
      this.logger.debug(`Total unrealized loss: ${totalUnrealizedLoss}, Max allowed loss: ${maxLoss}`);

      if (totalUnrealizedLoss < -maxLoss) {
        this.logger.warn(`Unrealized loss (${totalUnrealizedLoss}) exceeds 10% of initial margin (${maxLoss})`);
        await this.forceClosePositions();
        this.isTradingBlocked = true;
        return {
          canTrade: false,
          reason: 'Unrealized loss exceeds 10% of initial margin. All positions closed and trading blocked.',
        };
      }
      return { canTrade: true };
    } catch (error: any) {
      this.logger.error(`Unrealized loss check failed: ${error.message}`);
      return { canTrade: false, reason: `Unrealized loss check failed: ${error.message}` };
    }
  }

  /**
   * Checks if trading is restricted due to high-impact news.
   * @returns Risk check result.
   */
  public async restrictTradingByNews(): Promise<RiskCheckResult> {
    try {
      const news = await this.newsService.getNews();
      const now = Date.now();
      const windowMs = this.NEWS_WINDOW_MINUTES * 60 * 1000;

      for (const item of news) {
        if (item.impact === 'HIGH') {
          const newsTime = item.timestamp;
          if (now >= newsTime - windowMs && now <= newsTime + windowMs) {
            this.logger.warn(`Trading blocked due to high-impact news: ${item.title}`);
            return { canTrade: false, reason: `High-impact news: ${item.title}` };
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
   * Temporary check to restrict trading to only one open position (for testing).
   * @returns Risk check result.
   */
  private async restrictToOnePosition(): Promise<RiskCheckResult> {
    try {
      const positions = await this.callBinanceApi('GET', '/fapi/v3/positionRisk', {});
      const openPositions = positions.filter((pos: any) => parseFloat(pos.positionAmt) !== 0);
      if (openPositions.length >= 3) {
        this.logger.warn(`Trading blocked: Only one open position allowed (current: ${openPositions.length})`);
        return { canTrade: false, reason: `Only one open position allowed` };
      }
      return { canTrade: true };
    } catch (error: any) {
      this.logger.error(`Position restriction check failed: ${error.message}`);
      return { canTrade: false, reason: `Position check failed: ${error.message}` };
    }
  }

  /**
   * Checks if trading is allowed based on risk rules (unrealized loss and news).
   * @param symbol Trading pair (e.g., BTCUSDT).
   * @returns Risk check result.
   */
  async canTrade(symbol: string): Promise<RiskCheckResult> {
    try {
      // Check if trading is blocked due to previous unrealized loss trigger
      if (this.isTradingBlocked) {
        return { canTrade: false, reason: 'Trading blocked due to previous unrealized loss exceeding 10%' };
      }

      // // Temporary: Restrict to one open position
      // if (this.RESTRICT_ONE_POSITION) {
      //   const positionCheck = await this.restrictToOnePosition();
      //   if (!positionCheck.canTrade) {
      //     return positionCheck;
      //   }
      // }

      // Check unrealized loss
      const unrealizedLossCheck = await this.checkUnrealizedLoss();
      if (!unrealizedLossCheck.canTrade) {
        return unrealizedLossCheck;
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