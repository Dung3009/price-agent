import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { TradingJob } from './jobs/trading.job';
import { AnalyzeTechnicalService } from './services/analyze-technical-binance.service';
import { SharedModule } from '../shared/shared.module';
import {HistoricalDataService} from './services/historical-data-binance.service';
import { TradeService } from './services/trading-binance.service';
import {RiskManagementService} from './services/risk-management.service';
import { NewsService } from './services/news.service';

@Module({
  imports: [HttpModule, ConfigModule, SharedModule],
  providers: [
    TradingJob,
    AnalyzeTechnicalService,
    HistoricalDataService,
    TradeService,
    RiskManagementService,
    NewsService

  ],
  //exports: [AnalyzeAgentService],
})
export class BinanceModule {}
