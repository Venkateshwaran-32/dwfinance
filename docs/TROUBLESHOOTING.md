# Troubleshooting

| What you see | What to do |
|---|---|
| Mac: "cannot be opened because it is from an unidentified developer" or "Apple could not verify" | Open System Settings, Privacy & Security, scroll down and press **Open Anyway**. This appears because the file was downloaded, not because anything is wrong with it. Or use the terminal: `npm run app`. |
| Windows: "Windows protected your PC" | Press **More info**, then **Run anyway**. |
| "dwfinance needs Node.js" | Install the LTS version from https://nodejs.org, then start again. |
| Mac: the start file says Node.js is missing but you installed it | Open the Terminal app, go to the folder and run `npm run app`. |
| The first start seems stuck | It is downloading about 1 GB. Leave it for a few minutes. |
| The browser did not open | Look in the start window for the line `dwfinance is running: http://localhost:3000` and open that address yourself. |
| The address ends in 3001 or higher | Something else was already using port 3000. The app picked the next free one; this is fine. |
| No "Fast access" button | It only appears in development mode (`npm run app` or `npm run dev`). In production mode, log in with the demo account. |
| Ask AI says "Local AI is not running" | LM Studio is not running, its local server is not started, or no model is loaded. Follow the steps on that page, then press **Check again**. |
| Ask AI gives an error or a cut-off answer | The model was probably loaded with a small context length. Reload it in LM Studio with context length 16384. |
| Ask AI says "The AI is answering someone else right now" | Two answers are already being generated. Wait a few seconds. |
| A statement is labelled "Needs checking" | It was saved, but failed one of the checks. Open it on the Statements page to see exactly which line or page is wrong, and compare that line with the PDF. If a page is missing, download the statement again from your bank and re-upload it. |
| Other devices on my network cannot open the app | By design: it only accepts connections from the computer it runs on, because Fast access has no password. |
| Upload says "no extractable text" | The PDF is a scan or is password-protected. The app needs a PDF with real text in it. |
| Upload of a non-DBS statement takes minutes | That path uses the local AI model and is slow. DBS and POSB statements take about a second. |
| You want to start again from nothing | Stop the app, delete `prisma/dev.db` and `.env`, and start it again. |
