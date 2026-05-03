export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  try {
    const symbols = req.query.symbols || 'QQQ,MSFT,NVDA';
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=regularMarketPrice,symbol`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    });
    
    if (!response.ok) throw new Error(`Yahoo: ${response.status}`);
    
    const data = await response.json();
    const quotes = data?.quoteResponse?.result || [];
    
    const prices = {};
    quotes.forEach(q => {
      if (q.symbol && q.regularMarketPrice) {
        prices[q.symbol] = { usd: q.regularMarketPrice };
      }
    });
    
    res.status(200).json({ prices, ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message, ok: false });
  }
}
