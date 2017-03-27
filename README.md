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

## please note
Doing any kind of investment work relying on a publicly open IRC bot
written half-assedly by someone you don't know would be incredibly irresponsible.
And fun.
