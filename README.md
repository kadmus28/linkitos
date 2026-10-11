# Linkitos

Linkitos is a responsive product-link collection for desktop and mobile browsers.

## Run it locally

Serve this folder over HTTP instead of opening `index.html` directly. From this folder, run:

```powershell
py -m http.server 8000
```

Then open `http://localhost:8000`. The installed PWA and share-to-Linkitos action require an HTTPS deployment (or localhost during development).

## Cloud sync

The app uses the existing `media-tracker` Supabase project. Linkitos data lives in the separate `linkitos_categories` and `linkitos_items` tables. Row Level Security policies restrict each account to its own rows; Realtime refreshes the collection on other open devices. The browser configuration contains only the project's publishable key. Never add a service-role or secret key to this folder.

Sign in with an existing Media Tracker account or create an account. On the first sign-in in a browser, previously saved Linkitos items are imported to the cloud; the six sample cards are omitted. The import runs once per browser to avoid copying the same local collection into multiple accounts.

The database schema is in `supabase/linkitos_schema.sql`. The authenticated `product-preview` Edge Function is in `supabase/functions/product-preview/index.ts` and is deployed to the connected project.

## Product details

“Completar datos del enlace” reads Open Graph, Twitter Card, and Product JSON-LD metadata. Stores can omit or block this information, so the title, image, and price remain editable. The price is a snapshot, not a live price tracker.

## Publish for mobile and desktop

The repository includes a GitHub Actions workflow at `.github/workflows/deploy-pages.yml`. After the source is pushed to a repository's `main` branch, enable GitHub Pages with **GitHub Actions** as the publishing source. The expected URL for the new `kadmus28/linkitos` repository is `https://kadmus28.github.io/linkitos/`. Add that URL to the Supabase Auth redirect allow list so email confirmation returns to Linkitos. The web manifest supports installation and the browser share sheet on browsers that support PWA share targets. The Service Worker caches the app shell; account data still requires an internet connection to synchronize.
