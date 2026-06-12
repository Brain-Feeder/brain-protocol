# Querying — precise questions, self-describing systems

Brain Protocol keeps the **intelligence in the hub** and the **wire precise**. A hub's model
understands a person's fuzzy question and asks *the person* the good follow-up — it never holds a
natural-language conversation with your agent. So your agent's job is not to be clever; it is to be
**precise and self-describing**. This doc covers the three optional, additive features that make that
work. All are backwards-compatible: a minimal agent that declares none of them still federates.

## 1. A shared status vocabulary

So that "outstanding" means the same thing in every system, the protocol publishes one set of status
words, grouped into **outstanding** (still in flight / needs the user) and **settled** (closed):

| group | words |
| --- | --- |
| outstanding | `ordered` · `on_the_way` · `out_for_delivery` · `to_collect` · `open` · `in_progress` · `scheduled` · `waiting` |
| settled | `delivered` · `arrived` · `collected` · `done` · `completed` · `cancelled` · `returned` · `refunded` · `failed` |

You MAY use your own status strings, but SHOULD map onto these where they fit. A hub treats any
**unknown** status as outstanding — safer to surface an item than to silently hide it.

```ts
import { ACTIVITY_STATUS, isOutstanding } from './protocol';
isOutstanding('out_for_delivery'); // true
isOutstanding('delivered');        // false
```

## 2. Typed queries on `activities.query`

So the hub can ask a precise question instead of pulling the whole list and filtering in its head,
`activities.query` MAY accept these optional filters (`ActivityQuery`):

| param | meaning |
| --- | --- |
| `status` | string[] — match any of these statuses |
| `since` / `until` | ISO date bounds on `due_on` (falling back to `starts_at`) |
| `q` | case-insensitive substring over `title` |
| `limit` | cap the number of items returned |

A minimal agent can ignore them and return the full list — the hub still filters. The reference
agent honours them with the bundled `filterActivities` helper:

```ts
import { filterActivities } from './protocol';
// "out-for-delivery items since Monday, max 20"
filterActivities(myActivities(), { status: ['out_for_delivery'], since: '2026-06-01', limit: 20 });
```

## 3. A self-describing card (the card teaches the model)

Each capability on your agent card MAY carry an optional `describe` block — plain-English, model-
readable semantics so a hub's brain learns how to query you *from the card alone*, with no bespoke
per-system wiring:

```ts
{
  name: 'tasks', verbs: ['read', 'query', 'act'],
  describe: {
    summary: 'Work items and their status — what is open, in progress, scheduled or done.',
    statuses: ['open', 'in_progress', 'scheduled', 'done', 'cancelled'],
    fields: ['title', 'status', 'due_on'],
    query_params: ['status', 'q', 'since', 'until', 'limit'],
    examples: ['what is still open?', 'anything due this week?'],
  },
}
```

`summary` says what the capability answers; `statuses` lists the words your items actually use;
`query_params` declares which `ActivityQuery` filters you honour; `examples` are sample questions.
The richer your `describe`, the more precisely a hub queries you — but it stays optional, so onboarding
is still an afternoon.

## What this is *not*

There is no agent-to-agent natural-language chat. Free text returned by a system is treated by the
hub as **untrusted data**, never as instructions — that boundary is what keeps federation safe from
cross-system prompt injection. Structured, typed queries are the backbone; the understanding lives in
the hub.
