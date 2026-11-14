# Sayana

Whatsup? Aur Bata.

A listen-first PWA. Your dumps stay in your vault.

Live: [https://sayana-swart.vercel.app](https://sayana-swart.vercel.app)

```bash
cp .env.example .env.local
# set DATABASE_URL and OPENAI_API_KEY — credentials created for Sayana
npm install
npm test
npm run dev                   # http://localhost:3100
```

Install on the phone (Add to Home Screen) for lock-screen Web Push after you allow notifications.

## Stands alone

Sayana does not share a database, API keys, Clerk app, Vercel project, or push keys with any other product, including AthleteOS.

What is in this repo:

- No code, URL, or dependency points at the athletesos-hackathon repo or the Vercel team `sports-hackathon-athlete-os`.
- There is no `.vercel/project.json`, so there is no shared org id or project id. Connect this GitHub repo to its own Vercel project.
- `DATABASE_URL` is Sayana’s own Neon database. Tables inside it are prefixed `sayana_`.
- `OPENAI_API_KEY` is Sayana’s own key.

## What the model is allowed to say

Sayana calls OpenAI’s Responses API. The model is `OPENAI_MODEL`, or `gpt-6.1-sol` when that variable is unset.

- The short reply after a rant may only mention names, numbers, and dates that were in that rant. If the draft adds any, Sayana swaps in a plain acknowledgement.
- Today’s notes (steps, people, decisions, and the rest) are kept only when those words were in the rant. “Twenty” and “20” count as the same number. A Hindi rant has to contain a verbatim quote or the note is dropped.
- History → ask answers from your dumps and shows the quote it used. If the dumps don’t contain the answer, Sayana says “I don't have that in your dumps.”

Notes and History answers are requested at temperature 0. The spoken reply uses 0.3, then the same fact check.

## Data

See [DATA.md](DATA.md).

## Deploy on Vercel

`npm run build` is the production build. `vercel.json` marks the app as Next.js and schedules `/api/v1/reminders/tick` at `0 12 * * *` UTC.

Set these on the Sayana Vercel project only:

| Variable | Required | What to put |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon URL created for Sayana. Not another app’s database. |
| `OPENAI_API_KEY` | yes | OpenAI key created for Sayana. Used for speech, the reply, Today’s notes, and History answers. |
| `OPENAI_MODEL` | no | Leave unset to use `gpt-6.1-sol`. Set `gpt-6-luna` for the cheaper model. If Vercel still has `gpt-4.1-mini`, change it or delete it — a saved value overrides the default. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | no | Web-push keys generated for Sayana: `npx web-push generate-vapid-keys`. |
| `CRON_SECRET` | no | If set, the reminder route requires `Authorization: Bearer <secret>`. The cron in `vercel.json` does not send that header, so leave it unset unless you add the header. |

`NEXT_PUBLIC_APP_URL`, the Clerk keys, and the Google Calendar keys are in `.env.example` but this build does not read them. Leave them empty. Do not paste another app’s values.
