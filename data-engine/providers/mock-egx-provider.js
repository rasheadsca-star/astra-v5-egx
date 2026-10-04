// Temporary provider contract implementation.
// Replace fetchQuotes() with real EGX market source integration.

export default {
  name: 'MOCK_EGX_PROVIDER',

  async fetchQuotes() {
    return [];
  }
};
