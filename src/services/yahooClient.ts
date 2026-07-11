import YahooFinanceImport from "yahoo-finance2";

// yahoo-finance2 v3 changed its API: the default export is a *class* and must
// be instantiated. Calling the methods directly on the imported object throws
// "Call `const yahooFinance = new YahooFinance()` first."
//
// We create ONE shared instance so the cookie/crumb session is reused across
// chart, quoteSummary, search, and ticker calls (also helps warm-start latency).
//
// Bundler interop note: under some loaders `import X from "yahoo-finance2"`
// yields the module namespace (with `.default` = the class) rather than the
// class itself. The `?.default ??` guard handles both resolutions.
const YahooFinance =
  ((YahooFinanceImport as unknown as { default?: unknown })?.default ??
    YahooFinanceImport) as typeof YahooFinanceImport;

const yahooFinance = new YahooFinance();

export default yahooFinance;
