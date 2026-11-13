# Jarvis online (works on your phone)

Hosted on Vercel and locked behind your password. Reads your Gmail and Google Calendar, speaks a morning briefing,
and with an Anthropic API key it can also schedule meetings and send or reply to email. Every send or schedule asks you to confirm first.

Files: index.html, manifest.webmanifest, icon.svg, package.json, .gitignore, api/main.js, api/callback.js, lib/core.js

## 1. GitHub
Repo: https://github.com/victormurimiofficial-sudo/Jarvis. Add each file with Add file -> Create new file (type the path, paste the code, Commit).

## 2. Deploy on Vercel
1. vercel.com -> Sign up with GitHub -> Add New -> Project -> import `Jarvis`.
2. Environment Variables:
   - `APP_PASSWORD`: a long password only you know
   - `SESSION_SECRET`: any long random text (40+ characters)
   - `ANTHROPIC_API_KEY`: from console.anthropic.com. This is Jarvis's brain (see Intelligence below)
   - `ANTHROPIC_MODEL`: optional. Default is claude-sonnet-5-5 (smartest). Use claude-haiku-5-5 for faster, cheaper replies
3. Deploy, then copy your address, like `https://jarvis-xxxx.vercel.app`.

## 3. Google setup
1. console.cloud.google.com -> new project -> APIs & Services -> Library: enable **Gmail API** and **Google Calendar API**.
2. OAuth consent screen: External. Add these scopes: `gmail.readonly`, `gmail.send`, `calendar.events`. Add yourself as a Test user, then click **Publish app** (In production) so Google doesn't sign you out every 7 days. Unverified is fine for your own use.
3. Credentials -> Create credentials -> OAuth client ID -> Web application. Authorized redirect URI: `https://YOUR-ADDRESS/api/callback`
4. Put the client ID and secret into Vercel as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then Deployments -> Redeploy.

## 4. Use it
Open your address, enter the password, tap **Connect Google**, approve, then tap the orb.
Try: "good morning", "read my emails", "what's next", "schedule lunch with Amara tomorrow at 1pm",
"reply to Sam saying I'll sign today", "email priya@example.com about the Q4 deck".
Hands-free: switch on HANDS-FREE and say "Jarvis, good morning". It only listens while the page is open on screen.
Add to Home Screen for an app icon.

## Intelligence
With ANTHROPIC_API_KEY set, every request goes to Claude, which remembers the last few turns and can search and read your Gmail,
look up any day on your calendar, and prepare events, emails and replies. Anything that sends or creates needs your tap first.
Without a key, Jarvis falls back to a basic briefing and mail reading. Email text is treated as untrusted data, never as instructions.
