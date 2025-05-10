
export class PairFormatHelper {
    static formatPair(pair: string, exchange = 'HYPERLIQUID'): Promise<string> {
        const upperPair = pair.toUpperCase();
        switch (exchange) {
            case 'HYPERLIQUID': {
                const pairSpecialHyperliquid = {
                    'KBONK': 'kBONK',
                    'KPEPE': 'kPEPE',
                    'KSHIB': 'kSHIB',
                    'KNEIRO': 'kNEIRO',
                    'KFLOKI': 'kFLOKI',
                    'KLUNC': 'kLUNC',
                    'KDOGS': 'kDOGS',
                };
                return pairSpecialHyperliquid[upperPair] || upperPair;
            }

            case 'BINANCE': {
                const pairSpecialBinance = {
                    'KSHIB': '1000SHIB',
                    'KPEPE': '1000PEPE',
                    'KBONK': '1000BONK',
                    'KNEIRO': '1000NEIRO',
                    'KFLOKI': '1000FLOKI',
                    'KLUNC': '1000LUNC',
                    'KDOGS': '1000DOGS',
                };
                const pairBinance = (pairSpecialBinance[upperPair] || upperPair )+'USDT'

                return Promise.resolve(pairBinance);
            }

            default:
                return Promise.resolve(upperPair);
        }
        
        
    }
}
