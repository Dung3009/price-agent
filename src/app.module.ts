import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// import { CryptoModule } from './crypto/crypto.module';
import { HyperliquidModule } from './hyperliquid/hyperliquid.module';
import { BinanceModule } from './binance/binance.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // CryptoModule,
    //HyperliquidModule,
    BinanceModule,
  ],
})
export class AppModule {}
