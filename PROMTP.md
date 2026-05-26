I want to build a NodeJS app that has a local Web UI to do optimized dark Yield Farming using a crypto wallet:

- We want to focus on Defillama data and API
- https://api-docs.defillama.com/ .
- Use popular standards bridges, using new or experimental bridgin in cryptos is risky.
- We want to make dynamic decision like "hold this yield position for N day/M hours etc".
- We want to focus on Stablecoins Mode but open to other Modes like Bluechips, LongTail (more Risky), Memecoins (Ultra Risky).
- Consider Brigding/Network/Trading Fees too, Fees can hurt performance so is important to consider and not to trade very often, possibly Daily is enought, not hourly, maybe we can hold positions for 8 hour solot, or 12 hours or 24 hours, but check risk every hour.
- Everything has to be automated , lets day hourly or daily rebalancing.
- Include Reporting via Telegram to my personal account in Telegram.
- Web UI Must include Chart or past performance and future expected performance.
- for Stablecoins Mode Defillama has ALL_USD_STABLES filter for Tokens, etc, explore different filter, also filter by TVL (to avoid thin pools).
- lets start with yield from https://defillama.com/yields  for initial version but open to outher staking or yield sources later.
- focus on Ethereum and Ethereum-compatible chains for initial version, but open to others chains later.
- Include financial metrics like Sortino Ratio and others.
- Include Volatility Risk metrics in real time and risk triggers to close positions.
- Make a model to do Linear or non=linear optimization of 
- Consider locking periods int he risk and decisions, like 7 days unstaking etc on Ethena for example.
- do not use LLM to make final investment or rebalancing decision, just use rules, numerical optimizations and restrictions.
- all trading and blockchain interaction must be automated, so you need to download contract interfaces and so, event some are very standard there are exceptions.
- Include papermode opration where we have N USDT or so and we do simulated rebalacnign, portfolio, fees and risk all. INitially we will do papertrading pls, then we can switch to real tokens money.
- the project is called DarkYield, use the CSS similar to Defillama both in Ligh and Dark colors.
- IMPORTANT: the pool have official predictions on the future APY, like "Outlook
The algorithm predicts the current APY of 2.37% to not fall below 1.90% within the next 4 weeks. Confidence: High". We need to scrape that or generate our own predictions or extrapolations. Usually Yield can be misleading they usually fall in the future so is important to know how quick they fall and when to get out!.
- You can use Python or other with optimization libraries to estimate the best estrategy, considering fixed costs like fees, to rebalance to the best portfolios possible. Consider APY, APY variation overtime and TVL variation over time of the pool. In python maybe this optimation oracle module.
- In general, if the pool or chain has enought funds (is not thin), we need to support the long tail of chain/projects/pool, because we can focus some of our funds in short term yield like hours, days or weeks. The whole point is getting the Dark Yield that other project or traders are not getting!
- The api in nodejs for defillama is this `npm install @defillama/api`
