import { Logger, Injectable } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { config } from 'dotenv';
import { 
  TradeResult, 
  OrderParams, 
  OrderResponse,
  BinanceConfig 
} from '../../shared/interfaces/trading.interface';
import { 
  BinanceApiConfig,
  ApiResponse 
} from '../../shared/interfaces/api.interface';

config();

@Injectable()
export class TradeService {
    private readonly logger = new Logger(TradeService.name);
    private readonly config: BinanceConfig;
    private exchangeInfoCache: any = null; // Cache cho exchangeInfo

    constructor() {
        this.config = {
            apiKey: process.env.BINANCE_APIKEY || '',
            apiSecret: process.env.BINANCE_APISECRET || '',
            baseUrl: process.env.BINANCE_URL || '',
            fixedNotional: 1,
            leverage: 10
        };
    }

    /**
     * Creates an HMAC-SHA256 signature for Binance API requests.
     * @param queryString The query string to sign.
     * @returns The HMAC-SHA256 signature.
     */
    private createSignature(queryString: string): string {
        if (!crypto) {
            throw new Error('Crypto module is not available');
        }
        if (!this.config.apiSecret) {
            throw new Error('API secret is not set');
        }
        return crypto
            .createHmac('sha256', this.config.apiSecret)
            .update(queryString)
            .digest('hex');
    }

    /**
     * Calls Binance Futures API with authentication.
     * @param method HTTP method (GET, POST, DELETE, etc.).
     * @param endpoint API endpoint.
     * @param params Request parameters.
     * @returns API response data.
     */
    async callBinanceApi(method: string, endpoint: string, params: any = {}): Promise<any> {
        const timestamp = Date.now();
        const queryString = new URLSearchParams({ ...params, timestamp }).toString();
        const signature = this.createSignature(queryString);

        const url = `${this.config.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
        const config = {
            method,
            url,
            headers: { 'X-MBX-APIKEY': this.config.apiKey },
        };

        try {
            const response = await axios(config);
            return response.data;
        } catch (error: any) {
            throw new Error(`Error API: ${error.response?.data?.msg || error.message}`);
        }
    }

    /**
     * Gets available margin information from account.
     * @returns Details about available margin including balance, unrealized PNL, margin ratio, etc.
     */
    async getAvailableMargin(): Promise<any> {
        try {
            const accountInfo = await this.callBinanceApi('GET', '/fapi/v2/account', {});
            
           
            const availableBalance= parseFloat(accountInfo.availableBalance) // Số dư khả dụng

            
            this.logger.log(`Retrieved available margin: ${JSON.stringify(availableBalance)}`);
            return availableBalance;
        } catch (error: any) {
            this.logger.error(`Error in getting available margin: ${error.message}`);
            throw error;
        }
    }

    /**
     * Gets exchange info from Binance API and caches it.
     * @returns Cached or fresh exchange info.
     */
    private async getExchangeInfo(): Promise<any> {
        if (this.exchangeInfoCache) {
            this.logger.log('Using cached exchangeInfo');
            return this.exchangeInfoCache;
        }

        try {
            const exchangeInfo = await this.callBinanceApi('GET', '/fapi/v1/exchangeInfo');
            this.exchangeInfoCache = exchangeInfo;
            this.logger.log('Fetched and cached exchangeInfo');
            return exchangeInfo;
        } catch (error: any) {
            this.logger.error(`Failed to fetch exchangeInfo: ${error.message}`);
            throw error;
        }
    }

    /**
     * Gets tick size for a specific symbol.
     * @param symbol Trading pair (e.g., KDAUSDT).
     * @returns Tick size as a number.
     */
    async getTickSize(symbol: string): Promise<number> {
        try {
            const exchangeInfo = await this.getExchangeInfo();
            const symbolInfo = exchangeInfo.symbols.find((s: any) => s.symbol === symbol);
            if (!symbolInfo) {
                throw new Error(`Symbol ${symbol} not found in exchange info`);
            }
            const priceFilter = symbolInfo.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
            if (!priceFilter || !priceFilter.tickSize) {
                throw new Error(`Tick size not found for ${symbol}`);
            }
            const tickSize = parseFloat(priceFilter.tickSize);
            return tickSize;
        } catch (error: any) {
            this.logger.error(`Failed to get tick size for ${symbol}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Sets leverage for a symbol.
     * @param symbol Trading pair.
     * @param leverage Leverage value (default from config).
     * @returns Leverage setting result.
     */
    async setLeverage(symbol: string, leverage: number = this.config.leverage): Promise<any> {
        const params = {
            symbol,
            leverage,
        };
        try {
            const result = await this.callBinanceApi('POST', '/fapi/v1/leverage', params);
            this.logger.log(`Setting leverage successful for ${symbol}: ${JSON.stringify(result)}`);
            return result;
        } catch (error: any) {
            this.logger.error(`Error in setting leverage for ${symbol}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Gets the current market price for a symbol.
     * @param symbol Trading pair.
     * @returns Current price as a number.
     */
    async getCurrentPrice(symbol: string): Promise<number> {
        try {
            const response = await this.callBinanceApi('GET', '/fapi/v1/ticker/price', { symbol });
            return parseFloat(response.price);
        } catch (error: any) {
            this.logger.error(`Error in getting current price of ${symbol}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Calculates quantity based on desired notional value and leverage.
     * @param symbol Trading pair.
     * @param desiredValue Desired notional value (default from config).
     * @param leverage Leverage used (default from config).
     * @returns Calculated quantity as a string.
     */
    async calculateQuantity(symbol: string, desiredValue: number = this.config.fixedNotional, leverage: number = this.config.leverage): Promise<string> {
        try {
            const currentPrice = await this.getCurrentPrice(symbol);
            const effectiveValue = desiredValue * leverage;
            const quantity = effectiveValue / currentPrice;

            // Lấy quantityPrecision từ exchangeInfo
            const exchangeInfo = await this.getExchangeInfo();
            const symbolInfo = exchangeInfo.symbols.find((s: any) => s.symbol === symbol);
            if (!symbolInfo) {
                throw new Error(`Symbol ${symbol} not found in exchange info`);
            }
            const quantityPrecision = symbolInfo.quantityPrecision;
            return quantity.toFixed(quantityPrecision);
        } catch (error: any) {
            this.logger.error(`Error in calculating quantity for ${symbol}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Closes all open orders across all symbols.
     * @returns Array of canceled order details.
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
     * Rounds a price to comply with tick size.
     * @param price Price to round.
     * @param tickSize Tick size for the symbol.
     * @returns Rounded price as a string.
     */
    private roundToTickSize(price: number, tickSize: number): string {
        const tickSizeDecimal = tickSize.toString().split('.')[1]?.length || 0;
        const factor = 1 / tickSize;
        return (Math.round(price * factor) / factor).toFixed(tickSizeDecimal);
    }

    /**
     * Executes a futures trade with specified take profit and stop loss prices.
     * @param symbol Trading pair (e.g., KDAUSDT).
     * @param side Order side (BUY or SELL).
     * @param takeProfit Take profit price.
     * @param stopLoss Stop loss price.
     * @returns Trade result including main, TP, and SL orders.
     */
    async executeTrade(
        symbol: string, 
        side: 'BUY' | 'SELL',
        takeProfit: number,
        stopLoss: number
    ): Promise<TradeResult> {
        try {
            // Thiết lập đòn bẩy mặc định là 10
            const leverage = this.config.leverage || 10;
            await this.setLeverage(symbol, leverage);
            
            // Tính số lượng
            const quantity = await this.calculateQuantity(symbol);
            const positionSide = side === 'BUY' ? 'LONG' : 'SHORT';

            // Đặt lệnh chính (main order)
            const mainOrderParams = {
                symbol,
                side,
                positionSide,
                type: 'MARKET',
                quantity,
            };
            const mainOrder = await this.callBinanceApi('POST', '/fapi/v1/order', mainOrderParams);
            this.logger.log(`Placed order: ${JSON.stringify(mainOrder)}`);

            // Lấy thông tin precision và tick size từ cache
            const exchangeInfo = await this.getExchangeInfo();
            const symbolInfo = exchangeInfo.symbols.find((s: any) => s.symbol === symbol);
            if (!symbolInfo) {
                throw new Error(`Symbol ${symbol} not found in exchange info`);
            }
            const pricePrecision = symbolInfo.pricePrecision;
            const quantityPrecision = symbolInfo.quantityPrecision;
            const tickSize = await this.getTickSize(symbol);

            // Làm tròn quantity theo precision
            const roundedQuantity = parseFloat(quantity).toFixed(quantityPrecision);

            // Làm tròn giá TP và SL theo tick size
            const roundedTakeProfit = this.roundToTickSize(takeProfit, tickSize);
            const roundedStopLoss = this.roundToTickSize(stopLoss, tickSize);

            // Đặt lệnh Take Profit
            const tpSide = side === 'BUY' ? 'SELL' : 'BUY';
            const tpParams = {
                symbol,
                side: tpSide,
                type: 'LIMIT',
                positionSide,
                quantity: roundedQuantity,
                price: roundedTakeProfit,
                timeInForce: 'GTC',
            };
            const tpOrder = await this.callBinanceApi('POST', '/fapi/v1/order', tpParams);
            this.logger.log(`Placed Take Profit order: ${JSON.stringify(tpOrder)}`);

            // Đặt lệnh Stop Loss
            const slParams = {
                symbol,
                side: tpSide,
                positionSide,
                type: 'STOP_MARKET',
                quantity: roundedQuantity,
                stopPrice: roundedStopLoss,
            };
            const slOrder = await this.callBinanceApi('POST', '/fapi/v1/order', slParams);
            this.logger.log(`Placed Stop Loss order: ${JSON.stringify(slOrder)}`);

            // Trả về kết quả
            return {
                mainOrder,
                takeProfitOrder: tpOrder,
                stopLossOrder: slOrder,
            };
        } catch (error: any) {
            this.logger.error(`Failed to execute trade for ${symbol}: ${error.message}`);
            throw error;
        }
    }
}
