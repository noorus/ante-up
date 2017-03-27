# ante-up
Ante dat cryptocoin investment bizniz up with an insecure IRC bot!

## configuration.json
```
{
  "key": "poloniex api key",
  "secret": "poloniex api secret",
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
> you: !hot
ante-chan: 1) ETH  Ethereum: 42788.88477 BTC (Poloniex 24h)
ante-chan: 2) DCR  Decred:   11928.63006 BTC (Poloniex 24h)
ante-chan: 3) DASH Dash:     10627.97649 BTC (Poloniex 24h)
ante-chan: 4) XMR  Monero:    5334.07916 BTC (Poloniex 24h)
ante-chan: 5) XRP  Ripple:    3188.42887 BTC (Poloniex 24h)
```

## please note
Doing any kind of investment work relying on a publicly open IRC bot  
written half-assedly by someone you don't know would be *incredibly* irresponsible.
