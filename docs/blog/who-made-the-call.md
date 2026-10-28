# Who made the call?

*By [Jeff MacDonald](https://github.com/welovejeff) · October 2026 · research notes*

Tamper Signal's yellow light has a five-word job: **a human should look.** When I wrote that line, I assumed the human who looks brings their own judgment. A new Anthropic study tested that assumption with fifty experts and a coin flip. I haven't stopped thinking about it.

## The study

Anthropic researchers Amaç Herdağdelen, Hailey Joren, and Alex Tamkin published ["How AI agents shape experts' judgment calls"](https://www.anthropic.com/research/agents-judgment-calls) in October 2026. They asked analysts with causal-inference experience to advise a made-up farming cooperative: expand an advisory program, or cut it? Each analyst worked with Claude in Claude Code. Fifty were analyzed.

The task had four open decisions: what to measure, how to compare, which farms to include, and how to weight them. Each had more than one defensible answer.

Here's the clever part. For every analyst, a coin flip secretly set which way the agent leaned on each decision. The agent was told to argue its side honestly, change its mind if the evidence called for it, and never mislead.

So the agent's preferences were random. If the analysts' choices followed a pattern, the pattern came from the agent.

## What happened

> "Across the four analytical choices, analysts went with their agent's lean 86% of the time."
>
> *Herdağdelen, Joren, Tamkin · Anthropic, October 2026*

Chance would be about 50%. The rest of the numbers are just as striking:

- Analysts who had already picked an option switched 60% of the time when the agent disagreed. When it agreed, 6%.
- 77% repeated the agent's arguments, sometimes word for word. Only 15% credited the agent.
- 52% rated the final recommendation as more their own than the agent's.
- Experience, expertise, education, and trust in AI didn't predict who deferred.

Nobody was tricked. The agent argued honestly, and the work was mostly good. Analysts with an agent made fewer serious errors than the smaller group who worked alone. What went missing was the second opinion. The review had quietly become the agent's opinion, with a human signature on it.

> "Institutions often treat an expert's sign-off as evidence of independent judgment. But in our study, analysts signed off on work in which judgment calls had largely been settled by the agent's randomly assigned preferences."
>
> *Herdağdelen, Joren, Tamkin · Anthropic, October 2026*

## Your dashboard has the same forks

Swap the farming cooperative for a paid-social report. The decisions look familiar:

- Do refunded orders count?
- Active campaigns only, or all of them?
- Is engagement rate averaged per post, or weighted by reach?
- Which date column defines the week?

None of these has a right answer you can check against. Your agent will pick one while it writes the pandas, explain it well, and ask you to approve. If the study holds, you'll approve it. And you'll remember the choice as yours.

> "Checking AI-assisted work for errors, or against a reference answer, assumes there is a correct answer."
>
> *Herdağdelen, Joren, Tamkin · Anthropic, October 2026*

Tamper Signal runs into the same wall. That's why our honest claim reads the way it does: *it can't tell you the data is right, but it can prove nobody changed it.* No tool can tell you whether "active campaigns only" was the right call. That part stays human, which is exactly why it matters which human made it.

## What a receipt can show

A receipt won't tell you whose idea a filter was. It tells you what the filter did. Here, that's the half you want. The analysts were swayed by arguments, and a receipt has none. Just numbers.

- **Each fork gets its own receipt.** Put a judgment call in its own wrapped function, and its receipt records the code that ran plus the control totals going in and coming out. "Active campaigns only" stops being a line in a chat. It becomes a link in the chain that shows how many rows and how much spend it removed.
- **A changed call shows up.** If the next run quietly swaps the weighting, `tamper-signal diff` shows which stage's code changed and how the totals moved, whether or not the agent mentions it.
- **Sign-off leaves a trail.** When the watcher holds a change for review, accepting it takes a written reason. The reason is signed and tied to the exact change, along with a self-declared author. One change, one human, one reason.

Splitting a fork into its own stage takes a few lines with the decorator you already use:

```python
from tamper_signal import receipt_step

@receipt_step(chain_dir="receipts/", key_path="keys/signing.key")
def keep_active_campaigns(records):
    # Judgment call: paused campaigns are excluded from the report.
    return [r for r in records if r["status"] == "active"]
```

## What a receipt can't show

Here's the limit, and it's the same one the paper names. A signature shows who vouched for a stage. It can't show the judgment was theirs. Paste the agent's paragraph into `--reason` and the chain will faithfully sign a borrowed opinion. The chain records what happened to the data. Who thought of it is outside its reach.

> "a human reviewer is only an independent check if their judgment is their own."
>
> *Herdağdelen, Joren, Tamkin · Anthropic, October 2026*

## Keeping the review yours

None of this needs anything new. It just uses what the chain already records.

1. **Read the totals before the reasons.** Open the room and check what each stage did to row counts and sums before you read the agent's case. Once you've seen the numbers, a fluent argument has a harder time setting your frame.
2. **Give each fork a plain name.** Call the stage `keep_active_campaigns`, not `clean_data`. You can question a decision you can see.
3. **Write reasons in your own words.** When you accept a held change, write a sentence you'd defend with the agent out of the room. If you can't, look again.

## What the authors caution

The authors are careful, so I'll be careful too. They deliberately strengthened the agent's lean. The study covers one task, one field, and one model. Real experts on home turf may push back harder.

Still, nothing about the analysts predicted who deferred. That should worry anyone whose plan is "I'd notice."

The light is green, the data is clean. That still means continuity, not correctness. And when the light is yellow and a human should look, make sure the human looking is you.

> "That split can be something we choose, instead of something we drift into."
>
> *Herdağdelen, Joren, Tamkin · Anthropic, October 2026*

[Read the full study →](https://www.anthropic.com/research/agents-judgment-calls)
