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
    this.config = config;
    this.bittrex = require( "node.bittrex.api" );
    this.bittrex.options({
      "apikey": this.config.key,
      "apisecret": this.config.secret,
      "stream": false,
      "verbose": true,
      "cleartext": false
    });
  }
  getBalances()
  {
    return new Promise( ( resolve, reject ) => {
      this.bittrex.sendCustomRequest( "https://bittrex.com/api/v1.1/account/getbalances", ( data ) => {
        if ( !data.success || !data.result )
          return reject( new Error( "Could not fetch balances" ) );
        let actual = [];
        for ( let [key, value] of entries( data.result ) ) {
          let available = Number.parseFloat( value.Available );
          let total = Number.parseFloat( value.Balance );
          let onOrders = total - available;
          if ( total > 0.0 )
            actual.push({ currency: value.Currency, available: available, onOrders: onOrders, total: total });
        }
        resolve( actual );
      }, true );
    });
  }
}

