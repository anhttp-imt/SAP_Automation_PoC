# Sap Automation PoC — Web Test Automation

A PoC that simulates the core features of Tricentis Sap Automation: **Object Identification**, **Scriptless Test Automation**, **Record & Playback**, **Test Suite** (combining multiple test cases into one workflow), **Test Execution & Report**. See `sap-automation-poc-plan.md` for detailed design.

The architecture consists of 2 separate parts:
- **Extension** (`sap-automation-poc-extension/`): handles only **Object Identification (Scan)** — since only an extension has the permissions to inject scripts/read the DOM/capture screenshots of the tab under test.
- **Web App** (`sap-automation-poc-webapp/`): **Test Builder**, **Record & Playback**, **Run & Report** — communicates with the extension via Chrome's `externally_connectable` channel (nothing extra to install, just run 1 local static server).

## 1. Load the extension into Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right corner)
3. Click **Load unpacked** → select the `sap-automation-poc-extension` folder (the folder containing `manifest.json`)
4. Click the extension icon → the Side Panel opens on the right, showing the **Extension ID** at the top of the page — click **Copy** to grab this ID (you'll need to paste it into the Web App in step 3).

After editing code, go back to `chrome://extensions` and click the reload button (⟳) on the extension card.

> Note: the ID of an unpacked extension is derived from its install path, so it stays the same as long as you don't move the `sap-automation-poc-extension` folder elsewhere.

## 2. Run the Web App

```bash
cd sap-automation-poc-webapp
node server.js
```

Open `http://localhost:8787` in **its own tab** (not the tab under test).

> Port `8787` is hardcoded in `manifest.json` (`externally_connectable`). If you change the port, update it in both places.

## 3. Connect Web App ⇄ Extension

1. In the Web App, paste the **Extension ID** copied in step 1 into the field at the top of the page → click **Connect**. The status changes to "Connected".
2. Open the page you want to test in **a different tab** (e.g. `sap-automation-poc-extension/sample/sample-page.html`).
3. In the Web App, select that tab from the **Target Tab** dropdown (click ⟳ Refresh if a newly opened tab doesn't appear yet). All Record/Run actions target the tab selected here, **not** the tab that's active when you click the button (since the Web App itself is also a tab).

## 4. Basic test flow

### a. Scan objects (in the Extension Side Panel)

Two ways to build the Object Repository — pick whichever fits the page:

**Manual scan (hover & click one at a time)**
1. Open the extension's Side Panel, click **Start Scan**.
2. On the tab under test (not the Web App tab), hover the mouse to see the orange highlight box, click the elements you want to use (e.g. the Username field, Password field, Login button).
3. Elements appear in the Side Panel's Object Repository, and are automatically synced to the Web App.
4. Click **Stop Scan** when done.

**Scan All (scan the whole page at once)**
1. Click **Scan All** — the extension scans the tab under test in one pass for every interactable element (`input`, `button`, `a`, `select`, `textarea`, `label`, elements with `role`/`onclick`/`tabindex`, etc.), skipping hidden or disabled ones.
2. A results panel opens with a checklist of candidates. Hover a row to preview it (orange highlight box on the page under test), and use the filter box to narrow down by name/tag/text.
3. Tick the elements you want (or **Select All**), then click **Add Selected** — they're added to the Object Repository the same way as manual scan, synced to the Web App.
4. **Scan All** is faster for pages with many fields; fall back to the manual hover/click scan for one-off elements or when a specific element's auto-generated selector isn't stable enough (e.g. deeply dynamic SAP UI5/Angular IDs — pick it manually and rename it if needed).

### b. Test Builder — add steps manually (in the Web App)
1. **Test Builder** tab → **+ New test case**, give it a name.
2. Select an object (scanned in step a), an action (Click/Input/Select/Verify Text/Wait), enter a value → **+ Add step**.
3. Example with `sample-page.html`: Input into the "username" object with value `abc`, Click the "Login" object, Verify Text on object "#result" with value `Xin chào, abc!`.

### c. Record & Playback (in the Web App)
1. Make sure the correct **Target Tab** is selected. Select/create a test case, click **Start Recording**.
2. Perform real actions on the Target Tab (type into an input, select a dropdown, click a button) → steps are automatically added to the list in the Web App.
3. Click **Stop Recording** when done.

### d. Suite — chain multiple test cases into one workflow (in the Web App)
1. Create a few standalone test cases first in Test Builder (e.g. "Login", "Create order", "Logout" — can belong to different features).
2. **Suite** tab → **+ New Suite**, give it a name (e.g. "End-to-end flow").
3. Select a test case from the dropdown at the bottom of the page → **+ Add to Suite**, repeat in the order you want them to run. You can reorder (↑/↓) or remove them from the suite.
4. **Note**: if a test case in the suite fails, the suite **stops immediately** and does not run the remaining test cases (fail-fast).

### e. Run & Report (in the Web App)
1. **Run** tab → choose **Single Test Case** or **Suite** mode from the first dropdown, select the corresponding test case/suite → click **▶ Run**. Results run on the selected **Target Tab**.
2. Test Case mode: view the real-time status of each step (pending → running → pass/fail).
3. Suite mode: the list of test cases in the suite appears at the top (pending/running/pass/fail for each test case), with step details for the currently running test case shown below.
4. On the Target Tab you'll see a blue box pointing to the element being acted on.
5. **Report** tab → view run history. A Suite run's report is grouped into a single 🗂 card containing the sub-reports of each test case in order; a single test case run displays normally. Expand to see step details + screenshots. History can be deleted.

## PoC limitations (see also `sap-automation-poc-plan.md`)

- No support for nested iframes, no support for running multiple tabs in parallel.
- **Scan All** only detects elements matching a fixed interactive selector list (`input`/`button`/`a`/`select`/`textarea`/`label`/`[role]`/`[onclick]`/`[tabindex]`); elements made interactive purely via JS event listeners with none of those attributes won't show up — use the manual hover/click scan for those.
- No data-driven testing, no Requirement/Risk-based design module.
- No CI/CD runner — only runs through the Web App UI / Side Panel.
- Suite runs fail-fast (stops immediately on a failed test case), no "run everything then summarize" or retry option.
- Data (Object Repository, Test Case, Test Suite, Report) is still stored in the extension's `chrome.storage.local` — uninstalling the extension loses the data. The Web App stores nothing; it's just a remote-control layer.
- Only the single origin `http://localhost:8787` is whitelisted in `externally_connectable`.
