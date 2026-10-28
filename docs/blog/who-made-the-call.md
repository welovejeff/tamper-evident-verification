# Who made the call?

*By [Jeff MacDonald](https://github.com/welovejeff) · October 2026 · research notes*

Tamper Signal's yellow light has a five-word job description: **a human should look.** We wrote that line assuming the human who looks brings their own judgment. A new study from Anthropic tested that assumption with fifty experts and a coin flip, and the result is worth sitting with if you build dashboards with an AI agent.

## The study

In ["How AI agents shape experts' judgment calls"](https://www.anthropic.com/research/agents-judgment-calls) (Herdağdelen, Joren, and Tamkin, October 2026), analysts with causal-inference experience advised a fictional farming cooperative on whether to expand or cut an advisory program. Each worked with Claude in Claude Code. Fifty of them were analyzed.

The task had four open decisions, each with more than one defensible answer: which outcome to measure, which comparison method to use, which farms to include, and how to weight them. For every analyst, a coin flip secretly set which way the agent leaned on each one. The agent was told to make the best honest case for its lean, to change its mind if the evidence demanded it, and never to mislead.

So the agent's preferences were random. Any pattern in what the humans chose came from the agent, not from the data.

## What happened

> "Across the four analytical choices, analysts went with their agent's lean 86% of the time."
>
> *Herdağdelen, Joren, Tamkin · Anthropic, October 2026*

Chance would be about half. A few more numbers from the paper:

- **Switching.** Analysts who had already picked an option switched away from it 60% of the time when the agent disagreed, and 6% of the time when it agreed.
- **Borrowed reasons.** 77% repeated the agent's arguments in at least one answer, sometimes word for word. Only 15% credited the agent anywhere.
- **Felt ownership.** 52% rated the final recommendation as more their own than the agent's.
- **No safe profile.** Experience, expertise, education, and trust in AI did not predict who deferred.

Nobody was tricked. The agent argued honestly, and the work it produced was mostly good: analysts with an agent made fewer serious errors than the smaller group that worked alone. The problem is not bad work. It is that the review stopped being a separate opinion.

> "Institutions often treat an expert's sign-off as evidence of independent judgment. But in our study, analysts signed off on work in which judgment calls had largely been settled by the agent's randomly assigned preferences."
>
> *Herdağdelen, Joren, Tamkin · Anthropic, October 2026*

## Your dashboard has the same four forks

Swap the farming cooperative for a paid-social report and the decisions look familiar. Do refunded orders count? Are we filtering to active campaigns or all of them? Is engagement rate averaged per post or weighted by reach? Which date column defines the week?

None of those has a reference answer. Each is a judgment call that an agent will happily make while it writes the pandas, explain clearly, and present for your approval. Per the study, you will probably approve it, and you will probably remember the choice as yours.

> "Checking AI-assisted work for errors, or against a reference answer, assumes there is a correct answer."
>
> *Herdağdelen, Joren, Tamkin · Anthropic, October 2026*

This is the same wall Tamper Signal was built against, and it is why our honest claim reads the way it does: *it can't tell you the data is right, but it can prove nobody changed it.* No tool can tell you whether "active campaigns only" was the right call. That stays a human decision, which is exactly why it matters whose decision it was.

## What a receipt can show

A receipt does not record whose idea a filter was. It records what the filter did. That turns out to be the useful half, because the study's analysts were swayed by arguments, and a receipt has no argument in it. It has numbers.

- **Each fork can be its own signed stage.** Put a judgment call in its own wrapped function and it gets its own receipt: the code that ran, and the control totals going in and coming out. "Active campaigns only" stops being a sentence in a chat and becomes a link in the chain that says how many rows and how much spend it removed.
- **A changed call shows up as a changed stage.** If the next run quietly swaps the weighting, `tamper-signal diff` reports which stage's code changed and how the totals moved. The agent's explanation is optional; the delta is not.
- **Sign-off leaves a named trail.** When the watcher holds a change for review, accepting it takes a written reason, signed and linked to the exact change it explains, plus a self-declared author. One change, one human, one reason.

Splitting a fork into its own stage is a few lines with the decorator you already use:

```python
from tamper_signal import receipt_step

@receipt_step(chain_dir="receipts/", key_path="keys/signing.key")
def keep_active_campaigns(records):
    # Judgment call: paused campaigns are excluded from the report.
    return [r for r in records if r["status"] == "active"]
```

## What a receipt cannot show

Be clear about the limit, because it is the same limit the paper names. A signature proves who vouched for a stage. It does not prove the judgment behind it was theirs. If your `--reason` is the agent's paragraph pasted in, the chain will faithfully sign a borrowed opinion. Tamper Signal is a record of what happened to the data, not a record of who thought of it.

> "a human reviewer is only an independent check if their judgment is their own."
>
> *Herdağdelen, Joren, Tamkin · Anthropic, October 2026*

## Three habits for the human in the loop

None of these needs anything new. They are ways to use what the chain already records so your review stays a review.

- **Read the totals before the reasons.** Open the room and look at what each stage did to row counts and sums before you read the agent's case for it. Numbers first makes it harder for a fluent argument to set your frame.
- **Name the forks out loud.** Give every judgment call its own stage with a plain name, like `keep_active_campaigns`, not `clean_data`. A stage you can see is a decision you can question.
- **Write reasons in your own words.** When you accept a held change, say why in a sentence you would defend without the agent in the room. If you can't, that is a reason to look again.

## The fine print on the study

The authors are careful, and we should be too. The agent's lean was deliberately strengthened, and the study covers one task, one field, and one model. Real experts on their own turf may hold stronger views. But the finding that nothing about the analysts predicted who deferred should give anyone pause who assumes "I'd notice."

The light is green, the data is clean. That still means continuity, not correctness. When the light is yellow and a human should look, make sure the human looking is you.

> "That split can be something we choose, instead of something we drift into."
>
> *Herdağdelen, Joren, Tamkin · Anthropic, October 2026*

[Read the full study →](https://www.anthropic.com/research/agents-judgment-calls)
