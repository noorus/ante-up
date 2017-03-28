# ante-up
Ante dat cryptocoin investment bizniz up with an insecure IRC bot!

## configuration.json
```
{
  "poloniex": {
    "key": "poloniex api key",
    "secret": "poloniex api secret"
  },
  "coins": [
    { "name": "Dash", "sign": "dash",   "baselines": [] },
    { "name": "Monero", "sign": "xmr",  "baselines": [] },
    { "name": "Golem", "sign": "gnt",   "baselines": [] },
    { "name": "Augur", "sign": "rep",   "baselines": [] },
    { "name": "Ripple", "sign": "xrp",  "baselines": [] },
    { "name": "Sia", "sign": "sc",      "baselines": [] }
  ],
  "irc": {
    "server": "hostname",
    "channel": "#yourchannel",
    "channelpass": "yourchannelpassword",
    "nick": "ante-chan"
  }
}
```

## commands
```
> you: !btc
ante-chan: BTC/USD Currently B1 BTC = $1005 USD (€930.1275 EUR) (24h: +0.02238%)
> you: !coin xmr
ante-chan: XMR is Monero, and it's worth B0.01806 BTC = $18.58443 USD (€17.0672 EUR)
> you: !hot
ante-chan: 1) ETH  Ethereum: 42788.88477 BTC (24h volume)
ante-chan: 2) DCR  Decred:   11928.63006 BTC (24h volume)
ante-chan: 3) DASH Dash:     10627.97649 BTC (24h volume)
ante-chan: 4) XMR  Monero:    5334.07916 BTC (24h volume)
ante-chan: 5) XRP  Ripple:    3188.42887 BTC (24h volume)
> you: !balances
ante-chan: 1) REP  Augur         38.58556 REP  = B0.33533 BTC
ante-chan: 2) XRP  Ripple      7164.22373 XRP  = B0.16083 BTC
ante-chan: 3) SC   Siacoin     99750.1995 SC   = B0.05287 BTC
ante-chan: 4) GNT  Golem         999.1303 GNT  = B0.04731 BTC
ante-chan: 5) DASH Dash            0.1873 DASH = B0.01620 BTC
ante-chan: 6) SJCX Storjcoin X   61.56764 SJCX = B0.01210 BTC
ante-chan: 7) BTC  Bitcoin        0.00005 BTC  = B0.00005 BTC
ante-chan: 8) BTM  Bitmark           0.05 BTM  = B0.00001 BTC
ante-chan: Total: B0.62469 BTC = $635.93431 USD (€584.01663 EUR)
> you: !orders
ante-chan: SELL 0.1873 DASH for 0.02809 BTC at 0.15 BTC (44 minutes ago)
> you: !coins
ante-chan: I know these coins!
ante-chan: 1CR ABY AC ACH ADN AEON AERO AIR AMP APH ARCH ARDR AUR AXIS ... [rest of coins]
```

## please note
Doing any kind of investment work relying on a publicly open IRC bot
written half-assedly by someone you don't know would be incredibly irresponsible.
