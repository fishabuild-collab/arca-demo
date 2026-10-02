# Arca: deal room demo (static)

Arca is a secure virtual data room with sales intelligence for a Hong Kong property deal. This is a static copy of the hackathon console that runs entirely in the browser.

- **No server and no AI connection.** `static.js` answers every `/api/*` call in the browser from `demo_data.json` and the mock documents. All AI results (extraction, conflict checks, Ask, follow-ups, pricing) come from cached answers and are labelled "Cached".
- **Demo data only.** All parties and documents are fictional and marked "Mock · demo only". Market figures come from public 2026 press reports.

## What you can try
- **Deal room:** the documents table, filters and search. Switch roles from the left sidebar: Investment Team, Lawyer, Banker or External Buyer. A buyer opening the valuation report is refused.
- **Extraction:** click a conflict, such as saleable area, to compare the two source quotes side by side.
- **Document viewer:** open a document to see the real mock PDF, with the quote highlighted and a watermark.
- **Market:** comparable sales and a suggested price range.
- **Security:** access by role, buyer signals and a follow-up draft in English and Traditional Chinese.

Not in this copy: the client phone portal, the QR invite and blackout sharing. They need the live server.

## Run locally
```bash
python3 -m http.server 8000
```
Then open http://localhost:8000.
