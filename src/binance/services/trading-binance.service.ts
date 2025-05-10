import { Logger, Injectable } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { config } from 'dotenv';
config();

export interface TradeResult {
    mainOrder: any; // Lệnh chính (market order)
    takeProfitOrder: any; // Lệnh Take Profit (limit order)
    stopLossOrder: any; // Lệnh Stop Loss (stop market order)
  }

@Injectable()
export class TradeService {
    private readonly logger = new Logger(TradeService.name);
    private static readonly API_KEY = process.env.BINANCE_TESTNET_APIKEY;
    private static readonly API_SECRET =process.env.BINANCE_TESTNET_APISECRET;
    private static readonly BASE_URL = process.env.BINANCE_TESTNET_URL;
    private static readonly FIXED_NOTIONAL = 50;
    private static readonly LEVERAGE = 5;

    /**
     * Creates an HMAC-SHA256 signature for Binance API requests.
     * @param queryString The query string to sign.
     * @returns The HMAC-SHA256 signature.
     */
    createSignature(queryString: string): string {
        if (!crypto) {
            throw new Error('Crypto module is not available');
          }
          if (!TradeService.API_SECRET) {
            throw new Error('API secret is not set');
        }
        return crypto
            .createHmac('sha256', TradeService.API_SECRET)
            .update(queryString)
            .digest('hex');
    }

    async callBinanceApi(method: string, endpoint: string, params: any = {}): Promise<any> {
        const timestamp = Date.now();
        const queryString = new URLSearchParams({ ...params, timestamp }).toString();
        const signature = this.createSignature(queryString);
        

        const url = `${TradeService.BASE_URL}${endpoint}?${queryString}&signature=${signature}`;
        const config = {
            method,
            url,
            headers: { 'X-MBX-APIKEY': TradeService.API_KEY },
        };

        try {
            const response = await axios(config);
            return response.data;
        } catch (error: any) {
            throw new Error(`Error API: ${error.response?.data?.msg || error.message}`);
        }
    }

    async setLeverage(symbol: string, leverage: number = 5): Promise<any> {
        const params = {
            symbol,
            leverage,
        };
        try {
            const result = await this.callBinanceApi('POST', '/fapi/v1/leverage', params);
            this.logger.log(`Setting leverage successful for ${symbol}:`, result);
            return result;
        } catch (error) {
            throw new Error(`Error in setting leverage: ${error}`);
        }
    }

    async getCurrentPrice(symbol: string): Promise<number> {
        try {
            const response = await this.callBinanceApi('GET', '/fapi/v1/ticker/price', { symbol });
            return parseFloat(response.price);
        } catch (error) {
            throw new Error(`Error in getting current price of ${symbol}: ${error}`);
        }
    }

    async calculateQuantity(symbol: string, desiredValue: number = 50, leverage: number = 5): Promise<string> {
        try {
            const currentPrice = await this.getCurrentPrice(symbol);
            const effectiveValue = desiredValue * leverage;
            const quantity = effectiveValue / currentPrice;
            return quantity.toFixed(0);
        } catch (error) {
            throw new Error(`Error in calculating quantity: ${error}`);
        }
    }
    /**
   * Closes all open orders across all symbols.
   * @returns Array of canceled order details.
   * @throws Error if closing orders fails.
   */
    async closeAllPositions(): Promise<any[]> {
        try {
        const openOrders = await this.callBinanceApi('GET', '/fapi/v1/openOrders', {});
        const canceledOrders: any[] = [];
        for (const order of openOrders) {
            const symbol = order.symbol;
            const params = { symbol, orderId: order.orderId };
            const canceledOrder = await this.callBinanceApi('DELETE', '/fapi/v1/order', params);
            canceledOrders.push(canceledOrder);
            this.logger.log(`Canceled order ${order.orderId} for ${symbol}: ${JSON.stringify(canceledOrder)}`);
        }
        this.logger.log(`Closed ${canceledOrders.length} open orders across all symbols`);
        return canceledOrders;
        } catch (error: any) {
        this.logger.error(`Failed to close positions: ${error.message}`);
        throw error;
        }
    }

    /**
     * Executes a futures trade with take profit and stop loss orders.
     * @param symbol Trading pair (e.g., BTCUSDT).
     * @param side Order side (BUY or SELL).
     * @param takeProfit Take profit price.
     * @param stopLoss Stop loss price.
     * @throws Error if the trade execution fails.
     */
    async executeTrade(symbol: string, side: 'BUY' | 'SELL', takeProfit: number, stopLoss: number): Promise<TradeResult> {
        try {
        await this.setLeverage(symbol, 5);
        const quantity = await this.calculateQuantity(symbol);
        const mainOrderParams = {
            symbol,
            side,
            type: 'MARKET',
            quantity,
        };
        
        const mainOrder = await this.callBinanceApi('POST', '/fapi/v1/order', mainOrderParams);
        this.logger.log(`Placed order: ${JSON.stringify(mainOrder)}`);
        const tpSide = side === 'BUY' ? 'SELL' : 'BUY';
        const tpParams = {
            symbol,
            side: tpSide,
            type: 'LIMIT',
            quantity,
            price: takeProfit.toString(),
            timeInForce: 'GTC',
        };
        //   const tpOrder = await this.callBinanceApi('POST', '/fapi/v1/order', tpParams);
        //   this.logger.log(`Placed Take Profit order: ${JSON.stringify(tpOrder)}`);
        //   const slParams = {
        //     symbol,
        //     side: tpSide,
        //     type: 'STOP_MARKET',
        //     quantity,
        //     stopPrice: stopLoss.toString(),
        //   };
        //   const slOrder = await this.callBinanceApi('POST', '/fapi/v1/order', slParams);
        //   this.logger.log(`Placed Stop Loss order: ${JSON.stringify(slOrder)}`);
        //   return {
        //     mainOrder,
        //     takeProfitOrder: tpOrder,
        //     stopLossOrder: slOrder,
        //   };
        return mainOrder
        } catch (error: any) {
        this.logger.error(`Failed to execute trade for ${symbol}: ${error.message}`);
        throw error;
        }
    }
}