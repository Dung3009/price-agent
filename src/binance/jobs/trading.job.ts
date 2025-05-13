import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AnalyzeTechnicalService } from '../services/analyze-technical-binance.service';
import { CacheService } from '../../shared/services/cache.service';
import { CoinListService } from 'src/shared';
import { TradingSignal } from '../services/analyze-technical-binance.service';
import { TradeService } from '../services/trading-binance.service';
import { PairFormatHelper } from '../../shared/helper/pair-format.helper';
import { RiskManagementService } from '../services/risk-management.service';


interface TradingOpportunity {
  coin: string;
  side: 'long' | 'short';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reasons: string[];
  timestamp: number;
}

@Injectable()
export class TradingJob {
  private readonly logger = new Logger(TradingJob.name);
  private monitoredCoins: string[] = [];
  private readonly BATCH_SIZE = 10; // Process 5 coins at a time
  private readonly BATCH_DELAY = 2000; // 2 seconds between batches

  constructor(
    private readonly tradingAgentService: AnalyzeTechnicalService,
    private readonly cacheService: CacheService,
    private readonly coinListService: CoinListService,
    private readonly tradeService: TradeService,
    private riskService : RiskManagementService,
  ) {
    setTimeout(() => {
      this.monitoredCoins = this.coinListService
        .getSupportedCoins()
        .map((coin) => coin.symbol.toUpperCase());
      this.logger.log(`Initialized with ${this.monitoredCoins.length} coins`);
      void this.monitorTradingOpportunities('Day Trading');
    }, 10000);
  }

  @Cron('*/5 * * * *')
  async monitorTradingOpportunities(
    style?: 'Scalping' | 'Day Trading' | 'Swing Trading' | 'Position Trading',
  ) {
    this.logger.log('Checking risks and scanning for trading opportunities...');

    try {
      // Check news restrictions
      const newsCheck = await this.riskService.restrictTradingByNews();
      if (!newsCheck.canTrade) {
        this.logger.warn(`Risk detected: ${newsCheck.reason}`);
        await this.tradeService.closeAllPositions();
        this.logger.log('Closed all positions due to significant news');
        return;
      }

      // Check unrealized losses
      const unrealizedLossCheck = await this.riskService.checkUnrealizedLoss();
      if (!unrealizedLossCheck.canTrade) {
        this.logger.warn(`Risk detected: ${unrealizedLossCheck.reason}`);
        return;
      }

      // Check available margin
      const availableMargin = await this.tradeService.getAvailableMargin();
      if (availableMargin <= 1) {
        this.logger.warn(`Insufficient margin: ${availableMargin}. Minimum required: 1`);
        return;
      }

      this.logger.log(`Scanning for ${style || 'all'} trading opportunities...`);
      const opportunities: TradingOpportunity[] = [];

      // Process coins in batches
      for (let i = 0; i < this.monitoredCoins.length; i += this.BATCH_SIZE) {
        const batch = this.monitoredCoins.slice(i, i + this.BATCH_SIZE);
        this.logger.debug(
          `Processing batch ${i / this.BATCH_SIZE + 1}: ${batch.join(', ')}`,
        );

        await Promise.all(
          batch.map(async (coin) => {
            const signal = await this.analyzeWithRetry(coin, style);
            if (signal) {
              opportunities.push({
                coin: signal.coin,
                side: signal.side,
                entryPrice: signal.entryPrice,
                stopLoss: signal.stopLoss,
                takeProfit: signal.takeProfit,
                confidence: signal.confidence,
                reasons: signal.reason,
                timestamp: Date.now(),
              });
              this.logSignal(signal);
              try {
                const coinFormatted = await PairFormatHelper.formatPair(coin,'BINANCE');
                const riskCheck = await this.riskService.canTrade(coinFormatted);
                if (!riskCheck.canTrade) {
                  this.logger.warn(
                    `Trading blocked for ${coinFormatted}: ${riskCheck.reason}`,
                  );
                  return;
                }

                const side = signal.side === 'long' ? 'BUY' : 'SELL';
                const tradeResult = await this.tradeService.executeTrade(
                  coinFormatted,
                  side,
                  Number(signal.takeProfit.toFixed(6)),
                  Number(signal.stopLoss.toFixed(6)),
                );
                this.logger.log(
                  `Trade executed for ${coinFormatted}: ${JSON.stringify(tradeResult)}`,
                );
              } catch (error: any) {
                this.logger.error(
                  `Error executing trade for ${signal.coin}: ${error.message}`,
                );
              }
            }
          }),
        );

        // Wait between batches
        if (i + this.BATCH_SIZE < this.monitoredCoins.length) {
          await new Promise((resolve) => setTimeout(resolve, this.BATCH_DELAY));
        }
      }

      // Log summary
      if (opportunities.length > 0) {
        this.logSummary(opportunities);
      } else {
        this.logger.log(
          `No ${style || ''} trading opportunities found in this scan`,
        );
      }
    } catch (error) {
      this.logger.error('Error monitoring trading opportunities:', error);
    }
  }

  private async analyzeWithRetry(
    coin: string,
    style?: 'Scalping' | 'Day Trading' | 'Swing Trading' | 'Position Trading',
    maxRetries = 3,
    delay = 2000,
  ): Promise<TradingSignal | null> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.tradingAgentService.analyzeTradeOpportunity(
          coin,
          style,
        );
      } catch (error: any) {
        if (error.response?.status === 429) {
          this.logger.warn(
            `Rate limit hit for ${coin}, attempt ${attempt}/${maxRetries}. Waiting ${
              delay / 1000
            }s...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        } else {
          this.logger.error(`Error analyzing ${coin}:`, error);
          return null;
        }
      }
    }
    this.logger.error(`Failed to analyze ${coin} after ${maxRetries} attempts`);
    return null;
  }

  private logSignal(signal: TradingSignal) {
    const riskReward = Math.abs(
      (signal.takeProfit - signal.entryPrice) /
        (signal.stopLoss - signal.entryPrice),
    ).toFixed(4);

    this.logger.log(`
      Signal Found: ${signal.coin} - ${signal.side.toUpperCase()} (${signal.confidence}% confidence)
      Entry: $${Number(signal.entryPrice).toFixed(6)} | SL: $${Number(signal.stopLoss).toFixed(6)} | TP: $${Number(signal.takeProfit).toFixed(6)}
      R/R Ratio: ${riskReward}
      Reasons: ${signal.reason.join(', ')}
      `);
  }

  private logSummary(opportunities: TradingOpportunity[]) {
    const highConfidence = opportunities.filter((opp) => opp.confidence >= 75);
    if (highConfidence.length > 0) {
      this.logger.warn(
        `\nHigh Confidence Signals Summary (≥75%):\n${highConfidence
          .map(
            (opp) =>
              `${opp.coin}: ${opp.side.toUpperCase()} @ $${Number(opp.entryPrice).toFixed(4)}`,
          )
          .join('\n')}`,
      );
    }
  }
}
