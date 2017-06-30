let moment = require( "moment" );
let sprintf = require( "sprintf-js" ).sprintf;
let request = require( "request" );
let f = require( "float" );

function* entries( obj ) {
  for ( let key of Object.keys( obj ) )
    yield [key, obj[key]];
}

module.exports = class BitTrex {
  constructor( config )
  {
    this.name = "Bittrex";
    this.config = config;
    this.bittrex = require( "node.bittrex.api" );
    this.bittrex.options({
      "apikey": this.config.key,
      "apisecret": this.config.secret,
      "stream": false,
      "verbose": true,
      "cleartext": false
    });
    this.markets = [];
  }
  makeEndpoint( resource )
  {
    return sprintf( "https://bittrex.com/api/v1.1/%s", resource );
  }
  getCurrencies()
  {
    return new Promise( ( resolve, reject ) => {
      this.bittrex.sendCustomRequest( this.makeEndpoint( "public/getcurrencies" ), ( data ) => {
        if ( !data.success || !data.result )
          return reject( new Error( "Could not fetch currencies" ) );
        let actual = {};
        for ( let [key, value] of entries( data.result ) ) {
          let btx = {
            txFee: value.TxFee,
            delisted: !value.IsActive,
            minConfirmations: value.MinConfirmation
          };
          let coin = { sign: value.Currency, name: value.CurrencyLong, exchanges: { bittrex: btx } };
          actual[coin.sign] = coin;
        }
        resolve( actual );
      }, false );
    });
  }
  getTick( pair )
  {
    return new Promise( ( resolve, reject ) => {
      let parts = pair.split( "_" );
      if ( parts.length != 2 )
        return reject( new Error( "Invalid currency pair" ) );
      pair = parts.join( "-" );
      this.bittrex.getticker( { market: pair }, ( data ) => {
        if ( !data.success || !data.result )
          return reject( new Error( "Could not fetch ticker" ) );
        let tick = {
          bid: data.result.Bid,
          last: data.result.Last,
          ask: data.result.Ask
        };
        resolve( tick );
      }, false );
    });
  }
  refreshMarkets()
  {
    let that = this;
    return new Promise( ( resolve, reject ) => {
      this.bittrex.getmarketsummaries( ( data ) => {
        if ( !data.success || !data.result )
          return reject( new Error( "Could not fetch markets" ) );
        let actual = [];
        for ( let [key, value] of entries( data.result ) ) {
          let pair = value.MarketName.split( "-" ).join( "_" );
          actual.push({
            pair: pair,
            high: value.High,
            low: value.Low,
            volume: value.Volume,
            last: value.Last,
            baseVolume: value.BaseVolume
          });
        }
        that.markets = actual;
        resolve( that.markets );
      }, false );
    });
  }
  getBTCFor( currency )
  {
    return this.getTick( "BTC_" . currency ).then( tick => {
      return tick.last;
    });
  }
  getBalances()
  {
    let markets = this.refreshMarkets();
    let balances = new Promise( ( resolve, reject ) => {
      this.bittrex.sendCustomRequest( this.makeEndpoint( "account/getbalances" ), ( data ) => {
        if ( !data.success || !data.result )
          return reject( new Error( "Could not fetch balances" ) );
        resolve( data.result );
      }, true );
    });
    return Promise.all([ markets, balances ]).then( values => {
      let actual = [];
      for ( let [key, value] of entries( values[1] ) ) {
        let available = Number.parseFloat( value.Available );
        let total = Number.parseFloat( value.Balance );
        let onOrders = total - available;
        let btc = 0;
        let btcpair = ["BTC", value.Currency].join( "_" );
        if ( total > 0.0 ) {
          let btc = 0;
          if ( value.Currency === "BTC" )
            btc = total;
          else
            for ( const market of values[0] )
              if ( market.pair === btcpair ) {
                btc = ( market.last * total );
                break;
              }
          actual.push({ currency: value.Currency, available: available, onOrders: onOrders, total: total, btc: btc });
        }
      }
      return actual;
    });
  }
}

