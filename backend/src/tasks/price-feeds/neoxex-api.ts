import { query } from '../../utils/axios-query';

/**
 * NeoxEX lists this chain's coin as BTCB2 and quotes it against BTC.
 *
 * The regular price feeds (Kraken, Coinbase, ...) only know about BTC, so the
 * coin's fiat price is derived as:
 *
 *   BTCB2/<fiat> = BTC/<fiat> * BTCB2/BTC
 *
 * This class supplies the BTCB2/BTC leg. It deliberately does not implement
 * PriceFeed: it returns a ratio, not a fiat price, and is applied on top of
 * whatever the fiat feeds report.
 */
class NeoxexApi {
  public name: string = 'NeoxEX';
  public url: string = 'https://neoxa.exchange/api/exchange/tickers';
  public pair: string = 'BTCB2_BTC';

  /**
   * Fetch the BTCB2/BTC cross rate. Returns -1 when unavailable, so callers can
   * skip the update rather than fall back to a bare BTC price, which would be
   * wrong by more than two orders of magnitude.
   *
   * @asyncUnsafe
   */
  public async $fetchRatio(): Promise<number> {
    const response = await query(this.url);
    const tickers = response?.['tickers'];
    if (!Array.isArray(tickers)) {
      return -1;
    }

    const ticker = tickers.find(t => t?.['pair'] === this.pair);
    const ratio = parseFloat(ticker?.['lastPrice']);
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return -1;
    }

    return ratio;
  }
}

export default NeoxexApi;
