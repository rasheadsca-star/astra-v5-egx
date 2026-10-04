// ASTRA V4 EGX live connector
// Provider boundary for connecting an approved market data source.

export async function fetchLiveQuotes(provider) {
  if (!provider || typeof provider.getQuotes !== 'function') {
    return {
      status: 'WAITING_FOR_SOURCE',
      quotes: [],
      timestamp: new Date().toISOString()
    };
  }

  try {
    const quotes = await provider.getQuotes();

    if (!Array.isArray(quotes) || quotes.length === 0) {
      return {
        status: 'WAITING_FOR_SOURCE',
        quotes: [],
        timestamp: new Date().toISOString()
      };
    }

    return {
      status: 'CONNECTED',
      quotes,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'OFFLINE',
      quotes: [],
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

export default fetchLiveQuotes;
