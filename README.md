# CinéNotes – Ratings for Netflix (AlloCiné, IMDb, Rotten Tomatoes)

Shows ratings in Netflix preview and detail modals:
- **AlloCiné**: press and spectator ratings (no key needed)
- **Rotten Tomatoes**: Tomatometer (no key needed)
- **IMDb + Metacritic**: needs a free OMDb key (https://www.omdbapi.com/apikey.aspx); without one, the IMDb chip is just a link

Netflix FR shows French titles. The extension looks the title up on AlloCiné first, then uses
AlloCiné's original title to search the English-language sites. Results are cached for 7 days.

## Install
1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and select this folder
4. (Optional) Click the extension icon and paste your OMDb key

If Netflix changes its markup, update the selectors in `content.js` (`MODAL_SELECTORS`, `extractInfo`, `insertionPoint`).

## Ranking (★ Classer)
The red **★ Classer** button (bottom right of Netflix) opens a panel listing every title loaded on the page,
sorted by the rating you choose: overall average, AlloCiné spectators/press, IMDb, or RT. You can also filter to films or series.
Netflix only loads posters you've scrolled to, so scroll the page and the panel adds the new titles as they appear.
Tip: genre pages (e.g. `netflix.com/browse/genre/34399` = films) show everything in one grid.

## Packaging
`./scripts/package.sh` builds `dist/extension-<version>.zip` for upload to the Chrome Web Store.

## Privacy
No analytics, no author-run server. Titles are looked up directly on the rating sites. See [PRIVACY.md](PRIVACY.md).

## Disclaimer
Not affiliated with or endorsed by Netflix, AlloCiné, IMDb, Rotten Tomatoes, Metacritic or OMDb. All trademarks belong to their owners.

## License
[MIT](LICENSE)
