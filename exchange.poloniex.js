let moment = require( "moment" );
let sprintf = require( "sprintf-js" ).sprintf;
let request = require( "request" );
let f = require( "float" );
let plnx = require( "plnx" );

function* entries( obj ) {
  for ( let key of Object.keys( obj ) )
    yield [key, obj[key]];
}

module.exports = class Poloniex {
  constructor( config )
  {
    this.name = "Poloniex";
    this.config = config;
  }
  getCurrencies()
  {
    return new Promise( ( resolve, reject ) => {
      plnx.returnCurrencies({}, ( error, data ) => {
        if ( error )
          return reject( error );
        let actual = {};
        for ( let [key, value] of entries( data ) ) {
          let polo = {
            txFee: Number.parseFloat( value.txFee ),
            delisted: value.delisted,
            minConfirmations: value.minConf
          };
          let coin = { sign: key, name: value.name, exchanges: { poloniex: polo } };
          actual[coin.sign] = coin;
        }
        resolve( actual );
      });
    });
  }
  getBalances()
  {
    return new Promise( ( resolve, reject ) => {
      plnx.returnCompleteBalances({ key: this.config.key, secret: this.config.secret }, ( error, data ) => {
        if ( error )
          return reject( error );
        let actual = [];
        for ( let [key, value] of entries( data ) ) {
          let available = Number.parseFloat( value.available );
          let onOrders = Number.parseFloat( value.onOrders );
          let total = available + onOrders;
          let btcvalue = Number.parseFloat( value.btcValue );
          if ( total > 0.0 )
            actual.push({ currency: key, available: available, onOrders: onOrders, total: total, btc: btcvalue });
        }
        actual.sort( ( a, b ) => {
          if ( a.btc == b.btc )
            return 0;
          return ( a.btc > b.btc ? -1 : 1 );
        });
        resolve( actual );
      });
    });
  }
}

