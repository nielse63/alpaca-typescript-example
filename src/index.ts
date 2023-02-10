import Alpaca from '@alpacahq/alpaca-trade-api';
import * as dotenv from 'dotenv';
import moment from 'moment';
import findLastIndex from 'lodash.findlastindex';
import { SMA } from 'trading-signals';

dotenv.config();

const SYMBOL = 'MSFT';
const SMA_FAST_INTERVAL = 7;
const SMA_SLOW_INTERVAL = 14;
const LOOKBACK_PERIOD = 365;
const BARS_TIMEFRAME = '1Day';

const algotrader = async () => {
  // get alpaca instance
  const alpaca = new Alpaca({
    keyId: process.env.ALPACA_KEY,
    secretKey: process.env.ALPACA_SECRET,
    paper: process.env.ALPACA_URL?.includes('paper-api.alpaca.markets'),
  });

  // ensure market is open
  const clock = await alpaca.getClock();
  if(!clock.is_open) {
    console.log('market is not open - exiting');
    return;
  }

  // get bars & calculate SMA
  const calendar = await alpaca.getCalendar();
  const barsIndex = findLastIndex(
    calendar,
    (d: any) => d.date <= moment(clock).format('YYYY-MM-DD')
  );
  const days = calendar.slice(barsIndex - LOOKBACK_PERIOD, barsIndex);
  const barsResponse = alpaca.getBarsV2(SYMBOL, {
    start: days.shift().date,
    end: days.pop().date,
    timeframe: BARS_TIMEFRAME,
  });
  const smaFast = new SMA(SMA_FAST_INTERVAL);
  const smaSlow = new SMA(SMA_SLOW_INTERVAL);
  const bars: any[] = [];
  let i = 0;
  for await (const object of barsResponse) {
    const bar = {
      ...object,
      SMAFast: 0,
      SMASlow: 0,
    };
    smaFast.update(bar.ClosePrice);
    smaSlow.update(bar.ClosePrice);
    if (i >= SMA_FAST_INTERVAL) {
      bar.SMAFast = parseFloat(smaFast.getResult().valueOf());
    }
    if (i >= SMA_SLOW_INTERVAL) {
      bar.SMASlow = parseFloat(smaSlow.getResult().valueOf());
    }
    bars.push(object);
    i += 1;
  }
  const lastBar = bars[bars.length - 1];

  // get open positions for {SYMBOL}
  const positions = await alpaca.getPositions();
  const hasOpenPosition = positions.some((position: any) => position.symbol === SYMBOL);

  // get buying power
  const account = await alpaca.getAccount();
  const { cash } = account;

  // cancel all open orders
  await alpaca.cancelAllOrders();

  // if we have open positions, check for sell signal
  if(hasOpenPosition && lastBar.SMAFast < lastBar.SMASlow) {
    // close open positions for {SYMBOL}
    console.log('selling');
    await alpaca.closePosition(SYMBOL);
  }

  // if we have buying power > $1, check for buy signal
  else if (parseFloat(cash) > 1 && lastBar.SMAFast > lastBar.SMASlow) {
    // create buy order
    console.log('buying');
    await alpaca.createOrder({
      symbol: SYMBOL,
      notional: cash,
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
    });
  }
}

algotrader().catch(console.error)
