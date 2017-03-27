let plnx = require( "plnx" );
let moment = require( "moment" );
let redis_evalsha = require( "redis-evalsha" );
let irc = require( "irc" );
let sprintf = require( "sprintf-js" ).sprintf;
let request = require( "request" );
let f = require( "float" );
let fs = require( "fs" );
let pe = require( "print-error" );

let configuration = JSON.parse( fs.readFileSync( "configuration.json", "utf8" ) );

function* entries( obj ) {
  for ( let key of Object.keys( obj ) )
    yield [key, obj[key]];
}

function pad( pad, str, padLeft ) {
  if ( typeof str === 'undefined' )
    return pad;
  return ( padLeft ? ( pad + str ).slice( -pad.length ) : ( str + pad ).substring( 0, pad.length ) );
}

function dumpError( error ) {
  console.error( error );
}

let redisscript_sma = `local total = redis.call('get', KEYS[1] .. '.total')
local bottom = redis.call('rpop', KEYS[1] .. '.values')
total = total + ARGV[1] - bottom;
redis.call('set', KEYS[1] .. '.total', total)
redis.call('lpush', KEYS[1] .. '.values', ARGV[1])
local len = redis.call('llen', KEYS[1] .. '.values')
local avg = (total / len)
return avg`;

class MovingAverage {
  constructor( redis, reval, size, name, value )
  {
    this.redis = redis;
    this.reval = reval;
    this.name = name;
    this.size = size;
    this.redis.del( name+".values" );
    this.redis.set( name+".total", size * value );
    for ( let i = 0; i < size; i++ )
      this.redis.lpush( name+".values", value );
  }
  update( value )
  {
    let p = new Promise( ( resolve, reject ) => {
      this.rediseval.exec( "sma", [this.name], [value], ( err, res ) => {
        if ( err )
          reject( err );
        else
          resolve( res );
      });
    });
    return p;
  }
}

class Bot {
  constructor( ticker, config )
  {
    this.ticker = ticker;
    this.config = config;
    this.channel = this.config.channel;
  }
  sayError( to, error )
  {
    let str = sprintf( "%s: %s", irc.colors.wrap( "white", to ), irc.colors.wrap( "dark_red", error ) );
    this.client.say( this.channel, str );
  }
/*
  { date: 1490400000,
    high: 967.40187689,
    low: 888.98999998,
    open: 946.79999997,
    close: 950.97212081,
    volume: 10424668.016878,
    quoteVolume: 11261.95261788,
    weightedAverage: 925.65369173 }
*/
/*
{ id: 121,
  last: '949.19999994',
  lowestAsk: '949.12827896',
  highestBid: '946.12300083',
  percentChange: '-0.02646153',
  baseVolume: '15260792.13696330',
  quoteVolume: '16341.76942158',
  isFrozen: '0',
  high24hr: '979.00000000',
  low24hr: '888.98999998' }
*/
  say( args )
  {
    this.client.say( this.channel, sprintf.apply( this, arguments ) );
  }
  formatUSD( value, noeur )
  {
    let eur = ( this.ticker.rates.EUR * value );
    if ( !noeur )
      return sprintf( "%s USD (%s EUR)",
        irc.colors.wrap( "white", "$" + f.round( value, 5 ) ),
        irc.colors.wrap( "white", "€" + f.round( eur, 5 ) ) );
    else
      return sprintf( "%s USD", irc.colors.wrap( "white", "$" + f.round( value, 5 ) ) );
  }
  formatBTC( value )
  {
    return sprintf( "%s BTC", irc.colors.wrap( "white", "B" + f.round( value, 5 ) ) );
  }
  formatPercentage( percentage )
  {
    let str = ( percentage > 0.0 ? "+" : "" ) + f.round( percentage, 5 ) + "%";
    percentage = irc.colors.wrap( percentage > 0.0 ? "light_green" : "dark_red", str );
    return percentage;
  }
  formatDate( date )
  {
    return irc.colors.wrap( "white", date.format( "YYYY-MM-DD HH:mm:ss" ) );
  }
  formatVolume( volume )
  {
    return irc.colors.wrap( "light_green", f.round( Number.parseFloat( volume ), 5 ) );
  }
  respondBTC( to, series, current )
  {
    let header = irc.colors.wrap( "white", "BTC/USD" );
    let now = this.formatUSD( Number.parseFloat( current.last ) );
    let disp_percentage = this.formatPercentage( Number.parseFloat( current.percentChange ) );
    this.client.say( this.channel,
      header + " Currently " + this.formatBTC( 1.0 ) + " = " + now + " (24h: " + disp_percentage + ")"
    );
    if ( series !== null && series.length > 1 ) {
      let firstdate = moment( series[0].date, "X" );
      let newv = Number.parseFloat( current.last );
      let oldv = Number.parseFloat( series[0].weightedAverage );
      let percentage = ( ( newv - oldv ) / oldv * 100 );
      disp_percentage = this.formatPercentage( percentage );
      this.client.say( this.channel,
        header + " Since " + this.formatDate( firstdate ) + ": " + disp_percentage + " from " + this.formatUSD( oldv, true )
      );
    }
  }
  respondHot( to, volumes )
  {
    let count = 5;
    let show = [];
    let lengths = [0, 0, 0];
    for ( let i = 0; i < count; i++ )
    {
      let pair = volumes[i].pair.split( "_" );
      let currency = this.ticker.currencies[pair[1]];
      let vol = this.formatVolume( volumes[i].baseVolume );
      show.push({ short: pair[1], currency: currency, volume: vol });
      if ( pair[1].length > lengths[0] ) lengths[0] = pair[1].length + 2;
      if ( currency.name.length > lengths[1] ) lengths[1] = currency.name.length + 2;
      if ( vol.length > lengths[2] ) lengths[2] = vol.length + 1;
    }
    let shortpad = Array( lengths[0] ).join( " " );
    let longpad = Array( lengths[1] ).join( " " );
    let volpad = Array( lengths[2] ).join( " " );
    for ( let i = 0; i < count; i++ )
      this.client.say( this.channel, sprintf( "%i) ", i + 1 ) + irc.colors.wrap( "white", pad( shortpad, show[i].short, false ) ) + " " + pad( longpad, show[i].currency.name + ":", false ) + " " + pad( volpad, show[i].volume, true ) + " BTC (Poloniex 24h)" );
  }
  onMessage( channel, from, message )
  {
    let parts = message.split( " " );
    if ( parts.length < 1 )
      return;
    if ( parts[0] === "!btc" )
    {
      let time = null;
      if ( parts.length > 1 )
        time = moment( parts[1] );
      if ( time !== null && !time.isValid() ) {
        this.sayError( from, sprintf( `"%s" is not a valid time`, parts[1] ) );
        return;
      }
      Promise.all([
        ( time ? this.ticker.getChart( "USDT_BTC", time, moment() ) : Promise.resolve( null ) ),
        ( this.ticker.isBTCFresh() ? Promise.resolve( this.ticker.btc_usd ) : this.ticker.refreshBTC() )
      ]).then( ( values ) => {
        this.respondBTC( from, values[0], values[1] );
      }).catch( ( error ) => { this.sayError( from, "Chart fetch failed" ); console.error( error ); });
    }
    else if ( parts[0] === "!hot" )
    {
      this.ticker.refreshVolumes().then( ( volumes ) => {
        this.respondHot( from, volumes );
      }).catch( ( error ) => { this.sayError( from, "Volumes fetch failed" ); console.error( error ); });
    }
  }
  run()
  {
    let config = this.config;
    let me = this;
    this.client = new irc.Client( config.server, config.nick, {
      autoRejoin: true,
      encoding: 'utf-8',
      debug: true,
      channels: [[config.channel, config.channelpass].join( " " )]
    });
    this.client.addListener( "message" + config.channel, ( from, message ) => { this.onMessage( config.channel, from, message ); } );
  }
}

class Ticker {
  constructor( config )
  {
    this.config = config;
    this.btc_usd = [];
    this.btc_usd_last = null;
    this.monitor = [];
    this.redis = require( "redis" ).createClient();
    this.rediseval = new redis_evalsha( this.redis );
    this.rediseval.add( "sma", redisscript_sma );
    for ( let i = 0; i < config.coins.length; i++ )
    {
      this.monitor.push({ name: config.coins[i].name, pair: "BTC_"+config.coins[i].sign.toUpperCase(), value: [] });
    }
    this.currencies = null;
    this.rates = null;
    this.rates_last = null;
    this.volumes = [];
    this.refreshRates();
    this.bot = new Bot( this, config.irc );
  }
  update( data, entry )
  {
    entry.value = data;
    // TODO console.log(data);
  }
  refreshRates()
  {
    console.info( "Refreshing currency rates" );
    let me = this;
    request( { uri: "http://api.fixer.io/latest?base=USD", method: "GET", json: true }, ( error, response, body ) => {
      if ( error )
        dumpError( error );
      else {
        me.rates = body.rates;
        me.rates_last = moment();
      }
    });
  }
  isBTCFresh()
  {
    return ( this.btc_usd !== null && this.btc_usd_last !== null && ( moment().unix() - this.btc_usd_last.unix() ) < 30 ? true : false );
  }
  refreshBTC()
  {
    let me = this;
    return new Promise( ( resolve, reject ) => {
      plnx.returnTicker({}, ( error, data ) => {
        if ( error )
          reject( error );
        else {
          me.btc_usd = data["USDT_BTC"];
          me.btc_usd_last = moment();
          resolve( me.btc_usd );
        }
      });
    });
  }
  refreshVolumes()
  {
    let me = this;
    return new Promise( ( resolve, reject ) => {
      plnx.returnTicker({}, ( error, data ) => {
        if ( error )
          reject( error );
        else {
          me.volumes = [];
          for ( let [key, value] of entries( data ) ) {
            if ( key.substr( 0, 4 ) === "BTC_" ) {
              value.pair = key;
              me.volumes.push( value );
            }
          }
          me.volumes.sort( ( a, b ) => {
            if ( a.baseVolume == b.baseVolume )
              return 0;
            return ( Number.parseFloat( a.baseVolume ) > Number.parseFloat( b.baseVolume ) ? -1 : 1 );
          });
          resolve( me.volumes );
        }
      });
    });
  }
  getChart( pair, from, to )
  {
    return new Promise( ( resolve, reject ) => {
      plnx.returnChartData({ currencyPair: pair, start: from.unix(), end: to.unix(), period: 86400 }, ( error, data ) => {
        ( error ? reject( error ) : resolve( data ) );
      });
    });
  }
  initialize()
  {
    let me = this;
    let p = new Promise( ( resolve, reject ) => {
      plnx.returnCurrencies({}, ( error, data ) => {
        if ( error )
          reject( error );
        else {
          me.currencies = data;
          resolve( me.currencies );
        }
      });
    });
    return p;
  }
  start()
  {
    let me = this;
    setInterval( () => { this.refreshRates(); }, 600000 );
    this.bot.run();
    plnx.push( ( session ) => {
      session.subscribe( "ticker", ( data ) => {
        if ( data[0] === "USDT_BTC" ) {
          me.btc_usd = { id: 0, last: data[1], lowestAsk: data[2], highestBid: data[3], percentChange: data[4], baseVolume: data[5], quoteVolume: data[6], isFrozen: data[7], high24hr: data[8], low24hr: data[9] };
          me.btc_usd_last = moment();
        } else {
          for ( let i = 0; i < me.monitor.length; i++ )
          {
            if ( data[0] === me.monitor[i].pair ) {
              me.update( data, me.monitor[i] );
              break;
            }
          }
        }
      });
    });
  }
}

let tickr = new Ticker( configuration );
tickr.initialize().then(() => {
  tickr.start();
}).catch( error => { throw error; } );
