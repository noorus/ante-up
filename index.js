let plnx = require( "plnx" );
let moment = require( "moment" );
let redis_evalsha = require( "redis-evalsha" );
let irc = require( "irc" );
let sprintf = require( "sprintf-js" ).sprintf;
let request = require( "request" );
let f = require( "float" );
let fs = require( "fs" );

let configuration = JSON.parse( fs.readFileSync( "configuration.json", "utf8" ) );

let colors = {
  money: "white", // as in currency values
  error: "light_red", // "Ticker fetch failed"
  user: "white", // "nick": I cannot do that
  date: "white", // "2017-01-01 10:01:10"
  sign: "white" // "XRP"
};

function* entries( obj ) {
  for ( let key of Object.keys( obj ) )
    yield [key, obj[key]];
}

function dumpError( error ) {
  console.error( error );
}

// String pad polyfills by Behnam Mohammadi/uxitten

if ( !String.prototype.padStart ) {
  String.prototype.padStart = function padStart( targetLength, padString ) {
    targetLength = targetLength >> 0;
    padString = String( padString || ' ' );
    if ( this.length > targetLength )
      return String( this );
    else
      targetLength = targetLength - this.length;
    if ( targetLength > padString.length )
      padString += padString.repeat( targetLength / padString.length );
    return padString.slice( 0, targetLength ) + String( this );
  };
}

if ( !String.prototype.padEnd ) {
  String.prototype.padEnd = function padEnd( targetLength, padString ) {
    targetLength = targetLength >> 0;
    padString = String( padString || ' ' );
    if ( this.length > targetLength )
      return String( this );
    else
      targetLength = targetLength - this.length;
    if ( targetLength > padString.length )
      padString += padString.repeat( targetLength / padString.length );
    return String( this ) + padString.slice( 0, targetLength );
  };
}

function floatZeroPad( value, decimals )
{
  let parts = f.round( value, decimals ).toString().split( "." );
  if ( parts.length > 2 )
    throw new Error( "Rounded float has more than one decimal point?!" );
  if ( parts.length == 2 )
    parts[1] = parts[1].padEnd( decimals, "0" );
  return parts.join( "." );
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
    this.last_coins_time = 0;
  }
  sayError( to, error )
  {
    let str = sprintf( "%s: %s", irc.colors.wrap( colors.user, to ), irc.colors.wrap( colors.error, error ) );
    this.client.say( this.channel, str );
  }
  say( args )
  {
    this.client.say( this.channel, sprintf.apply( this, arguments ) );
  }
  currencyToString( value )
  {
    return floatZeroPad( value, 8 );
  }
  percentageToString( value )
  {
    return sprintf( "%+f%%", f.round( value, 5 ) );
  }
  formatUSD( value, noeur )
  {
    let eur = ( this.ticker.rates.EUR * value );
    if ( !noeur )
      return sprintf( "%s USD (%s EUR)",
        irc.colors.wrap( colors.money, "$" + this.currencyToString( value ) ),
        irc.colors.wrap( colors.money, "€" + this.currencyToString( eur ) ) );
    else
      return sprintf( "%s USD", irc.colors.wrap( colors.money, "$" + this.currencyToString( value ) ) );
  }
  formatCurrency( value, sign, prefix )
  {
    return sprintf( "%s %s", irc.colors.wrap( colors.money, prefix + this.currencyToString( value ) ), sign );
  }
  formatBTC( value )
  {
    return this.formatCurrency( value, "BTC", "B" );
  }
  formatPercentage( percentage )
  {
    return irc.colors.wrap( percentage > 0.0 ? "light_green" : "dark_red", this.percentageToString( percentage ) );
  }
  formatDate( date )
  {
    return irc.colors.wrap( colors.date, date.format( "YYYY-MM-DD HH:mm:ss" ) );
  }
  formatVolume( volume )
  {
    return irc.colors.wrap( "light_green", floatZeroPad( Number.parseFloat( volume ), 5 ) );
  }
  respondBTC( to, series, current )
  {
    let header = irc.colors.wrap( colors.sign, "BTC/USD" );
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
      if ( pair[1].length > lengths[0] ) lengths[0] = pair[1].length;
      if ( currency.name.length > lengths[1] ) lengths[1] = currency.name.length;
      if ( vol.length > lengths[2] ) lengths[2] = vol.length;
    }
    for ( let i = 0; i < count; i++ )
      this.client.say( this.channel, sprintf( "%i) ", i + 1 ) + irc.colors.wrap( colors.sign, show[i].short.padEnd( lengths[0] ) ) + " " + ( show[i].currency.name + ":" ).padEnd( lengths[1] + 1 ) + " " + show[i].volume.padStart( lengths[2] ) + " BTC (24h volume)" );
  }
  respondBalances( to, balances )
  {
    let total = 0.0;
    let show = [];
    let lengths = [0, 0, 0];
    for ( let i = 0; i < balances.length; i++ ) {
      total = total + balances[i].btc;
      let data = this.ticker.resolveCurrency( balances[i].currency );
      let item = { short: balances[i].currency, long: data.name, total: f.round( balances[i].total, 5 ).toString(), available: balances[i].available, onOrders: balances[i].onOrders, btc: balances[i].btc };
      if ( item.short.length > lengths[0] ) lengths[0] = item.short.length;
      if ( item.long.length > lengths[1] ) lengths[1] = item.long.length;
      if ( item.total.length > lengths[2] ) lengths[2] = item.total.length;
      show.push( item );
    }
      for ( let i = 0; i < show.length; i++ ) {
      this.client.say( this.channel, [
        sprintf( "%i)", i + 1 ),
        irc.colors.wrap( "white", show[i].short.padEnd( lengths[0] ) ),
        show[i].long.padEnd( lengths[1] ),
        irc.colors.wrap( "light_green", show[i].total.padStart( lengths[2] ) ),
        show[i].short.padEnd( lengths[0] ),
        "= " + this.formatBTC( show[i].btc )
      ].join( " " ) );
    }
    let totalfiat = this.formatUSD( this.ticker.btcToUSD( total ) );
    this.client.say( this.channel, ["Total:", this.formatBTC( total ), "=", totalfiat].join( " " ) );
  }
  respondOrders( to, buys, sells )
  {
    if ( buys.length < 1 && sells.length < 1 )
      return this.client.say( this.channel, "No open orders." );
    for ( let i = 0; i < buys.length; i++ ) {
      let entry = sells[i];
      this.client.say( this.channel, [
        irc.colors.wrap( "light_red", "BUY " ),
        this.formatCurrency( entry.amount, entry.src, "" ),
        "for",
        this.formatCurrency( entry.total, entry.dst, "" ),
        "at",
        this.formatCurrency( entry.rate, entry.dst, "" ),
        "(" + entry.time.fromNow() + ")"
      ].join( " " ) );
    }
    for ( let i = 0; i < sells.length; i++ ) {
      let entry = sells[i];
      this.client.say( this.channel, [
        irc.colors.wrap( "light_green", "SELL" ),
        this.formatCurrency( entry.amount, entry.src, "" ),
        "for",
        this.formatCurrency( entry.total, entry.dst, "" ),
        "at",
        this.formatCurrency( entry.rate, entry.dst, "" ),
        "(" + entry.time.fromNow() + ")"
      ].join( " " ) );
    }
  }
  respondCoin( to, key, coin )
  {
    let tosay = [
      irc.colors.wrap( "white", to ) + ":",
      irc.colors.wrap( "white", key ),
      "is",
      irc.colors.wrap( "white", coin.name ) + ","
    ];
    let pair = "BTC_" + key;
    if ( pair in this.ticker.ticker ) {
      tosay.push( "and it's worth" );
      tosay.push( this.formatBTC( this.ticker.ticker[pair].last ) );
      tosay.push( "= " + this.formatUSD( this.ticker.btcToUSD( this.ticker.ticker[pair].last ) ) );
    }
    this.client.say( this.channel, tosay.join( " " ) );
  }
  respondCoins( to )
  {
    let now = moment().unix();
    if ( now - this.last_coins_time < 300 )
      return this.sayError( to, "I've just listed them... :(" );
    this.last_coins_time = now;
    let coins = this.ticker.getCoins();
    this.client.say( this.channel, irc.colors.wrap( "white", to ) + ": I know these coins!" );
    let i = 1;
    let me = this;
    while ( coins.length > 0 ) {
      let msg = coins.splice( 0, 32 ).join( " " );
      setTimeout( () => {
        me.client.say( me.channel, irc.colors.wrap( colors.sign, msg ) );
      }, i * 1000 );
      i++;
    }
  }
  notifyFollow( follow )
  {
    let pair = follow.pair.split( "_" );
    let currency = this.ticker.currencies[pair[1]];
    let do_usdt = ( pair[0] === "USDT" );
    let tick = this.ticker.getTicker( follow.pair );
    let disp_percentage = this.formatPercentage( Number.parseFloat( tick.percentChange ) );
    this.client.say( this.channel, [
      irc.colors.wrap( "cyan", "UPDATE" ),
      irc.colors.wrap( colors.sign, pair[1] ),
      currency.name,
      "Currently",
      this.formatCurrency( 1, pair[1], "" ),
      "=",
      do_usdt ? this.formatUSD( this.ticker.btcToUSD( 1 ) ) : this.formatCurrency( tick.last, pair[0], "" ),
      "(24h: " + disp_percentage + ")"
    ].join( " " ) );
  }
  respondFollows( follows )
  {
    if ( follows.length < 1 )
      return this.client.say( this.channel, "Not following any coin." );
    for ( let i = 0; i < follows.length; i++ ) {
      let pair = follows[i].pair.split( "_" );
      let currency = this.ticker.currencies[pair[1]];
      let dur = moment.duration( follows[i].frequency ).humanize();
      this.client.say( this.channel, [
        irc.colors.wrap( "yellow", "FOLLOWING" ),
        irc.colors.wrap( colors.sign, pair[1] ),
        currency.name,
        sprintf( "(Report %s %s)", ( dur[0] === "a" ? "once" : "every" ), dur )
        ].join( " " )
      );
    }
  }
  parseCommand( str )
  {
    let prefix = this.config.prefix;
    if ( str.indexOf( prefix ) == 0 )
      return str.substr( prefix.length );
    return null;
  }
  onMessage( channel, from, message )
  {
    let parts = message.split( " " );
    if ( parts.length < 1 )
      return;
    let command = this.parseCommand( parts[0].toLowerCase() );
    if ( command === null )
      return;
    if ( command === "btc" )
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
    else if ( command === "hot" )
    {
      this.ticker.refreshVolumes().then( ( volumes ) => {
        this.respondHot( from, volumes );
      }).catch( ( error ) => { this.sayError( from, "Volumes fetch failed" ); console.error( error ); });
    }
    else if ( command === "balance" )
    {
      this.ticker.getBalances().then( ( balances ) => {
        this.respondBalances( from, balances );
      }).catch( ( error ) => { this.sayError( from, "Balances fetch failed" ); console.error( error ); });
    }
    else if ( command === "orders" )
    {
      this.ticker.getOrders().then( ( orders ) => {
        this.respondOrders( from, orders.buys, orders.sells );
      }).catch( ( error ) => { this.sayError( from, "Orders fetch failed" ); console.error( error ); });
    }
    else if ( command === "coin" )
    {
      if ( parts.length < 2 )
        return this.sayError( from, "Which coin?" );
      let key = parts[1].toUpperCase();
      let coin = this.ticker.resolveCurrency( key );
      if ( !coin )
        return this.sayError( from, "I don't know that coin!" );
      if ( key === "BTC" ) {
        this.onMessage( channel, from, "!btc" );
        return;
      }
      this.ticker.refreshBTC().then( () => {
        this.respondCoin( from, key, coin );
      }).catch( ( error ) => { this.sayError( from, "Ticker fetch failed" ); console.error( error ); });
    }
    else if ( command === "coins" )
    {
      this.respondCoins( from );
    }
    else if ( command === "follow" )
    {
      if ( parts.length < 2 )
        return this.sayError( from, "Follow what?" );
      let key = parts[1].toUpperCase();
      let coin = this.ticker.resolveCurrency( key );
      if ( !coin )
        return this.sayError( from, "I don't know that coin!" );
      let frequency = 3600000;
      if ( parts.length > 2 ) {
        let freqs = Number.parseInt( parts[2] );
        if ( freqs < 300 )
          return this.sayError( from, "That reporting frequency seems a little short, try 300 seconds (5 minutes) or more.." );
        else if ( freqs > 604800 )
          freqs = 604800; // once a week
        frequency = freqs * 1000;
      }
      let pair = ( key === "BTC" ? "USDT_BTC" : "BTC_" + key );
      this.ticker.addFollow( pair, frequency, false );
      this.say( "Done." );
    }
    else if ( command === "unfollow" )
    {
      if ( parts.length < 2 )
        return this.sayError( from, "Unfollow what?" );
      let key = parts[1].toUpperCase();
      let coin = this.ticker.resolveCurrency( key );
      if ( !coin )
        return this.sayError( from, "I don't know that coin!" );
      let pair = ( key === "BTC" ? "USDT_BTC" : "BTC_" + key );
      this.ticker.removeFollow( pair );
      this.say( "Done." );
    }
    else if ( command === "follows" )
    {
      this.respondFollows( this.ticker.getFollows() );
    }
  }
  run()
  {
    let config = this.config;
    let me = this;
    this.client = new irc.Client( config.server, config.nick, {
      autoRejoin: true,
      encoding: "utf-8",
      userName: "anteup",
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
    this.redis = require( "redis" ).createClient();
    this.rediseval = new redis_evalsha( this.redis );
    this.rediseval.add( "sma", redisscript_sma );
    this.currencies = null;
    this.rates = null;
    this.rates_last = null;
    this.volumes = [];
    this.bot = new Bot( this, config.irc );
    this.ticker = null;
    this.follows = [];
  }
  addFollow( pair, frequency, existing = false )
  {
    if ( !existing ) {
      this.removeFollow( pair );
      this.redis.hmset( this.config.redis.prefix + "follows", pair, frequency );
    }
    let entry = { pair: pair, frequency: Number.parseFloat( frequency ), last: moment.utc(), timer: null };
    let tmr = setInterval( ( follow ) => {
      this.bot.notifyFollow( follow );
    }, frequency, entry );
    entry.timer = tmr;
    this.follows.push( entry );
  }
  removeFollow( pair )
  {
    this.redis.hdel( this.config.redis.prefix + "follows", pair );
    for ( let i = 0; i < this.follows.length; i++ )
      if ( this.follows[i].pair.toUpperCase() === pair.toUpperCase() ) {
        clearInterval( this.follows[i].timer );
        this.follows.splice( i, 1 );
        break;
      }
  }
  getFollows()
  {
    return this.follows;
  }
  loadFollows()
  {
    let me = this;
    return new Promise( ( resolve, reject ) => {
      this.redis.hgetall( this.config.redis.prefix + "follows", ( error, obj ) => {
        if ( error )
          return reject( error );
        if ( !obj || typeof obj !== "object" )
          return resolve( true );
        for ( let [key, value] of entries( obj ) ) {
          me.addFollow( key, value, true );
        }
        return resolve( true );
      });
    });
  }
  refreshRates()
  {
    let me = this;
    return new Promise( ( resolve, reject ) => {
      request( { uri: "http://api.fixer.io/latest?base=USD", method: "GET", json: true }, ( error, response, body ) => {
        if ( error )
          return reject( error );
        me.rates = body.rates;
        me.rates_last = moment();
        console.info( "Refreshed fiat currency rates" );
        resolve( me.rates );
      });
    });
  }
  resolveCurrency( sign )
  {
    if ( !sign in this.currencies )
      return false;
    return ( this.currencies[sign] );
  }
  btcToUSD( value )
  {
    return ( this.btc_usd.last * value );
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
          me.ticker = data;
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
  getTicker( pair )
  {
    return this.ticker[pair];
  }
  getChart( pair, from, to )
  {
    return new Promise( ( resolve, reject ) => {
      plnx.returnChartData({ currencyPair: pair, start: from.unix(), end: to.unix(), period: 86400 }, ( error, data ) => {
        ( error ? reject( error ) : resolve( data ) );
      });
    });
  }
  getBalances()
  {
    return new Promise( ( resolve, reject ) => {
      plnx.returnCompleteBalances({ key: this.config.poloniex.key, secret: this.config.poloniex.secret }, ( error, data ) => {
        if ( error )
          return reject( error );
        let actual = [];
        for ( let [key, value] of entries( data ) ) {
          let available = Number.parseFloat( value.available );
          let onOrders = Number.parseFloat( value.onOrders );
          let total = available + onOrders;
          if ( total > 0.0 )
            actual.push({ currency: key, available: available, onOrders: onOrders, btc: Number.parseFloat( value.btcValue ), total: total });
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
  getOrders()
  {
    return new Promise( ( resolve, reject ) => {
      plnx.returnOpenOrders({ currencyPair: "all", key: this.config.poloniex.key, secret: this.config.poloniex.secret }, ( error, data ) => {
        if ( error )
          return reject( error );
        let sells = [], buys = [];
        for ( let [key, value] of entries( data ) ) {
          let pair = key.split( "_" );
          let src = pair[1];
          let dst = pair[0];
          for ( let i = 0; i < value.length; i++ ) {
            let entry = { src: src, dst: dst, amount: Number.parseFloat( value[i].startingAmount ), rate: Number.parseFloat( value[i].rate ), total: Number.parseFloat( value[i].total ), time: moment.utc( value[i].date ) };
            if ( value[i].type === "sell" )
              sells.push( entry );
            else if ( value[i].type == "buy" )
              buys.push( entry );
            else
              return reject( new Error( "Got unknown order type " + value[i].type + " for " + key ) );
          }
        }
        resolve({ buys: buys, sells: sells });
      });
    });
  }
  getCoins()
  {
    let coins = [];
    for ( let [key, value] of entries( this.currencies ) ) {
      coins.push( key );
    }
    return coins;
  }
  initialize()
  {
    console.log( "Initializing..." );
    let me = this;
    let promises = [
      new Promise( ( resolve, reject ) => {
        plnx.returnCurrencies({}, ( error, data ) => {
          if ( error )
            return reject( error );
          me.currencies = data;
          console.log( "Got tradeable currency data" );
          resolve( me.currencies );
        });
      }), this.refreshRates(), this.refreshBTC(), this.loadFollows()
    ];
    return Promise.all( promises );
  }
  start()
  {
    console.log( "Starting main..." );
    let me = this;
    setInterval( () => { this.refreshRates(); }, 600000 );
    this.bot.run();
    plnx.push( ( session ) => {
      session.subscribe( "ticker", ( data ) => {
        let item = { id: 0, last: data[1], lowestAsk: data[2], highestBid: data[3], percentChange: data[4], baseVolume: data[5], quoteVolume: data[6], isFrozen: data[7], high24hr: data[8], low24hr: data[9] };
        if ( data[0] === "USDT_BTC" ) {
          me.btc_usd = item;
          me.btc_usd_last = moment();
        }
        me.ticker[data[0]] = item;
      });
    });
  }
}

let tickr = new Ticker( configuration );
tickr.initialize().then(() => {
  tickr.start();
}).catch( error => { throw error; } );
