# Show your work

*By [Jeff MacDonald](https://github.com/welovejeff) · June 2026*

A number in a deck gets questioned. Someone asks where it came from, and the answer that comes back is a screenshot of a chart pasted into a Slack thread with a green arrow drawn on it. That is a picture of someone believing the number, not a picture of where the number came from. The actual rows that made it are three transforms and one AI-written aggregation away, and nobody in the thread can reach them.

So the thread does the thing threads do. People reply with confidence proportional to how much they like the number. The arrow stays. The rows stay gone. And the question that started it, the only honest one, never gets answered, because answering it would mean opening something nobody shipped. A chart asks you to believe; a table lets you check.

So here is the whole argument, in one tab. Every dashboard built on verified data should ship a Data tab: the raw table the charts were drawn from, sitting one click from the picture and re-checking itself in your browser. Not a tooltip, not an export on request. The rows, next to the chart, where anyone who doubts a number can go read it.

## A chart is a claim, not evidence

A chart is a summary that has been smoothed and rounded and fit to a pleasant axis, and the thing about a summary is that it cannot look wrong. A bar has a height. It is the height it is. A dropped row shortens that bar by an amount no eye will ever catch, and the chart renders the shorter bar with exactly the same confidence it rendered the right one. There is no jagged edge, no broken glyph, no visual tell. The loss is invisible by construction.

That is not a knock on charts. It is the whole point of them, and most days it is a gift. But it means a chart is a claim about the data, not the data, and the gap between the two is exactly where a silent failure lives. The numbers that quietly come up short, the rows a transform ate, the double-count from an AI-written join: all of them survive the trip to the chart looking perfectly healthy. The picture is fine. The picture is always fine. That is the problem.

## The one tab nobody ships

Dashboards have room for five tabs of charts. Overview, by channel, by week, by campaign, a funnel. They almost never have the sixth one: a plain table of the raw verified rows the charts were built from. It is the cheapest tab to build and the first one cut, and the reasons it gets cut all sound responsible right up until you say them out loud.

It clutters the exec view. It does not, because a tab is not the front page. The default stays charts. The table sits one click away for the one person who actually needs to check a number, and is invisible to everyone who does not.

It is slow to render. Usually it is not, because the table worth showing is the final receipt's output, which is almost always the smallest table in the pipeline, after every filter and aggregate has already run. And if it is genuinely large, you paginate it or lazy-load it, the same as any other table on the internet.

The rows are confidential. Sometimes true, and the honest move is to attest a redacted projection and say "these columns are withheld for privacy" in the open, where the reader can see the redaction happened. The dishonest move is to ship no table and let "confidential" do the quiet work of meaning "unverifiable."

Nobody clicks it. Probably right, and beside the point. The value of a checkable table is not its click rate, the same way the value of an audit trail is not how often anyone reads it. It exists for the one day a number looks wrong and someone needs to reach the rows. You are not building it for the median Tuesday. You are building it for the bad Thursday.

| Approach | Shows every row | Verifiable on screen | One click from the chart |
|----------|-----------------|----------------------|--------------------------|
| Tooltip on hover | no | no | n/a |
| Export to file | yes | no | no |
| Verified Data tab | yes | yes | yes |

## If the chain is green, hiding the rows is a tell

Here is the turn. Once the data behind the chart is verified, once the receipt chain is intact and the light is green, there is no honest reason left to hide the rows. A dashboard that shows the data behind its charts is just a dashboard with nothing left to hide. The privacy case is handled by redacting in the open. The clutter case is handled by a default. The performance case is handled by pagination. What remains, after the good reasons are spent, is not a reason. It is a reflex.

And the reflex is worth naming, because it is usually pointing at something. If you find yourself wanting to hide the rows, that's worth sitting with. Not because you did anything wrong, and not because the number is necessarily bad. The accusation here is aimed at the missing tab, not at you. A green chart with no table behind it is asking the room to extend a kind of credit that the green light already made unnecessary. The light says you can check. The missing table says please don't.

## How do you know the table on screen is real?

Fair question, and the answer is the same trick the rest of Tamper Signal runs. A table on a page is just markup. By the time you are reading it, it could be stale, or edited in the template, or pulled from a different export than the one the chart used. So the table has to do what the status light does: check itself, in your browser, before it asks you to read it.

Two pieces. First, `receipts export` writes the canonical table to disk right next to the chain, and refuses any data that does not match the final receipt. So the file on the server is, by construction, the attested rows and nothing else. Second, in the viewer's browser, `mountReceiptTable` from `tamper-signal/table` re-hashes those rows against what the chain signed before it renders a single cell.

```js
receipts export
mountReceiptTable(document.querySelector("#data"), "/receipts/chain.json")
```

If the rows hash to the attested value, the table renders VERIFIED, which means byte-for-byte the data the chain signed off on. If someone edited a cell or shipped a stale export, the table still renders, but dimmed, under a "not the attested data" strip, so you see the rows and the fact that you should not trust them in the same glance. If the chain itself is broken, it flags the columns that moved. And if the browser cannot run the check at all, it says so in grey rather than green, because a check it could not perform is not a verdict it gets to give. This is the receipt at the register: you do not take the total on the screen on faith, you read the line items and add them up yourself. The table does not ask you to trust it either. It checks itself, same as the light, and that is why this is one component you drop into your dashboard rather than a service you stand up.

## What a visible data table cannot tell you

Now the honest part, because skipping it would make this the kind of copy this project exists to mock. A visible table is not a correct table. You can read every single row, re-derive every total by hand, and the source export underneath can still be wrong. Garbage that was faithfully exported is still garbage, and it will sit there in a perfectly verified table looking like fact.

What the table proves is narrower. It proves the rows on screen are the attested rows, the ones the chain signed, and it lets you check that the chart is a faithful summary of those rows and not some other set. You can confirm the bar matches the column. You can re-derive the aggregate the AI wrote. You can inspect the row that looks off. What you cannot do is conclude the source was right, because nothing on the page knows that, and any tool that claims to is selling you a feeling.

This is the same line the rest of the product holds, applied to one more surface: continuity, not correctness. The table lets you check that the picture descends, unbroken, from the rows it claims. It does not, and cannot, vouch for the rows. Which is exactly why a vibe-coded dashboard needs the tab even more than a hand-built one. And because real pipelines refresh every morning and drift the way data does, the table re-checks itself on every load instead of trusting a render from last week.

## Green light, open table

It drops in the way the light does. You mount one component, point it at the chain file the rest of Tamper Signal already writes, and it re-hashes the rows in the browser on its own. No server to trust, no database, no infrastructure to stand up. MIT licensed, Python 3.11+ or Node 18.17+, and the table the dashboard already had becomes the table that proves itself. If you want to watch the light go green and then open the rows behind it, try the live demo.

Green light, open table. That's the whole standard.
