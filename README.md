# Google_CleaningServices_CalendarApp
A cleaning-job scheduler and tracker built on Google Sheets and Apps Script. An admin schedules jobs on a calendar; cleaners sign in with a personal access code, see only their own jobs, and update status and a completion checklist (with required photos) as they work. Includes per-person iCal export, a one-tap mobile link to a single job, and a PAID flag for finished jobs.
# Contents
* `Code.gs` — the Apps Script backend: sign-in, the Assignments and People sheets, photo uploads to Drive, validation rules.
* `Index.html` — the calendar page served to the browser.
* `appsscript.json` — the project manifest (Drive API service, OAuth scopes, web app settings).
# Requirements
* A Google account with access to Google Sheets and Apps Script.
* Nothing else — no external hosting, no npm install. Everything runs inside Apps Script.
# Install
1. Create or open a Google Sheet that will hold your data. This can be blank; the script creates its own tabs.
2. Open the script editor: Extensions > Apps Script.
3. Add the manifest. In the editor, click the gear icon (Project Settings) and turn on "Show appsscript.json manifest file in editor." Open `appsscript.json` in the editor, delete its contents, and paste in this project's `appsscript.json`.
4. Add the backend. Open `Code.gs` in the editor (or create it if it isn't there), delete any existing content, and paste in this project's `Code.gs`.
5. Add the page. Click the `+` next to Files > HTML, name the new file exactly `Index` (the editor adds `.html` for you), delete any placeholder content, and paste in this project's `Index.html`.
6. Run setup once. In the function dropdown at the top of the editor, choose `setup` and click Run. Approve the permission prompts (Sheets access, and Drive access limited to files this script creates). This creates two tabs in your sheet: `People` and `Assignments`.
7. Deploy as a web app.
*  Deploy > New deployment > gear icon > Web app.
*  Execute as: Me.
*  Who has access: Anyone.
*  Click Deploy and copy the web app URL (it ends in `/exec`).
8.  Point the page at your deployment. Open `Index.html` in the editor, find the line near the top of the `<script>` block that builds `API_URL`, and replace the script ID portion with your own deployment's. The simplest way: open your `/exec` URL, copy it, and rebuild that line to match (it's built from `"https:" + "/" + "/" + "script.google.com/macros/s/YOUR_ID/exec"` rather than written as one string — see A note on editing Index.html below for why).
9.  Redeploy (Deploy > Manage deployments > pencil icon > Version: New version) any time you change `Code.gs` or `Index.html` — edits in the editor don't go live until you do this.
10. Get your admin code. Open the `People` tab in your sheet. A row named `Admin` was created automatically with a random access code in the second column. Open your `/exec` URL and sign in with that code.

# Setting up people
On the `People` tab, add one row per person:

|Name|Access Code|Role|Active|

* Leave Access code blank for a new row — the app fills in a random code the next time an admin loads the calendar.
* Role is `admin` or `cleaner`. Admins can see everyone, schedule jobs, and remove them. Cleaners only see and update their own jobs.
* Uncheck Active to revoke someone without deleting their row.
* To send a cleaner their sign-in link, sign in as admin, pick their name in the Person dropdown, and click Copy link for this person. The link signs them in automatically — no code to type.

# Usage as Admin
* Scheduling a job: click any date on the calendar. Pick the cleaner, a time, and a location (choose an existing address or "Other…" to add a new one). Check One-Night Stay if it applies.
* Viewing by person: use the Person dropdown to filter the calendar, or leave it on "All people."
* Removing a job: click the × on an event chip. This marks it Cancelled in the sheet rather than deleting the row; cancelled jobs never show on the calendar.
* Marking a job paid: open a job whose status is Done — a PAID checkbox appears (cleaners never see this). Paid jobs turn gray on the calendar. Reopening a paid job to Accepted or In Progress automatically clears the paid flag.
* Exporting a calendar: pick a person in the dropdown, then click "Export to iCal (.ics)." The file contains only that person's jobs, and each event links back to that person's single-job view (see below).

# As a Cleaner
* Sign in with your access code, or open the link your admin sent you.
* You only see your own jobs. The Person field is locked to your name.
* Opening a job shows the status, a completion checklist, your notes, and a place to upload photos.
* Status progression: Assigned → Accepted → In Progress → Done. Accepted and In Progress can be saved with no photos and no checklist answers.
* Done requires the checklist to be fully answered and at least one photo uploaded.
* From a calendar link: tapping an event in your phone's calendar app opens just that one job, laid out for a phone, with a button back to the full calendar.

# Status colors
* Blue — on schedule.
* Red — overdue: not accepted by the start of the job's day, not started within 3 hours of the scheduled time (once accepted), or not updated by the day after an In Progress job's last update.
* Green — Done.
* Gray — Done and marked paid.

# A note on editing Index.html
The browsers used to test this app sit behind something that strips everything from two forward slashes in a row (//) to the end of that line — even inside a quoted web address — before the page's script can run. That turns a valid line into a syntax error and the whole page fails silently (blank calendar, no sign-in box).

To work around it, Index.html contains no // line comments (block comments /* like this */ only) and no web address written with a literal // — each one is built by joining single slashes, e.g. "https:" + "/" + "/" + "host/path". This affects API_URL, the Drive thumbnail link in driveThumb(), and the iCal PRODID line.
If you edit Index.html:
* Never type // anywhere in the file — not in a comment, not in a string.
* Before pasting a changed copy back into Apps Script, search the file for two slashes in a row. There should be no matches.
Exception:
Code.gs is not affected by this — it runs on Google's servers, not in a browser, so normal // comments and full URLs are fine there.

# Troubleshooting
Page loads but never signs in / blank calendar with no dates: almost always either the // issue above (if you edited Index.html), or the deployment's Execute as isn't set to Me (if it's "User accessing the web app," "Who has access: Anyone" won't be offered and sign-in will fail for everyone but you).
"Unexpected token '<', is not valid JSON" on sign-in: the request is hitting a Google sign-in page instead of your script. Check Deploy > Manage deployments > Who has access is set to Anyone.
A code change doesn't seem to take effect: you need to deploy a new version (Deploy > Manage deployments > pencil icon > Version: New version) after every edit — saving in the editor alone doesn't update the live /exec URL.

* Checking the deployment is live: open /exec?json=1 in a browser. 
* It should return {"ok":true,"status":"Job calendar API is running."}. 
* This also creates the People and Assignments tabs if they don't exist yet.
