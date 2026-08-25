# Event Squad App

React (Vite) + Supabase, same stack as the shift-scheduling app. A host creates an
open-play event; any signed-in player can add unlimited guests (no account needed
for the guests) and the running total is (confirmed players + their guests) × price
per player. Non-host players pay through a QR screen and wait for the host to approve.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project.
2. Once it's up, open **SQL Editor** → paste the contents of `supabase/schema.sql`
   from this repo → **Run**. This creates the four tables (`events`,
   `event_members`, `guests`, `payment_requests`), the `approve_payment_request`
   function, and all the row-level security policies.
3. Go to **Authentication → Providers** and make sure **Email** is enabled
   (it is by default). This app signs people in with a magic link, no password.
4. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **anon public** key

## 2. Configure the app

```bash
cp .env.example .env.local
```

Open `.env.local` and paste in the two values from step 1.4:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

## 3. Install and run

```bash
npm install
npm run dev
```

Open **http://localhost:5173**.

## 4. Try it out

1. Sign in with your email — Supabase emails you a magic link (check spam if it's
   slow). Click it, it drops you back on localhost signed in.
2. Since no event exists yet, you'll land on **Create event** — fill it in, you
   become the host.
3. On the event screen, add a guest under your own name to see the total update.
4. To test the join flow: open the same URL in an **incognito window** (or sign
   out and sign back in with a second email) → sign in as a different player →
   you'll land on the same event → tap **"Another logged-in player joins"** →
   add a name and some guests → **Request to join** → you'll see the payment
   screen with the QR placeholder and total → **"I've sent ₱X"**.
5. Back in your original (host) window, the request appears under **Requests to
   join** with an **Approve / Decline** button — approving adds them to the
   confirmed roster and updates the total live (via Supabase Realtime, no
   refresh needed).

## What's a placeholder right now

- **The QR code** (`src/components/QRPlaceholder.jsx`) is a decorative,
  deterministic pattern — not a real scannable GCash/bank QR. Wiring up a real
  one means integrating PayMongo or Xendit: they generate the actual QR for a
  specific amount and fire a webhook when it's paid, which is what should flip
  a request from `awaiting_payment` to `pending_approval` instead of the
  player clicking "I've sent" manually.
- **Single active event per user session** — `Home.jsx` just grabs the most
  recently created event across the whole app. Fine for testing solo, but for
  real multi-event use you'd want an events list / browse screen.

## Deploying

Same flow as the shift-scheduling app: push this to GitHub, import the repo in
Vercel, and add `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as environment
variables in the Vercel project settings.
