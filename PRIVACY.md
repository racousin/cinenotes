# Privacy Policy

_Last updated: 2026-11-07_

This extension does not collect, sell, or transmit personal data to its author. There is no analytics, tracking, or server operated by the author.

## What the extension does with data
- **Titles you view on Netflix**: when a title is shown, its name, year, and type (film/series) are sent directly from your browser to AlloCiné (allocine.fr), Rotten Tomatoes (rottentomatoes.com), IMDb (imdb.com suggestion API), and, if you provided a key, OMDb (omdbapi.com) to look up ratings. Those requests are subject to those sites' own privacy policies. No cookies are sent with them (`credentials: 'omit'`).
- **OMDb API key** (optional): stored in `chrome.storage.sync` so it follows your Chrome profile. It is sent only to omdbapi.com.
- **Ratings cache**: results are stored locally in `chrome.storage.local` for 7 days to avoid repeat requests. You can clear it from the extension popup ("Vider le cache").

## What it does not do
- It does not read your Netflix account details, viewing history, or payment information.
- It does not share data with the author or any other third party beyond the rating sites listed above.

## Contact
Open an issue on the GitHub repository.
